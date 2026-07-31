// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/helix-kit/helix-device/internal/ipc"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/netutil"
)

type inboundFunc func(packet ipc.HelixPacket)

type mqttTransport struct {
	client  mqtt.Client
	prefix  string
	log     *slog.Logger
	inbound inboundFunc
	// afterConnect kicks the spool drain once the link is back.
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

	var brokerTLS *tls.Config
	if strings.HasPrefix(cfg.BrokerURL, "tls://") || strings.HasPrefix(cfg.BrokerURL, "ssl://") ||
		strings.HasPrefix(cfg.BrokerURL, "mqtts://") {
		tlsCfg, err := buildTLS(cfg)
		if err != nil {
			return nil, err
		}
		brokerTLS = tlsCfg
		opts.SetTLSConfig(tlsCfg)
	}
	opts.SetCustomOpenConnectionFn(func(uri *url.URL, _ mqtt.ClientOptions) (net.Conn, error) {
		return netutil.Shared().DialBroker(context.Background(), uri, brokerTLS)
	})

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
		// Load the key pair per handshake so cert rotation is picked up on reconnect.
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

// connect starts the cloud link without blocking; connect-retry runs in the background.
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

func (t *mqttTransport) connected() bool {
	return t.client != nil && t.client.IsConnected()
}

// reloadTLS forces a reconnect so a rotated client cert is presented next handshake.
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
