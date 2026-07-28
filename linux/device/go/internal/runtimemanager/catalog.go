// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/helix-kit/helix-device/internal/pkg"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

// loadDesired computes the desired managed-service set: the reconciled catalog
// the installer maintains (managed-services.json, sourced from installed
// packages) plus any package-shipped seeds under /usr/lib/helix/catalog that are
// not already present. The installed catalog wins on name collisions.
func loadDesired() ([]pkg.ServiceDescriptor, error) {
	ms, err := pkg.LoadManagedServices()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, s := range ms.Services {
		seen[s.Name] = true
	}

	seeds, err := filepath.Glob(filepath.Join(config.CatalogDir(), "*.service.json"))
	if err != nil {
		return nil, err
	}
	for _, path := range seeds {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var d pkg.ServiceDescriptor
		if err := json.Unmarshal(data, &d); err != nil {
			return nil, err
		}
		if d.Name != "" && !seen[d.Name] {
			ms.Services = append(ms.Services, d)
			seen[d.Name] = true
		}
	}
	return ms.Services, nil
}
