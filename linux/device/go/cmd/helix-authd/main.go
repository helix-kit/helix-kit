// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-authd is the device authentication engine that pam_helix.so
// consults over a root-only Unix socket.
package main

import (
	"github.com/helix-kit/helix-device/internal/authd"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: authd.ServiceName,
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       authd.New,
	})
}
