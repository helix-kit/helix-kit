// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"os"
	"path/filepath"
	"testing"
)

// withRoot points every config path at a temp dir and seeds a minimal valid
// shared document, returning the root.
func withRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)
	mustWrite(t, MainConfigPath(), `{"device":{"id":"dev-1"},"mqtt":{"brokerUrl":"tls://broker:8883"}}`)
	return root
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLoadDefaultsAndValidation(t *testing.T) {
	withRoot(t)
	cfg, err := Load("shell")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Device.ID != "dev-1" {
		t.Errorf("device id = %q", cfg.Device.ID)
	}
	if cfg.IPC.SocketPath != IPCSocketPath() {
		t.Errorf("socket default = %q, want %q", cfg.IPC.SocketPath, IPCSocketPath())
	}
	if cfg.MQTT.KeepaliveSec != 30 {
		t.Errorf("keepalive default = %d", cfg.MQTT.KeepaliveSec)
	}
	if cfg.Spool.Path != SpoolPath() {
		t.Errorf("spool default = %q", cfg.Spool.Path)
	}
}

func TestLoadMissingSharedDoc(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)
	if _, err := Load("shell"); err == nil {
		t.Fatal("expected error when config.json is absent")
	}
}

func TestValidateRequiresIdentity(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())
	mustWrite(t, MainConfigPath(), `{"mqtt":{"brokerUrl":"tls://b:8883"}}`)
	if _, err := Load("shell"); err == nil {
		t.Fatal("expected error when device.id missing")
	}
}

// TestAppSectionLayering proves the drop-in wins over the package default and
// that nested objects merge key-by-key rather than replacing wholesale.
func TestAppSectionLayering(t *testing.T) {
	withRoot(t)
	mustWrite(t, DefaultConfigPath("shell"), `{"shell":"/bin/bash","limits":{"maxSessions":4,"idleSec":60}}`)
	mustWrite(t, DropInPath("shell"), `{"shell":"/bin/sh","limits":{"idleSec":120}}`)

	cfg, err := Load("shell")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var app struct {
		Shell  string `json:"shell"`
		Limits struct {
			MaxSessions int `json:"maxSessions"`
			IdleSec     int `json:"idleSec"`
		} `json:"limits"`
	}
	if err := cfg.AppSection(&app); err != nil {
		t.Fatalf("app section: %v", err)
	}
	if app.Shell != "/bin/sh" {
		t.Errorf("shell = %q, want drop-in /bin/sh", app.Shell)
	}
	if app.Limits.MaxSessions != 4 {
		t.Errorf("maxSessions = %d, want default 4 preserved by deep merge", app.Limits.MaxSessions)
	}
	if app.Limits.IdleSec != 120 {
		t.Errorf("idleSec = %d, want drop-in 120", app.Limits.IdleSec)
	}
}

func TestAppSectionAbsent(t *testing.T) {
	withRoot(t)
	cfg, err := Load("shell")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var app struct {
		Shell string `json:"shell"`
	}
	if err := cfg.AppSection(&app); err != nil {
		t.Fatalf("app section: %v", err)
	}
	if app.Shell != "" {
		t.Errorf("expected zero value, got %q", app.Shell)
	}
}

func TestSecretsRefuseWorldReadable(t *testing.T) {
	withRoot(t)
	mustWrite(t, SecretFilePath("shell"), "TOKEN=abc123\n") // 0644 from mustWrite
	if _, err := Load("shell"); err == nil {
		t.Fatal("expected refusal to load a group/world-readable secret file")
	}
}

func TestSecretsLoad(t *testing.T) {
	withRoot(t)
	path := SecretFilePath("shell")
	mustWrite(t, path, "# comment\nTOKEN=\"abc123\"\nEMPTY=\n")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load("shell")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if v, ok := cfg.Secret("TOKEN"); !ok || v != "abc123" {
		t.Errorf("TOKEN = %q ok=%v", v, ok)
	}
	if v, ok := cfg.Secret("EMPTY"); !ok || v != "" {
		t.Errorf("EMPTY = %q ok=%v", v, ok)
	}
}
