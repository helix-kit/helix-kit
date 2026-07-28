// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"time"

	"github.com/helix-kit/helix-device/internal/metricsplugin"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

// providerTimeout bounds how long a single provider may run before it is killed,
// so a hung or slow plugin never stalls a metrics sample.
const providerTimeout = 3 * time.Second

// HostMetrics is the merged host/hardware view: one entry per provider plus any
// per-provider errors. Providers are hardware-specific and open-ended, so the
// metric trees are unstructured.
type HostMetrics struct {
	Providers map[string]ProviderReport `json:"providers"`
	Errors    map[string]string         `json:"errors,omitempty"`
}

// ProviderReport is one provider's contribution.
type ProviderReport struct {
	HardwareProfile string         `json:"hardwareProfile,omitempty"`
	Metrics         map[string]any `json:"metrics"`
}

// runProviders discovers and runs every host-metrics provider executable in the
// plugin dir, merging their outputs. Discovery happens every sample, so a
// newly installed provider package is picked up with no runtime-manager restart.
// An optional allow-list (by executable basename) narrows what runs.
func runProviders(ctx context.Context, cfg config.Metrics) HostMetrics {
	dir := cfg.PluginDir
	if dir == "" {
		dir = config.MetricsPluginDir()
	}
	host := HostMetrics{Providers: map[string]ProviderReport{}}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return host // no plugin dir yet → no host metrics
	}
	allow := map[string]bool{}
	for _, p := range cfg.Providers {
		allow[p] = true
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		if len(allow) > 0 && !allow[name] {
			continue
		}
		path := filepath.Join(dir, name)
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || info.Mode()&0o111 == 0 {
			continue
		}
		out, err := runProvider(ctx, path)
		if err != nil {
			if host.Errors == nil {
				host.Errors = map[string]string{}
			}
			host.Errors[name] = err.Error()
			continue
		}
		key := out.Provider
		if key == "" {
			key = name
		}
		host.Providers[key] = ProviderReport{HardwareProfile: out.HardwareProfile, Metrics: out.Metrics}
	}
	return host
}

func runProvider(ctx context.Context, path string) (metricsplugin.Output, error) {
	runCtx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, path)
	stdout, err := cmd.Output()
	if err != nil {
		return metricsplugin.Output{}, err
	}
	var out metricsplugin.Output
	if err := json.Unmarshal(stdout, &out); err != nil {
		return metricsplugin.Output{}, err
	}
	return out, nil
}
