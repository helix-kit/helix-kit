// SPDX-License-Identifier: AGPL-3.0-only

// Package metricsplugin defines the contract between runtime-manager and a
// hardware host-metrics provider. A provider is any executable in the metrics
// plugin dir that, when run, prints exactly one JSON Output object to stdout and
// exits 0. runtime-manager discovers and runs providers without knowing anything
// about the hardware, so a new board type is added by shipping a new provider
// executable (as a .helixpkg) — never by rebuilding runtime-manager.
//
// A provider may be written in any language; this package is a convenience for
// Go providers (the type + Emit). Non-Go providers just print the same JSON.
package metricsplugin

import (
	"encoding/json"
	"os"
)

// Output is one provider's contribution to the host metrics. Metrics is an
// open, provider-defined object — generic providers report cpu/memory/disk,
// while a board provider might report npu/gpu/videoEngine/thermal, etc.
type Output struct {
	// Provider is the stable key this provider's metrics are filed under.
	Provider string `json:"provider"`
	// HardwareProfile is an optional label (e.g. "radxa-a733", "jetson-nano").
	HardwareProfile string `json:"hardwareProfile,omitempty"`
	// Metrics is the arbitrary, hardware-specific metric tree.
	Metrics map[string]any `json:"metrics"`
}

// Emit writes the output as a single JSON line to stdout — the whole provider
// protocol for a Go provider is: build an Output, call Emit, exit.
func Emit(o Output) error {
	enc := json.NewEncoder(os.Stdout)
	return enc.Encode(o)
}
