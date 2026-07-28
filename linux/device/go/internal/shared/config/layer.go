// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// Load resolves the effective config for one service by layering the shared
// document, package defaults, admin drop-in, and secret overlay.
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

// deepMerge merges src onto dst; nested objects merge key-by-key, everything else replaces.
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
