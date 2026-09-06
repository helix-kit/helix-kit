// SPDX-License-Identifier: AGPL-3.0-only

// Package authd is the device authentication engine behind pam_helix.so.
//
// Every authentication rule lives here rather than in the PAM module: the module
// only relays a conversation over a root-only Unix socket. That boundary is what
// lets the authentication methods change without touching anything loaded into
// sshd's address space.
package authd

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

// ServiceName is the service name used for config resolution and logging.
const ServiceName = "helix-authd"

const (
	defaultAttemptTimeoutSec = 300
	defaultRequestTimeoutSec = 10
	defaultBrowserTimeoutSec = 120

	// offlineSecretKey names the shared device secret in the service secret file.
	offlineSecretKey = "OFFLINE_DEVICE_SECRET"
	// credentialKeyKey names the key persistent credential verifiers are derived
	// with. It never leaves the device.
	credentialKeyKey = "CREDENTIAL_DEVICE_KEY"
	// minSecretBytes rejects a "secret" that is really a passphrase.
	minSecretBytes = 32
)

// appConfig is the per-service section of the device config document.
type appConfig struct {
	// SocketPath overrides the default PAM socket location.
	SocketPath string `json:"socketPath,omitempty"`
	// StatePath overrides where cached authorizations are kept.
	StatePath string `json:"statePath,omitempty"`
	// AttemptTimeoutSec bounds one authentication attempt end to end.
	AttemptTimeoutSec int `json:"attemptTimeoutSec,omitempty"`
	// Authenticator selects the decision engine: "helix" talks to the control
	// plane, "stub" returns a fixed verdict for testing the PAM boundary alone.
	Authenticator string `json:"authenticator,omitempty"`
	// StubDecision is the verdict the stub returns: "approve" or "deny".
	StubDecision string            `json:"stubDecision,omitempty"`
	Cloud        cloudSection      `json:"cloud,omitempty"`
	Offline      offlineSection    `json:"offline,omitempty"`
	Persistent   persistentSection `json:"persistent,omitempty"`
}

// persistentSection configures Method 3. Like the offline method, without a
// device key the method is not offered at all.
type persistentSection struct {
	MinDurationHours int `json:"minDurationHours,omitempty"`
	MaxDurationHours int `json:"maxDurationHours,omitempty"`
	EnrollTimeoutSec int `json:"enrollTimeoutSec,omitempty"`
}

// offlineSection configures Method 2. Without a device secret the method is not
// offered at all, rather than offered and always failing.
type offlineSection struct {
	// VerificationURI is where the user goes on their phone.
	VerificationURI string `json:"verificationUri,omitempty"`
	// MaxScopeAgeSec is how long a cached authorization may still be acted on
	// once the device is offline.
	MaxScopeAgeSec  int `json:"maxScopeAgeSec,omitempty"`
	ChallengeTTLSec int `json:"challengeTtlSec,omitempty"`
	MaxAttempts     int `json:"maxAttempts,omitempty"`
}

// cloudSection points the daemon at the two control-plane surfaces it uses: the
// browser sign-in endpoints, and the device-facing API.
type cloudSection struct {
	AuthURL           string `json:"authUrl,omitempty"`
	GatewayURL        string `json:"gatewayUrl,omitempty"`
	ClientID          string `json:"clientId,omitempty"`
	RequestTimeoutSec int    `json:"requestTimeoutSec,omitempty"`
	BrowserTimeoutSec int    `json:"browserTimeoutSec,omitempty"`
	// PollIntervalSec overrides how often a pending sign-in is checked when the
	// control plane states no interval of its own.
	PollIntervalSec int `json:"pollIntervalSec,omitempty"`
}

type runner struct {
	cfg      *config.Config
	app      appConfig
	log      *slog.Logger
	auth     Authenticator
	identity identityResolver
	store    *Store

	listener net.Listener
}

