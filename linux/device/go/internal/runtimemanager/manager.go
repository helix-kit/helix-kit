// SPDX-License-Identifier: AGPL-3.0-only

// Package runtimemanager is the Helix device runtime-manager: the root daemon
// that turns installed packages into supervised systemd services. It reconciles
// the managed-service catalog onto systemd on boot (auto-start), and exposes a
// control API — a local socket for the CLI and the cloud-facing `runtime` IPC
// service — for install/remove, start/stop/restart, and remote config writes.
package runtimemanager

import (
	"context"
	"log/slog"
	"os"

	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

// Manager is the runtime-manager Runner.
type Manager struct {
	cfg       *config.Config
	log       *slog.Logger
	sd        Systemd
	collector *Collector
	ctrl      *Controller
}

// New builds the runtime-manager Runner.
func New(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
	sd := NewSystemd()
	collector := NewCollector(sd, cfg.Metrics)
	return &Manager{
		cfg: cfg, log: log, sd: sd, collector: collector,
		ctrl: NewController(sd, collector, log),
	}, nil
}

// Run reconciles once on boot, then serves the control API until shutdown.
func (m *Manager) Run(ctx context.Context) error {
	if err := ensureLayout(); err != nil {
		return err
	}
	if err := Reconcile(m.sd, m.log); err != nil {
		// A reconcile failure at boot is logged, not fatal: the control API stays
		// up so an operator can repair the device.
		m.log.Warn("initial reconcile failed", "err", err)
	} else {
		m.log.Info("reconciled managed services")
	}

	go m.collector.Loop(ctx)
	go m.ctrl.registerRuntimeService(ctx, m.cfg.IPC.SocketPath)
	return m.ctrl.ServeControlSocket(ctx)
}

// ensureLayout creates the mutable runtime directories runtime-manager and the
// installer rely on.
func ensureLayout() error {
	for _, dir := range []string{
		config.DBDir(), config.ConfDir(), config.SecretsDir(),
		config.TmpDir(), config.RunDir(), config.PackagesDir(),
		config.SystemdUnitDir(), config.MetricsPluginDir(),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	// Secrets dir must not be world/group readable.
	_ = os.Chmod(config.SecretsDir(), 0o750)
	return nil
}
