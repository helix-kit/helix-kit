// SPDX-License-Identifier: AGPL-3.0-only

// Command helixd is the app-agnostic device core bridging the cloud MQTT link and local IPC bus.
package main

import (
	"log/slog"

	"github.com/helix-kit/helix-device/internal/core"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: "helixd",
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup: func(cfg *config.Config, log *slog.Logger) (servicemain.Runner, error) {
			return core.NewService(cfg, log)
		},
	})
}
