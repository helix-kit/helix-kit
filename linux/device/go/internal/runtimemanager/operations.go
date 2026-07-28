// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/helix-kit/helix-device/internal/pkg"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

var serviceNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// serviceGroup is the group all Helix services run as; config drop-ins are
// chowned to it so a service can read its own config.
const serviceGroup = "helix"

// chownServiceGroup best-effort chowns a path to root:helix. It is a no-op when
// the group is absent or the caller is unprivileged (tests).
func chownServiceGroup(path string) {
	g, err := user.LookupGroup(serviceGroup)
	if err != nil {
		return
	}
	gid, err := strconv.Atoi(g.Gid)
	if err != nil {
		return
	}
	_ = os.Chown(path, 0, gid)
}

// coreServices are static (base-image) units runtime-manager may restart for
// config changes but does not itself reconcile.
var coreServices = map[string]string{"helixd": "helixd.service"}

// InstallPackage installs (or upgrades) a package from a local .helixpkg. It
// stops a running predecessor, runs the installer in an isolated transient unit,
// then reconciles the new service onto systemd.
func InstallPackage(sd Systemd, localPath, sha string, log *slog.Logger) (*pkg.Manifest, error) {
	m, err := pkg.ReadManifest(localPath)
	if err != nil {
		return nil, err
	}
	if m.Service != nil {
		_ = sd.Stop(m.Service.UnitName()) // ignore if not running
	}

	binPath := filepath.Join(config.BinDir(), "helix-pkg")
	argv := []string{binPath, "install", "-pkg", localPath}
	if sha != "" {
		argv = append(argv, "-sha", sha)
	}
	log.Info("installing package", "name", m.Name, "version", m.Version)
	if err := sd.RunTransient("helix-install-"+m.Name, argv); err != nil {
		return nil, fmt.Errorf("installer: %w", err)
	}
	if err := Reconcile(sd, log); err != nil {
		return nil, err
	}
	return m, nil
}

// RemovePackage stops and removes a package's service and payload.
func RemovePackage(sd Systemd, name string, purge bool, log *slog.Logger) error {
	if !serviceNameRE.MatchString(name) {
		return fmt.Errorf("invalid package name %q", name)
	}
	db, err := pkg.LoadDB()
	if err != nil {
		return err
	}
	e := db.Get(name)
	if e != nil && e.Service != nil {
		_ = sd.Stop(e.Service.UnitName())
		_ = sd.Disable(e.Service.UnitName())
	}

	binPath := filepath.Join(config.BinDir(), "helix-pkg")
	argv := []string{binPath, "remove", "-name", name}
	if purge {
		argv = append(argv, "-purge")
	}
	log.Info("removing package", "name", name)
	if err := sd.RunTransient("helix-remove-"+name, argv); err != nil {
		return fmt.Errorf("installer: %w", err)
	}
	return Reconcile(sd, log)
}

// PutConfig writes a service's admin/remote config drop-in and restarts the
// affected unit. The service name is validated against the catalog (or the core
// service allowlist) so a cloud request can only ever write
// /etc/helix/conf.d/<known-service>.json — never an arbitrary path.
func PutConfig(sd Systemd, service string, section json.RawMessage, log *slog.Logger) error {
	if !serviceNameRE.MatchString(service) {
		return fmt.Errorf("invalid service name %q", service)
	}
	unit, ok := resolveUnit(service)
	if !ok {
		return fmt.Errorf("unknown service %q", service)
	}

	// Validate it is a JSON object before writing.
	var probe map[string]any
	if err := json.Unmarshal(section, &probe); err != nil {
		return fmt.Errorf("config section must be a JSON object: %w", err)
	}
	pretty, err := json.MarshalIndent(probe, "", "  ")
	if err != nil {
		return err
	}

	path := config.DropInPath(service)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, pretty, 0o640); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	// The drop-in is 0640 root:helix so the service (which runs as the helix
	// group) can read its own config; without the group it would be root-only.
	chownServiceGroup(path)
	log.Info("wrote config drop-in", "service", service)
	return sd.Restart(unit)
}

// GetConfig returns the current effective drop-in for a service (empty object
// if none).
func GetConfig(service string) (json.RawMessage, error) {
	if !serviceNameRE.MatchString(service) {
		return nil, fmt.Errorf("invalid service name %q", service)
	}
	data, err := os.ReadFile(config.DropInPath(service))
	if os.IsNotExist(err) {
		return json.RawMessage(`{}`), nil
	}
	if err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}

// resolveUnit maps a service name to its systemd unit, accepting core services
// and any service currently in the catalog.
func resolveUnit(service string) (string, bool) {
	if u, ok := coreServices[service]; ok {
		return u, true
	}
	desired, err := loadDesired()
	if err != nil {
		return "", false
	}
	for i := range desired {
		if desired[i].Name == service {
			return desired[i].UnitName(), true
		}
	}
	return "", false
}
