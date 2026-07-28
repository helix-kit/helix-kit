// SPDX-License-Identifier: AGPL-3.0-only

// Package config is the on-device runtime configuration shared by helixd and
// every app. It follows the Linux FHS drop-in convention: a package ships its
// defaults read-only under /usr/lib/helix, the admin (or the cloud, via
// runtime-manager) overrides them in /etc/helix, and secrets live in separate
// 0600 files that are never world-readable. Load resolves the effective config
// for one service by layering those sources; see layer.go.
package config

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"os"
)

// SchemaVersion is the current config document version.
const SchemaVersion = 1

// ClientTLS builds a client TLS config (mTLS if a client cert is set). Returns
// nil if no CA and no client cert are configured (plaintext dev connections).
func ClientTLS(caCert, clientCert, clientKey string) (*tls.Config, error) {
	if caCert == "" && clientCert == "" {
		return nil, nil
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caCert != "" {
		ca, err := os.ReadFile(caCert)
		if err != nil {
			return nil, fmt.Errorf("read ca: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(ca) {
			return nil, fmt.Errorf("invalid ca cert")
		}
		cfg.RootCAs = pool
	}
	if clientCert != "" && clientKey != "" {
		cert, err := tls.LoadX509KeyPair(clientCert, clientKey)
		if err != nil {
			return nil, fmt.Errorf("load client cert: %w", err)
		}
		cfg.Certificates = []tls.Certificate{cert}
	}
	return cfg, nil
}

// Device identifies this device to the cloud.
type Device struct {
	ID string `json:"id"`
}

// MQTT is the cloud control-plane transport.
type MQTT struct {
	BrokerURL    string `json:"brokerUrl"` // e.g. tls://broker:8883 or tcp://broker:1883
	CACert       string `json:"caCert,omitempty"`
	ClientCert   string `json:"clientCert,omitempty"`
	ClientKey    string `json:"clientKey,omitempty"`
	KeepaliveSec int    `json:"keepaliveSec,omitempty"`
}

// IPC is the local Unix-socket bus between helixd and apps.
type IPC struct {
	SocketPath string `json:"socketPath,omitempty"`
}

// Gateway is where apps dial their data-plane (bytestream) connections.
type Gateway struct {
	StreamURL  string `json:"streamUrl,omitempty"` // e.g. wss://gw/__stream__
	CACert     string `json:"caCert,omitempty"`
	ClientCert string `json:"clientCert,omitempty"`
	ClientKey  string `json:"clientKey,omitempty"`
}

// Spool configures helixd's store-and-forward event spool.
type Spool struct {
	Path     string `json:"path,omitempty"`     // default config.SpoolPath()
	MaxBytes int64  `json:"maxBytes,omitempty"` // 0 = unbounded
}

// Enrollment configures helixd's CSR-based certificate enrollment and rotation.
type Enrollment struct {
	APIURL          string `json:"apiUrl,omitempty"`          // e.g. https://host/api/certificates/device
	AccessTokenFile string `json:"accessTokenFile,omitempty"` // path to the bearer token (a secret file)
}

// Metrics configures runtime-manager's metrics sampler.
type Metrics struct {
	// Providers is an optional allow-list of host-metrics provider names (by
	// executable basename); empty runs every discovered provider.
	Providers []string `json:"providers,omitempty"`
	// PluginDir overrides the default metrics plugin directory.
	PluginDir string `json:"pluginDir,omitempty"`
	// IntervalSec is the sampling interval (default 5).
	IntervalSec int `json:"intervalSec,omitempty"`
}

// Config is the shared device document plus the resolved per-service section.
// The shared fields come from /etc/helix/config.json; the app section is the
// deep-merge of the package default and the admin/remote drop-in, decoded on
// demand via AppSection. Secrets are the parsed 0600 EnvironmentFile overlay.
type Config struct {
	SchemaVersion int        `json:"schemaVersion,omitempty"`
	Device        Device     `json:"device"`
	MQTT          MQTT       `json:"mqtt"`
	IPC           IPC        `json:"ipc"`
	Gateway       Gateway    `json:"gateway"`
	Spool         Spool      `json:"spool,omitempty"`
	Enrollment    Enrollment `json:"enrollment,omitempty"`
	Metrics       Metrics    `json:"metrics,omitempty"`

	// service is the name this config was resolved for.
	service string
	// app is the resolved per-service section (defaults merged with drop-in).
	app json.RawMessage
	// secrets is the parsed per-service EnvironmentFile overlay.
	secrets map[string]string
}

// Service returns the service name this config was resolved for.
func (c *Config) Service() string { return c.service }

// AppSection decodes the resolved per-service config section into dest. If the
// service ships no default and has no drop-in, dest is left at its zero value.
func (c *Config) AppSection(dest any) error {
	if len(c.app) == 0 {
		return nil
	}
	return json.Unmarshal(c.app, dest)
}

// Secret returns a value from the service's EnvironmentFile secret overlay.
func (c *Config) Secret(key string) (string, bool) {
	v, ok := c.secrets[key]
	return v, ok
}

// Validate checks the resolved config for the invariants every service needs.
func (c *Config) Validate() error {
	if c.Device.ID == "" {
		return fmt.Errorf("device.id is required")
	}
	if c.MQTT.BrokerURL == "" {
		return fmt.Errorf("mqtt.brokerUrl is required")
	}
	return nil
}

// applyDefaults fills computed defaults for zero-valued fields.
func (c *Config) applyDefaults() {
	if c.IPC.SocketPath == "" {
		c.IPC.SocketPath = IPCSocketPath()
	}
	if c.MQTT.KeepaliveSec == 0 {
		c.MQTT.KeepaliveSec = 30
	}
	if c.Spool.Path == "" {
		c.Spool.Path = SpoolPath()
	}
	if c.Metrics.PluginDir == "" {
		c.Metrics.PluginDir = MetricsPluginDir()
	}
	if c.Metrics.IntervalSec == 0 {
		c.Metrics.IntervalSec = 5
	}
}
