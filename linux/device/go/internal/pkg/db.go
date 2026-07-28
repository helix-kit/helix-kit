// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"encoding/json"
	"os"
	"sort"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// Package status values (dpkg-inspired).
const (
	// StatusInstalled: payload present, fully configured.
	StatusInstalled = "installed"
	// StatusConfigFiles: package removed but its conffiles were kept (not purged).
	StatusConfigFiles = "config-files"
	// StatusHalfInstalled: an install/upgrade failed after activation; needs repair.
	StatusHalfInstalled = "half-installed"
)

// ConffileState records a tracked conffile's default and on-disk hashes (dpkg 3-way).
type ConffileState struct {
	Path         string `json:"path"`
	InstalledSHA string `json:"installedSha"`
	DefaultSHA   string `json:"defaultSha"`
}

// DBEntry is one installed package's record.
type DBEntry struct {
	Name        string             `json:"name"`
	Version     string             `json:"version"`
	Kind        Kind               `json:"kind"`
	Status      string             `json:"status"`
	SHA256      string             `json:"sha256"`
	Files       []string           `json:"files"`
	Conffiles   []ConffileState    `json:"conffiles,omitempty"`
	Service     *ServiceDescriptor `json:"service,omitempty"`
	InstalledAt string             `json:"installedAt"`
}

// DB is the installed-package database, persisted at config.PackageDBPath().
type DB struct {
	Entries map[string]*DBEntry `json:"entries"`
}

// LoadDB reads the package DB, returning an empty DB if none exists.
func LoadDB() (*DB, error) {
	data, err := os.ReadFile(config.PackageDBPath())
	if err != nil {
		if os.IsNotExist(err) {
			return &DB{Entries: map[string]*DBEntry{}}, nil
		}
		return nil, err
	}
	var db DB
	if err := json.Unmarshal(data, &db); err != nil {
		return nil, err
	}
	if db.Entries == nil {
		db.Entries = map[string]*DBEntry{}
	}
	return &db, nil
}

// Get returns the entry for name, or nil.
func (db *DB) Get(name string) *DBEntry { return db.Entries[name] }

// Put inserts or replaces an entry.
func (db *DB) Put(e *DBEntry) { db.Entries[e.Name] = e }

// Delete removes an entry.
func (db *DB) Delete(name string) { delete(db.Entries, name) }

// List returns all entries sorted by name.
func (db *DB) List() []*DBEntry {
	out := make([]*DBEntry, 0, len(db.Entries))
	for _, e := range db.Entries {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Save writes the DB atomically.
func (db *DB) Save() error {
	if err := os.MkdirAll(config.DBDir(), 0o755); err != nil {
		return err
	}
	return writeFileAtomic(config.PackageDBPath(), db, 0o640)
}
