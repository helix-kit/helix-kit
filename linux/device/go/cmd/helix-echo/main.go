// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-echo is a smoke-test app that answers "ping" with "pong".
package main

import (
	"github.com/helix-kit/helix-device/internal/echo"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: echo.ServiceName,
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       echo.New,
	})
}
