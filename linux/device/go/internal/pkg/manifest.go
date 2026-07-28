// SPDX-License-Identifier: AGPL-3.0-only

// Package pkg is the Helix device package system: an apt/dpkg-inspired .helixpkg format and package manager for delivering and supervising device services.
package pkg

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
)

// ControlFileName is the manifest entry at the root of a .helixpkg.
const ControlFileName = "helix-control.json"

// Kind is how a package's payload is materialized.
type Kind string

const (
	// KindGoBinary ships a static executable (payload places it under /usr/lib/helix/bin).
	KindGoBinary Kind = "go-binary"
	// KindPython ships a wheel + deps; SetupCommand builds a venv under the package dir.
	KindPython Kind = "python"
	// KindUIBundle ships static web assets; usually declares no service.
	KindUIBundle Kind = "ui-bundle"
	// KindAsset ships generic files placed by the payload overlay.
	KindAsset Kind = "asset"
)

// Conffile is a payload file whose local modifications survive upgrades (dpkg 3-way).
type Conffile struct {
	Path  string `json:"path"`
	Mode  string `json:"mode,omitempty"`  // octal, e.g. "0640"
	Owner string `json:"owner,omitempty"` // e.g. "root:helix"
}

// Manifest is a package's control document.
type Manifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	Name          string `json:"name"`
	Version       string `json:"version"`
	Kind          Kind   `json:"kind"`

	Depends   []string `json:"depends,omitempty"`
	Provides  []string `json:"provides,omitempty"`
	Conflicts []string `json:"conflicts,omitempty"`

	// MaintainerScripts maps a hook name (preconfigure/preinst/postinst/prerm/postrm/postconfigure) to its path in the package.
	MaintainerScripts map[string]string `json:"maintainerScripts,omitempty"`

	Conffiles []Conffile `json:"conffiles,omitempty"`

	// SetupCommand runs after payload extraction, with cwd set to the package payload dir.
	SetupCommand []string `json:"setupCommand,omitempty"`

	// Service is the managed-service descriptor, if this package runs one.
	Service *ServiceDescriptor `json:"service,omitempty"`
}

var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Validate checks the manifest for the invariants the installer relies on.
func (m *Manifest) Validate() error {
	if m.SchemaVersion != 1 {
		return fmt.Errorf("unsupported schemaVersion %d", m.SchemaVersion)
	}
	if !nameRE.MatchString(m.Name) {
		return fmt.Errorf("invalid package name %q", m.Name)
	}
	if _, err := parseVersion(m.Version); err != nil {
		return fmt.Errorf("invalid version %q: %w", m.Version, err)
	}
	switch m.Kind {
	case KindGoBinary, KindPython, KindUIBundle, KindAsset:
	default:
		return fmt.Errorf("unknown kind %q", m.Kind)
	}
	if m.Service != nil {
		if m.Service.Name == "" {
			m.Service.Name = m.Name
		}
		if len(m.Service.ExecStart) == 0 {
			return fmt.Errorf("service %q has no execStart", m.Service.Name)
		}
	}
	return nil
}

// ReadManifest reads and validates the control manifest from a .helixpkg.
func ReadManifest(pkgPath string) (*Manifest, error) {
	f, err := os.Open(pkgPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("gzip %s: %w", pkgPath, err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if h.Name == ControlFileName {
			data, err := io.ReadAll(tr)
			if err != nil {
				return nil, err
			}
			var m Manifest
			if err := json.Unmarshal(data, &m); err != nil {
				return nil, fmt.Errorf("parse %s: %w", ControlFileName, err)
			}
			if err := m.Validate(); err != nil {
				return nil, err
			}
			return &m, nil
		}
	}
	return nil, fmt.Errorf("%s: missing %s", pkgPath, ControlFileName)
}
