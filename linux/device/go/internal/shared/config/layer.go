// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// Load resolves the effective configuration for one service by layering, from
// lowest to highest precedence:
//
//  1. the shared device document /etc/helix/config.json (device, mqtt, ipc,
//     gateway, spool, enrollment) — common to every service;
//  2. the package-shipped default section /usr/lib/helix/defaults/<service>.json;
//  3. the admin/remote drop-in /etc/helix/conf.d/<service>.json;
//  4. the 0600 secret overlay /etc/helix/secrets/<service>.env.
//
// Layers 2–3 form the per-service "app section" (deep-merged), decoded on demand
// via AppSection. The shared document is required; the per-service layers are
// optional. Computed defaults are applied and the result is validated.
func Load(service string) (*Config, error) {
	shared, err := os.ReadFile(MainConfigPath())
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", MainConfigPath(), err)
	}
	var c Config
	if err = json.Unmarshal(shared, &c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", MainConfigPath(), err)
	}
	c.service = service

	app, err := mergeJSONFiles(DefaultConfigPath(service), DropInPath(service))
	if err != nil {
		return nil, err
	}
	c.app = app

	secrets, err := loadSecrets(service)
	if err != nil {
		return nil, err
	}
	c.secrets = secrets

	c.applyDefaults()
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("config for %q: %w", service, err)
	}
	return &c, nil
}

// mergeJSONFiles deep-merges the given JSON object files in order (later wins),
// skipping any that are absent, and returns the merged document. Returns a nil
// slice when no file is present.
func mergeJSONFiles(paths ...string) (json.RawMessage, error) {
	var acc map[string]any
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("read %s: %w", p, err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, fmt.Errorf("parse %s: %w", p, err)
		}
		if acc == nil {
			acc = m
			continue
		}
		acc = deepMerge(acc, m)
	}
	if acc == nil {
		return nil, nil
	}
	out, err := json.Marshal(acc)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// deepMerge recursively merges src onto dst: nested objects merge key-by-key,
// while scalars, arrays, and mismatched types replace wholesale (src wins).
func deepMerge(dst, src map[string]any) map[string]any {
	for k, sv := range src {
		if dv, ok := dst[k]; ok {
			dm, dok := dv.(map[string]any)
			sm, sok := sv.(map[string]any)
			if dok && sok {
				dst[k] = deepMerge(dm, sm)
				continue
			}
		}
		dst[k] = sv
	}
	return dst
}
