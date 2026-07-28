// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"os"
	"path/filepath"
)

// The on-device filesystem layout follows the FHS: read-only package payloads
// under /usr/lib/helix, admin/remote-managed config under /etc/helix, mutable
// state under /var/lib/helix, and runtime sockets/units under /run. These
// helpers are the single source of truth for those paths, imported by helixd,
// the apps, runtime-manager, the installer, and the CLI so nothing hardcodes a
// path string.
//
// Every path is rooted at Root(), which is empty ("/") on a real device but can
// be pointed at a temp dir (tests) or a container prefix via HELIX_ROOT.

// Root is the filesystem prefix for all Helix paths. Empty means the real root.
// Overridable via HELIX_ROOT for tests and sandboxed runs.
func Root() string { return os.Getenv("HELIX_ROOT") }

func rooted(parts ...string) string {
	return filepath.Join(append([]string{Root(), string(filepath.Separator)}, parts...)...)
}

// --- /usr/lib/helix: read-only, package-shipped ---

// LibDir is the read-only root for package-shipped payloads.
func LibDir() string { return rooted("usr", "lib", "helix") }

// BinDir holds executables installed by packages.
func BinDir() string { return filepath.Join(LibDir(), "bin") }

// PackagesDir holds per-package payload roots for non-binary kinds.
func PackagesDir() string { return filepath.Join(LibDir(), "packages") }

// PackagePayloadDir is the payload root for a single package.
func PackagePayloadDir(pkg string) string { return filepath.Join(PackagesDir(), pkg) }

// DefaultsDir holds package-shipped default config layers, keyed by service name.
func DefaultsDir() string { return filepath.Join(LibDir(), "defaults") }

// DefaultConfigPath is a service's package-shipped default config (lowest layer).
func DefaultConfigPath(service string) string {
	return filepath.Join(DefaultsDir(), service+".json")
}

// CatalogDir holds package-shipped managed-service descriptors (catalog seeds),
// each named <service>.service.json.
func CatalogDir() string { return filepath.Join(LibDir(), "catalog") }

// MetricsPluginDir holds hardware host-metrics provider executables, discovered
// and run by runtime-manager. Providers are delivered as packages, so a new
// board type drops a plugin here without a runtime-manager rebuild.
func MetricsPluginDir() string { return filepath.Join(LibDir(), "metrics") }

// --- /etc/helix: admin/remote-managed config (conffiles + secrets) ---

// EtcDir is the admin/remote-managed config root.
func EtcDir() string { return rooted("etc", "helix") }

// MainConfigPath is the shared device document (device id, mqtt, ipc, gateway).
func MainConfigPath() string { return filepath.Join(EtcDir(), "config.json") }

// ConfDir holds per-service admin/remote drop-ins (highest non-secret layer).
func ConfDir() string { return filepath.Join(EtcDir(), "conf.d") }

// DropInPath is a service's admin/remote config drop-in.
func DropInPath(service string) string { return filepath.Join(ConfDir(), service+".json") }

// SecretsDir holds per-service EnvironmentFile-style secret files (0600).
func SecretsDir() string { return filepath.Join(EtcDir(), "secrets") }

// SecretFilePath is a service's secret file.
func SecretFilePath(service string) string { return filepath.Join(SecretsDir(), service+".env") }

// PKIDir holds the device key and cert chain.
func PKIDir() string { return filepath.Join(EtcDir(), "pki") }

// --- /var/lib/helix: mutable state ---

// StateDir is the mutable state root (package DB, spools, staging).
func StateDir() string { return rooted("var", "lib", "helix") }

// DBDir holds the package database and reconciled catalog.
func DBDir() string { return filepath.Join(StateDir(), "db") }

// PackageDBPath is the dpkg-status-like installed-package database.
func PackageDBPath() string { return filepath.Join(DBDir(), "status") }

// ManagedServicesPath is the reconciled catalog runtime-manager consumes.
func ManagedServicesPath() string { return filepath.Join(DBDir(), "managed-services.json") }

// SpoolDir holds helixd's store-and-forward event spool.
func SpoolDir() string { return filepath.Join(StateDir(), "spool") }

// SpoolPath is helixd's SQLite event spool database.
func SpoolPath() string { return filepath.Join(SpoolDir(), "events.db") }

// TmpDir is install staging (extract then atomic rename).
func TmpDir() string { return filepath.Join(StateDir(), "tmp") }

// --- /run: runtime sockets and rendered units ---

// RunDir holds runtime sockets.
func RunDir() string { return rooted("run", "helix") }

// IPCSocketPath is helixd's local IPC bus.
func IPCSocketPath() string { return filepath.Join(RunDir(), "helix-ipc.sock") }

// RuntimeSocketPath is runtime-manager's control socket for the local CLI.
func RuntimeSocketPath() string { return filepath.Join(RunDir(), "runtime.sock") }

// SystemdUnitDir is where runtime-manager renders generated units.
func SystemdUnitDir() string { return rooted("run", "systemd", "system") }
