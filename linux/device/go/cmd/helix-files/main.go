// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-files is the device file-browser app.
package main

import (
	"github.com/helix-kit/helix-device/internal/files"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/servicemain"
)

func main() {
	servicemain.Run(servicemain.Options[*config.Config]{
		ServiceName: files.ServiceName,
		Version:     "0.1.0",
		LoadConfig:  config.Load,
		Setup:       files.New,
	})
}
