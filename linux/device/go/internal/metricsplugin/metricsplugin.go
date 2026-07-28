// SPDX-License-Identifier: AGPL-3.0-only

// Package metricsplugin is the contract between runtime-manager and a host-metrics provider executable.
package metricsplugin

import (
	"encoding/json"
	"os"
)

// Output is one provider's contribution to the host metrics.
type Output struct {
	// Provider is the stable key this provider's metrics are filed under.
	Provider string `json:"provider"`
	// HardwareProfile is an optional label (e.g. "radxa-a733", "jetson-nano").
	HardwareProfile string `json:"hardwareProfile,omitempty"`
	// Metrics is the arbitrary, hardware-specific metric tree.
	Metrics map[string]any `json:"metrics"`
}

// Emit writes the output as a single JSON line to stdout.
func Emit(o Output) error {
	enc := json.NewEncoder(os.Stdout)
	return enc.Encode(o)
}