// New builds the helix-authd Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	r := &runner{cfg: cfg, log: log}
	if err := cfg.AppSection(&r.app); err != nil {
		return nil, err
	}
	if r.app.SocketPath == "" {
		r.app.SocketPath = config.AuthSocketPath()
	}
	if r.app.StatePath == "" {
		r.app.StatePath = config.AuthStatePath()
	}
	if r.app.AttemptTimeoutSec <= 0 {
		r.app.AttemptTimeoutSec = defaultAttemptTimeoutSec
	}

	store, err := OpenStore(r.app.StatePath)
	if err != nil {
		return nil, err
	}
	r.store = store

	auth, err := r.buildAuthenticator()
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	r.auth = auth
	r.identity = newGetentResolver()
	return r, nil
}

// buildAuthenticator assembles the method table. A method with no implementation
// is refused at selection time rather than quietly behaving like another one.
func (r *runner) buildAuthenticator() (Authenticator, error) {
	if strings.EqualFold(r.app.Authenticator, "stub") {
		stub, err := newStubAuthenticator(r.app.StubDecision)
		if err != nil {
			return nil, err
		}
		// Loud, because a device running this authenticates nobody.
		r.log.Warn("STUB AUTHENTICATOR ENABLED: no real authentication is performed",
			"decision", r.app.StubDecision)
		return &methodAuthenticator{
			log: r.log,
			methods: map[Method]Authenticator{
				MethodOnline:     stub,
				MethodOffline:    stub,
				MethodPersistent: stub,
			},
		}, nil
	}

	token, err := r.deviceAccessToken()
	if err != nil {
		return nil, err
	}
	if r.app.Cloud.AuthURL == "" || r.app.Cloud.GatewayURL == "" {
		return nil, fmt.Errorf("cloud.authUrl and cloud.gatewayUrl are required")
	}

	cloud := NewCloud(CloudConfig{
		AuthBaseURL:    r.app.Cloud.AuthURL,
		GatewayBaseURL: r.app.Cloud.GatewayURL,
		DeviceID:       r.cfg.Device.ID,
		AccessToken:    token,
		ClientID:       r.app.Cloud.ClientID,
		Timeout:        seconds(r.app.Cloud.RequestTimeoutSec, defaultRequestTimeoutSec),
	})

	methods := map[Method]Authenticator{
		MethodOnline: &onlineAuthenticator{
			cloud:          cloud,
			store:          r.store,
			log:            r.log,
			browserTimeout: seconds(r.app.Cloud.BrowserTimeoutSec, defaultBrowserTimeoutSec),
			pollInterval:   seconds(r.app.Cloud.PollIntervalSec, 0),
		},
	}

	// The offline method needs a device secret it shares with the cloud. Without
	// one it is left unregistered, so choosing it says so plainly instead of
	// failing after a challenge nobody can answer.
	if secret, err := r.offlineSecret(); err != nil {
		return nil, err
	} else if secret != nil {
		methods[MethodOffline] = &offlineAuthenticator{
			secret:          secret,
			store:           r.store,
			log:             r.log,
			maxScopeAge:     seconds(r.app.Offline.MaxScopeAgeSec, 0),
			challengeTTL:    seconds(r.app.Offline.ChallengeTTLSec, 0),
			maxAttempts:     r.app.Offline.MaxAttempts,
			verificationURI: r.offlineVerificationURI(),
		}
	} else {
		r.log.Info("offline authentication is unavailable: no device secret configured")
	}

	// The persistent method needs its own key: the verifier it stores must not be
	// derivable from anything else the device holds.
	if key, err := r.namedSecret(credentialKeyKey); err != nil {
		return nil, err
	} else if key != nil {
		methods[MethodPersistent] = &persistentAuthenticator{
			cloud:            cloud,
			store:            r.store,
			log:              r.log,
			deviceKey:        key,
			minDurationHours: r.app.Persistent.MinDurationHours,
			maxDurationHours: r.app.Persistent.MaxDurationHours,
			enrollTimeout:    seconds(r.app.Persistent.EnrollTimeoutSec, 0),
		}
	} else {
		r.log.Info("persistent authentication is unavailable: no credential key configured")
	}

	return &methodAuthenticator{log: r.log, methods: methods}, nil
}

