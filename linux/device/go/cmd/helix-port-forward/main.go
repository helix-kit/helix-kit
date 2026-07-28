// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-port-forward is the device port-forwarding app.
package main

import (
	"github.com/helix-kit/helix-device/internal/portforward"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: portforward.ServiceName,
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       portforward.New,
	})
}
