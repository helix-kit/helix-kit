// SPDX-License-Identifier: AGPL-3.0-only

// Package runtimemanager is the Helix device root daemon that reconciles installed packages into supervised systemd services and exposes a local + cloud control API.
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
		// Not fatal: keep the control API up so an operator can repair the device.
		m.log.Warn("initial reconcile failed", "err", err)
	} else {
		m.log.Info("reconciled managed services")
	}

	go m.collector.Loop(ctx)
	go m.ctrl.registerRuntimeService(ctx, m.cfg.IPC.SocketPath)
	return m.ctrl.ServeControlSocket(ctx)
}

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
