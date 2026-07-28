// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-runtime-manager is the root daemon that supervises Helix device
// services via systemd: it reconciles the installed-package catalog onto systemd
// units on boot and serves the runtime control API.
package main

import (
	"github.com/helix-kit/helix-device/internal/runtimemanager"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: "runtime",
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       runtimemanager.New,
	})
}
