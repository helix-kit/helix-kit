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
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

// ServiceName is the service name used for config resolution and logging.
const ServiceName = "helix-authd"

// appConfig is the per-service section of the device config document.
type appConfig struct {
	// SocketPath overrides the default PAM socket location.
	SocketPath string `json:"socketPath,omitempty"`
	// AttemptTimeoutSec bounds one authentication attempt end to end.
	AttemptTimeoutSec int `json:"attemptTimeoutSec,omitempty"`
	// StubDecision drives the phase-1 placeholder authenticator: "approve" or
	// "deny". It disappears once the real methods land.
	StubDecision string `json:"stubDecision,omitempty"`
}

type runner struct {
	cfg      *config.Config
	app      appConfig
	log      *slog.Logger
	auth     Authenticator
	identity identityResolver

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
	if r.app.AttemptTimeoutSec <= 0 {
		r.app.AttemptTimeoutSec = 300
	}

	auth, err := newStubAuthenticator(r.app.StubDecision)
	if err != nil {
		return nil, err
	}
	r.auth = auth
	r.identity = newGetentResolver()
	return r, nil
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
