// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

// inboundFunc is called for every control request that arrives on `.../in`.
type inboundFunc func(packet ipc.HelixPacket)

// mqttTransport is helixd's cloud link, speaking the standard Helix wire format:
//
//	helix/device/<id>/in                     requests  (cloud -> device)
//	helix/device/<id>/out                    responses (device -> cloud)
//	helix/device/<id>/service/<svc>/event    telemetry (device -> cloud)
type mqttTransport struct {
	client  mqtt.Client
	prefix  string
	log     *slog.Logger
	inbound inboundFunc
	// afterConnect, if set, is invoked after each successful (re)subscribe — used
	// to kick the spool drain once the link is back.
	afterConnect func()
}

func newMQTT(cfg config.MQTT, deviceID string, log *slog.Logger, inbound inboundFunc) (*mqttTransport, error) {
	t := &mqttTransport{
		prefix:  fmt.Sprintf("helix/device/%s", deviceID),
		log:     log,
		inbound: inbound,
	}

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.BrokerURL).
		SetClientID(fmt.Sprintf("helixd-%s", deviceID)).
		SetKeepAlive(time.Duration(cfg.KeepaliveSec) * time.Second).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(3 * time.Second).
		SetCleanSession(true).
		SetOnConnectHandler(t.onConnect).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			log.Warn("mqtt connection lost", "err", err)
		})

	if strings.HasPrefix(cfg.BrokerURL, "tls://") || strings.HasPrefix(cfg.BrokerURL, "ssl://") ||
		strings.HasPrefix(cfg.BrokerURL, "mqtts://") {
		tlsCfg, err := buildTLS(cfg)
		if err != nil {
			return nil, err
		}
		opts.SetTLSConfig(tlsCfg)
	}

	t.client = mqtt.NewClient(opts)
	return t, nil
}

func buildTLS(cfg config.MQTT) (*tls.Config, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if cfg.CACert != "" {
		ca, err := os.ReadFile(cfg.CACert)
		if err != nil {
			return nil, fmt.Errorf("read ca: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(ca) {
			return nil, fmt.Errorf("invalid ca cert")
		}
		tlsCfg.RootCAs = pool
	}
	if cfg.ClientCert != "" && cfg.ClientKey != "" {
		// Load the client key pair lazily on each handshake so certificate
		// rotation is picked up on reconnect without rebuilding the client.
		certPath, keyPath := cfg.ClientCert, cfg.ClientKey
		tlsCfg.GetClientCertificate = func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
			cert, err := tls.LoadX509KeyPair(certPath, keyPath)
			if err != nil {
				return nil, fmt.Errorf("load client cert: %w", err)
			}
			return &cert, nil
		}
	}
	return tlsCfg, nil
}

// connect starts the cloud link without blocking. With connect-retry enabled the
// client keeps trying in the background, so helixd stays up and serves its local
// IPC bus even when the broker is unreachable — a device must not die because the
// cloud is briefly down. onConnect fires (subscribe + drain) once the link is up.
func (t *mqttTransport) connect() {
	t.client.Connect()
}

func (t *mqttTransport) onConnect(_ mqtt.Client) {
	topic := t.prefix + "/in"
	tok := t.client.Subscribe(topic, 1, t.handleMessage)
	tok.Wait()
	if tok.Error() != nil {
		t.log.Error("mqtt subscribe failed", "topic", topic, "err", tok.Error())
		return
	}
	t.log.Info("mqtt connected", "prefix", t.prefix, "subscribed", topic)
	if t.afterConnect != nil {
		t.afterConnect()
	}
}

// connected reports whether the cloud link is currently up.
func (t *mqttTransport) connected() bool {
	return t.client != nil && t.client.IsConnected()
}

// reloadTLS forces a reconnect so a freshly rotated client certificate is
// presented on the next handshake (GetClientCertificate reloads it from disk).
func (t *mqttTransport) reloadTLS() {
	if t.client != nil && t.client.IsConnected() {
		t.client.Disconnect(250)
	}
	tok := t.client.Connect()
	tok.Wait()
	if tok.Error() != nil {
		t.log.Warn("mqtt reconnect after rotation failed", "err", tok.Error())
	}
}

func (t *mqttTransport) handleMessage(_ mqtt.Client, msg mqtt.Message) {
	var packet ipc.HelixPacket
	if err := json.Unmarshal(msg.Payload(), &packet); err != nil {
		t.log.Warn("mqtt bad packet", "topic", msg.Topic(), "err", err)
		return
	}
	if packet.Message.Service == "" {
		return
	}
	t.inbound(packet)
}

// PublishResponse sends a control HelixPacket on `.../out`.
func (t *mqttTransport) PublishResponse(packet ipc.HelixPacket) error {
	body, err := json.Marshal(packet)
	if err != nil {
		return err
	}
	tok := t.client.Publish(t.prefix+"/out", 1, false, body)
	tok.Wait()
	return tok.Error()
}

// PublishEvent sends a telemetry envelope on `.../service/<service>/event`.
func (t *mqttTransport) PublishEvent(service string, env ipc.DeviceEventEnvelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return err
	}
	topic := fmt.Sprintf("%s/service/%s/event", t.prefix, service)
	tok := t.client.Publish(topic, 1, false, body)
	tok.Wait()
	return tok.Error()
}

func (t *mqttTransport) disconnect() {
	if t.client != nil && t.client.IsConnected() {
		t.client.Disconnect(500)
	}
}
