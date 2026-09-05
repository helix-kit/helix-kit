// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"os"
	"path/filepath"
)

// Root is the filesystem prefix for all Helix paths, overridable via HELIX_ROOT.
func Root() string { return os.Getenv("HELIX_ROOT") }

func rooted(parts ...string) string {
	return filepath.Join(append([]string{Root(), string(filepath.Separator)}, parts...)...)
}

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

// CatalogDir holds package-shipped managed-service descriptors (catalog seeds).
func CatalogDir() string { return filepath.Join(LibDir(), "catalog") }

// MetricsPluginDir holds hardware host-metrics provider executables.
func MetricsPluginDir() string { return filepath.Join(LibDir(), "metrics") }

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

// RunDir holds runtime sockets.
func RunDir() string { return rooted("run", "helix") }

// IPCSocketPath is helixd's local IPC bus.
func IPCSocketPath() string { return filepath.Join(RunDir(), "helix-ipc.sock") }

// AuthSocketDir holds helix-authd's PAM socket. It is a private subdirectory so
// it can be root-only 0700 without locking non-root apps out of RunDir.
func AuthSocketDir() string { return filepath.Join(RunDir(), "authd") }

// AuthSocketPath is the socket pam_helix.so connects to. Root-only: anyone who
// can talk to it can drive an authentication decision.
func AuthSocketPath() string { return filepath.Join(AuthSocketDir(), "auth.sock") }

// RuntimeSocketPath is runtime-manager's control socket for the local CLI.
func RuntimeSocketPath() string { return filepath.Join(RunDir(), "runtime.sock") }

// SystemdUnitDir is where runtime-manager renders generated units.
func SystemdUnitDir() string { return rooted("run", "systemd", "system") }