// offlineSecret reads the shared device secret from the service's secret file.
// It is hex encoded, and must be a real key rather than a short string.
func (r *runner) offlineSecret() ([]byte, error) { return r.namedSecret(offlineSecretKey) }

// namedSecret reads a hex-encoded key from the service secret file. A key that is
// really a short passphrase is refused rather than silently accepted.
func (r *runner) namedSecret(key string) ([]byte, error) {
	encoded, ok := r.cfg.Secret(key)
	if !ok || strings.TrimSpace(encoded) == "" {
		return nil, nil
	}
	secret, err := hex.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("%s must be hex encoded: %w", key, err)
	}
	if len(secret) < minSecretBytes {
		return nil, fmt.Errorf("%s must be at least %d bytes, got %d",
			key, minSecretBytes, len(secret))
	}
	return secret, nil
}

// offlineVerificationURI defaults to the offline page on the configured cloud.
func (r *runner) offlineVerificationURI() string {
	if r.app.Offline.VerificationURI != "" {
		return r.app.Offline.VerificationURI
	}
	return strings.TrimRight(r.app.Cloud.AuthURL, "/") + "/device/offline"
}

// deviceAccessToken reads the credential the device already uses to authenticate
// to the cloud, from the same file certificate enrollment reads.
func (r *runner) deviceAccessToken() (string, error) {
	path := r.cfg.Enrollment.AccessTokenFile
	if path == "" {
		return "", fmt.Errorf("enrollment.accessTokenFile is required to reach the cloud")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read device access token: %w", err)
	}
	token := strings.TrimSpace(string(data))
	if token == "" {
		return "", fmt.Errorf("device access token in %s is empty", path)
	}
	return token, nil
}

func seconds(configured, fallback int) time.Duration {
	if configured <= 0 {
		configured = fallback
	}
	return time.Duration(configured) * time.Second
}

// Run serves the PAM socket until the context is cancelled.
func (r *runner) Run(ctx context.Context) error {
	ln, err := r.listen()
	if err != nil {
		return err
	}
	r.listener = ln
	r.log.Info("listening", "socket", r.app.SocketPath, "device_id", r.cfg.Device.ID)

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			r.log.Warn("accept failed", "error", err)
			continue
		}
		go r.serve(ctx, conn)
	}
}

// Close removes the socket so a restart is not blocked by a stale file.
func (r *runner) Close() {
	if r.listener != nil {
		_ = r.listener.Close()
	}
	if r.store != nil {
		_ = r.store.Close()
	}
	_ = os.Remove(r.app.SocketPath)
}

// listen binds the socket with root-only access. A stale socket from an unclean
// shutdown is removed first, and the containing directory is created 0700 so the
// window between bind and chmod is not reachable by another user.
func (r *runner) listen() (net.Listener, error) {
	dir := filepath.Dir(r.app.SocketPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create %s: %w", dir, err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("chmod %s: %w", dir, err)
	}
	if err := os.Remove(r.app.SocketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("remove stale socket: %w", err)
	}

	ln, err := net.Listen("unix", r.app.SocketPath)
	if err != nil {
		return nil, fmt.Errorf("listen %s: %w", r.app.SocketPath, err)
	}
	if err := os.Chmod(r.app.SocketPath, 0o600); err != nil {
		_ = ln.Close()
		return nil, fmt.Errorf("chmod socket: %w", err)
	}
	return ln, nil
}

func (r *runner) serve(ctx context.Context, conn net.Conn) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(r.app.AttemptTimeoutSec)*time.Second)
	defer cancel()

	s := newSession(conn, r.auth, r.identity, r.cfg.Device.ID, r.log)
	s.run(ctx)
}
