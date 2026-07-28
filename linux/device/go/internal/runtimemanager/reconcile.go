// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"log/slog"
	"path/filepath"
	"sort"
	"strings"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// Reconcile brings systemd into line with the desired managed-service catalog:
// it renders/updates units for every desired service, removes units for
// services no longer present, enables/starts (or disables/stops) each per its
// Enabled flag, and reloads the daemon when anything changed. Core services are
// processed first. It is safe to call on boot and after every install/remove.
func Reconcile(sd Systemd, log *slog.Logger) error {
	desired, err := loadDesired()
	if err != nil {
		return err
	}
	// Core first, then stable by name.
	sort.SliceStable(desired, func(i, j int) bool {
		if desired[i].Core != desired[j].Core {
			return desired[i].Core
		}
		return desired[i].Name < desired[j].Name
	})

	desiredUnits := map[string]bool{}
	changed := false
	for i := range desired {
		desiredUnits[desired[i].UnitName()] = true
	}

	// Remove units for services that vanished from the catalog.
	stale, err := staleManagedUnits(desiredUnits)
	if err != nil {
		return err
	}
	for _, unit := range stale {
		name := unitToService(unit)
		log.Info("removing stale service", "service", name)
		_ = sd.Stop(unit)
		_ = sd.Disable(unit)
		if err := RemoveUnit(name); err != nil {
			return err
		}
		changed = true
	}

	for i := range desired {
		d := &desired[i]
		wrote, err := WriteUnit(d)
		if err != nil {
			return err
		}
		changed = changed || wrote
	}
	if changed {
		if err := sd.DaemonReload(); err != nil {
			return err
		}
	}

	// Apply enable/start state. Do this after daemon-reload so systemd sees the
	// current unit definitions.
	for i := range desired {
		d := &desired[i]
		unit := d.UnitName()
		if d.Enabled {
			if err := sd.Enable(unit); err != nil {
				log.Warn("enable failed", "unit", unit, "err", err)
			}
			if err := ensureStarted(sd, unit, log); err != nil {
				log.Warn("start failed", "unit", unit, "err", err)
			}
		} else {
			_ = sd.Disable(unit)
			_ = sd.Stop(unit)
		}
	}
	return nil
}

// ensureStarted (re)starts a unit unless it is already active.
func ensureStarted(sd Systemd, unit string, log *slog.Logger) error {
	st, err := sd.Show(unit)
	if err == nil && st.ActiveState == "active" {
		return nil
	}
	log.Info("starting service", "unit", unit)
	return sd.Start(unit)
}

// staleManagedUnits lists rendered helix-*.service unit files that are no longer
// desired.
func staleManagedUnits(desired map[string]bool) ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(config.SystemdUnitDir(), "helix-*.service"))
	if err != nil {
		return nil, err
	}
	var stale []string
	for _, path := range matches {
		unit := filepath.Base(path)
		if !desired[unit] {
			stale = append(stale, unit)
		}
	}
	return stale, nil
}

// unitToService maps helix-<name>.service back to <name>.
func unitToService(unit string) string {
	return strings.TrimSuffix(strings.TrimPrefix(unit, "helix-"), ".service")
}
