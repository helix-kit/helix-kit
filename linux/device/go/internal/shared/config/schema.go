// SPDX-License-Identifier: AGPL-3.0-only

// Package config is the on-device runtime configuration shared by helixd and apps.
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

// ClientTLS builds a client TLS config, or nil if no CA and no client cert are set.
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
	BrokerURL    string `json:"brokerUrl"`
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
	StreamURL  string `json:"streamUrl,omitempty"`
	CACert     string `json:"caCert,omitempty"`
	ClientCert string `json:"clientCert,omitempty"`
	ClientKey  string `json:"clientKey,omitempty"`
}

// Spool configures helixd's store-and-forward event spool.
type Spool struct {
	Path     string `json:"path,omitempty"`
	MaxBytes int64  `json:"maxBytes,omitempty"` // 0 = unbounded
}

// Enrollment configures helixd's CSR-based certificate enrollment and rotation.
type Enrollment struct {
	APIURL          string `json:"apiUrl,omitempty"`
	AccessTokenFile string `json:"accessTokenFile,omitempty"`
}

// Metrics configures runtime-manager's metrics sampler.
type Metrics struct {
	// Providers is an allow-list of provider basenames; empty runs all discovered.
	Providers []string `json:"providers,omitempty"`
	PluginDir string `json:"pluginDir,omitempty"`
	IntervalSec int `json:"intervalSec,omitempty"` // default 5
}

// Config is the shared device document plus the resolved per-service section.
type Config struct {
	SchemaVersion int        `json:"schemaVersion,omitempty"`
	Device        Device     `json:"device"`
	MQTT          MQTT       `json:"mqtt"`
	IPC           IPC        `json:"ipc"`
	Gateway       Gateway    `json:"gateway"`
	Spool         Spool      `json:"spool,omitempty"`
	Enrollment    Enrollment `json:"enrollment,omitempty"`
	Metrics       Metrics    `json:"metrics,omitempty"`

	service string
	app json.RawMessage
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
