// SPDX-License-Identifier: AGPL-3.0-only

// Package core is helixd: the single, app-agnostic device process that owns the
// cloud MQTT link and the local IPC bus, routing between them. Inbound requests
// on `helix/device/<id>/in` are dispatched by `message.service` to whichever
// registered IPC service matches; helixd never interprets app payloads.
package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

// SelfService is the service name helixd publishes its own telemetry under.
const SelfService = "helixd"

const heartbeatInterval = 30 * time.Second
const drainInterval = 2 * time.Second

type service struct {
	cfg      *config.Config
	log      *slog.Logger
	ipc      *ipc.Server
	mqtt     *mqttTransport
	spool    *spool
	enroller *enroller
	started  time.Time

	drainSignal chan struct{}
}

// NewService builds the helixd Runner.
func NewService(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	s := &service{cfg: cfg, log: log, started: time.Now(), drainSignal: make(chan struct{}, 1)}
	s.ipc = ipc.NewServer(cfg.IPC.SocketPath, log)
	s.enroller = newEnroller(cfg, log)

	sp, err := openSpool(cfg.Spool.Path, cfg.Spool.MaxBytes, log)
	if err != nil {
		return nil, err
	}
	s.spool = sp

	mq, err := newMQTT(cfg.MQTT, cfg.Device.ID, log, s.handleInbound)
	if err != nil {
		return nil, err
	}
	mq.afterConnect = s.kickDrain
	s.mqtt = mq
	// Events are spooled (store-and-forward); responses go out directly.
	s.ipc.SetPublisher(&spoolingPublisher{mqtt: mq, spool: sp})
	return s, nil
}

// spoolingPublisher persists telemetry events before publish; responses pass
// straight through.
type spoolingPublisher struct {
	mqtt  *mqttTransport
	spool *spool
}

func (p *spoolingPublisher) PublishResponse(packet ipc.HelixPacket) error {
	return p.mqtt.PublishResponse(packet)
}

func (p *spoolingPublisher) PublishEvent(service string, env ipc.DeviceEventEnvelope) error {
	return p.spool.enqueue(service, env)
}

func (s *service) Run(ctx context.Context) error {
	// Enroll a certificate on first boot if configured (no-op when the device
	// was provisioned with a cert out-of-band).
	if _, err := s.enroller.ensure(); err != nil {
		s.log.Warn("initial enrollment failed", "err", err)
	}

	ipcErr := make(chan error, 1)
	go func() { ipcErr <- s.ipc.Serve(ctx) }()

	s.mqtt.connect()
	go s.heartbeatLoop(ctx)
	go s.drainLoop(ctx)
	if s.enroller.enabled() {
		go s.rotateLoop(ctx)
	}

	s.log.Info("helixd ready", "device", s.cfg.Device.ID)
	select {
	case <-ctx.Done():
		return nil
	case err := <-ipcErr:
		return err
	}
}

func (s *service) Close() {
	if s.mqtt != nil {
		s.mqtt.disconnect()
	}
	if s.spool != nil {
		_ = s.spool.close()
	}
}

// kickDrain nudges the drain loop (non-blocking).
func (s *service) kickDrain() {
	select {
	case s.drainSignal <- struct{}{}:
	default:
	}
}

// drainLoop flushes spooled events to the cloud whenever the link is up.
func (s *service) drainLoop(ctx context.Context) {
	ticker := time.NewTicker(drainInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.drainSignal:
		}
		if !s.mqtt.connected() {
			continue
		}
		if _, err := s.spool.drain(s.mqtt.PublishEvent); err != nil {
			s.log.Warn("event drain failed", "err", err)
		}
	}
}

// handleInbound routes a cloud request to the registered local service.
func (s *service) handleInbound(packet ipc.HelixPacket) {
	svc := packet.Message.Service
	if !s.ipc.NotifyService(svc, ipc.CommandParams{
		Service:   svc,
		Method:    packet.Message.Method,
		Payload:   packet.Message.Payload,
		RequestID: packet.RequestID,
	}) {
		s.log.Warn("no local service for cloud request", "service", svc, "method", packet.Message.Method)
	}
}

func (s *service) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			payload, _ := json.Marshal(map[string]any{
				"deviceId":  s.cfg.Device.ID,
				"uptimeSec": int(time.Since(s.started).Seconds()),
			})
			if err := s.spool.enqueue(SelfService, ipc.BuildEventEnvelope("heartbeat", payload)); err != nil {
				s.log.Warn("heartbeat enqueue failed", "err", err)
			}
		}
	}
}
