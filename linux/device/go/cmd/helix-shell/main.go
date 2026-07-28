// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-shell is the device remote-shell app.
package main

import (
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
	"github.com/helix-kit/helix-device/internal/shell"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: shell.ServiceName,
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       shell.New,
	})
}
