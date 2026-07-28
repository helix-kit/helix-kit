// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// ServiceDescriptor is the managed-service block a package declares in its
// control manifest. It is the device-side generalization of a systemd unit: it
// tells runtime-manager how to render and supervise the service. It carries no
// package payload details — only supervision intent.
type ServiceDescriptor struct {
	// Name is the service name (defaults to the package name when omitted).
	Name string `json:"name,omitempty"`
	// Core services (e.g. helixd) are reconciled before everything else.
	Core bool `json:"core"`
	// Enabled means the unit is started on boot and enabled in systemd.
	Enabled bool `json:"enabled"`
	// AllowControl gates cloud-initiated start/stop/restart.
	AllowControl bool `json:"allowControl"`
	// AllowUpdate gates cloud-initiated package upgrades.
	AllowUpdate bool `json:"allowUpdate"`

	ExecStart        []string          `json:"execStart"`
	User             string            `json:"user,omitempty"`
	Group            string            `json:"group,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	EnvironmentFiles []string          `json:"environmentFiles,omitempty"`
	WorkingDirectory string            `json:"workingDirectory,omitempty"`

	Restart    string `json:"restart,omitempty"`    // systemd Restart= (default on-failure)
	RestartSec int    `json:"restartSec,omitempty"` // default 2

	After    []string `json:"after,omitempty"`
	Requires []string `json:"requires,omitempty"`
	WantedBy []string `json:"wantedBy,omitempty"` // default helix.target
}

// UnitName is the systemd unit name for this service.
func (d *ServiceDescriptor) UnitName() string { return "helix-" + d.Name + ".service" }

// ManagedServices is the reconciled catalog runtime-manager consumes: the set of
// service descriptors from all installed packages, plus any shipped catalog
// seeds. It is persisted at config.ManagedServicesPath().
type ManagedServices struct {
	Services []ServiceDescriptor `json:"services"`
}

// LoadManagedServices reads the reconciled catalog, returning an empty catalog
// if the file does not exist yet.
func LoadManagedServices() (*ManagedServices, error) {
	data, err := os.ReadFile(config.ManagedServicesPath())
	if err != nil {
		if os.IsNotExist(err) {
			return &ManagedServices{}, nil
		}
		return nil, err
	}
	var m ManagedServices
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse managed services: %w", err)
	}
	return &m, nil
}

// Get returns the descriptor for a service name, or nil.
func (m *ManagedServices) Get(name string) *ServiceDescriptor {
	for i := range m.Services {
		if m.Services[i].Name == name {
			return &m.Services[i]
		}
	}
	return nil
}

// Upsert inserts or replaces a service descriptor by name.
func (m *ManagedServices) Upsert(d ServiceDescriptor) {
	for i := range m.Services {
		if m.Services[i].Name == d.Name {
			m.Services[i] = d
			return
		}
	}
	m.Services = append(m.Services, d)
}

// Remove drops a service descriptor by name.
func (m *ManagedServices) Remove(name string) {
	out := m.Services[:0]
	for _, s := range m.Services {
		if s.Name != name {
			out = append(out, s)
		}
	}
	m.Services = out
}

// Save writes the catalog atomically, sorted by name for a stable file.
func (m *ManagedServices) Save() error {
	sort.Slice(m.Services, func(i, j int) bool { return m.Services[i].Name < m.Services[j].Name })
	if err := os.MkdirAll(config.DBDir(), 0o755); err != nil {
		return err
	}
	return writeFileAtomic(config.ManagedServicesPath(), m, 0o640)
}

// writeFileAtomic marshals v as indented JSON and writes it via a temp file +
// rename so readers never see a partial document.
func writeFileAtomic(path string, v any, mode os.FileMode) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
