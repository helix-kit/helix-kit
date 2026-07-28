// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestParseVersionAndCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.2.0", "1.10.0", -1},
		{"2.0", "1.9.9", 1},
		{"1.0", "1.0.0", 0},
	}
	for _, c := range cases {
		va, _ := parseVersion(c.a)
		vb, _ := parseVersion(c.b)
		if got := va.compare(vb); got != c.want {
			t.Errorf("compare(%s,%s)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestDependencySatisfaction(t *testing.T) {
	d, err := ParseDependency("helixd (>= 0.1.0)")
	if err != nil {
		t.Fatal(err)
	}
	if !d.SatisfiedBy("0.1.0") || !d.SatisfiedBy("0.2.0") {
		t.Error("expected >= to accept equal and greater")
	}
	if d.SatisfiedBy("0.0.9") {
		t.Error("expected >= to reject lower")
	}
	bare, _ := ParseDependency("helixd")
	if !bare.SatisfiedBy("0.0.1") {
		t.Error("bare dependency should accept any version")
	}
}

// buildSpec writes a minimal go-binary-style package spec and packs it.
func buildSpec(t *testing.T, name, version string, control map[string]any, payload map[string]string) string {
	t.Helper()
	spec := t.TempDir()
	control["schemaVersion"] = 1
	control["name"] = name
	control["version"] = version
	if control["kind"] == nil {
		control["kind"] = "asset"
	}
	data, _ := json.MarshalIndent(control, "", "  ")
	if err := os.WriteFile(filepath.Join(spec, ControlFileName), data, 0o644); err != nil {
		t.Fatal(err)
	}
	for rel, content := range payload {
		p := filepath.Join(spec, "payload", rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	out := filepath.Join(t.TempDir(), name+".helixpkg")
	if _, err := Pack(spec, out); err != nil {
		t.Fatalf("pack: %v", err)
	}
	return out
}

func TestInstallRemoveRoundTrip(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)

	pkgFile := buildSpec(t, "helixd", "0.1.0", map[string]any{
		"kind": "go-binary",
		"service": map[string]any{
			"enabled":   true,
			"core":      true,
			"execStart": []string{"/usr/lib/helix/bin/helixd"},
		},
	}, map[string]string{"usr/lib/helix/bin/helixd": "#!binary\n"})

	m, err := Install(pkgFile, "")
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if m.Name != "helixd" {
		t.Fatalf("name=%s", m.Name)
	}

	// The payload landed under the root.
	if _, err := os.Stat(filepath.Join(root, "usr/lib/helix/bin/helixd")); err != nil {
		t.Errorf("payload not installed: %v", err)
	}
	// DB records it as installed.
	db, _ := LoadDB()
	if e := db.Get("helixd"); e == nil || e.Status != StatusInstalled {
		t.Errorf("db entry = %+v", e)
	}
	// The service descriptor is in the reconciled catalog.
	ms, _ := LoadManagedServices()
	if ms.Get("helixd") == nil {
		t.Error("service not published to catalog")
	}

	if err := Remove("helixd", true); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "usr/lib/helix/bin/helixd")); !os.IsNotExist(err) {
		t.Error("payload not removed")
	}
	db, _ = LoadDB()
	if db.Get("helixd") != nil {
		t.Error("db entry not removed on purge")
	}
	ms, _ = LoadManagedServices()
	if ms.Get("helixd") != nil {
		t.Error("service not removed from catalog")
	}
}

func TestUnmetDependencyRejected(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())
	pkgFile := buildSpec(t, "helix-shell", "0.1.0", map[string]any{
		"kind":    "go-binary",
		"depends": []string{"helixd (>= 0.1.0)"},
	}, map[string]string{"usr/lib/helix/bin/helix-shell": "x"})
	if _, err := Install(pkgFile, ""); err == nil {
		t.Fatal("expected install to fail on unmet dependency")
	}
}

func TestSHAMismatchRejected(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())
	pkgFile := buildSpec(t, "asset-x", "1.0.0", map[string]any{"kind": "asset"},
		map[string]string{"opt/x": "hi"})
	if _, err := Install(pkgFile, "deadbeef"); err == nil {
		t.Fatal("expected sha mismatch to abort install")
	}
	// Nothing should have been written.
	if _, err := os.Stat(filepath.Join(os.Getenv("HELIX_ROOT"), "opt/x")); !os.IsNotExist(err) {
		t.Error("payload written despite sha mismatch")
	}
}

// TestConffilePreservesLocalEdits proves dpkg 3-way handling: an admin-modified
// conffile is kept and the new default is dropped alongside as .helix-new.
func TestConffilePreservesLocalEdits(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)

	control := map[string]any{
		"kind":      "asset",
		"conffiles": []map[string]any{{"path": "/etc/helix/conf.d/x.json", "mode": "0640"}},
	}
	v1 := buildSpec(t, "x", "1.0.0", control, map[string]string{"etc/helix/conf.d/x.json": `{"a":1}`})
	if _, err := Install(v1, ""); err != nil {
		t.Fatalf("install v1: %v", err)
	}

	// Admin edits the conffile in place.
	confPath := filepath.Join(root, "etc/helix/conf.d/x.json")
	if err := os.WriteFile(confPath, []byte(`{"a":99}`), 0o640); err != nil {
		t.Fatal(err)
	}

	// Upgrade ships a new default.
	v2 := buildSpec(t, "x", "2.0.0", control, map[string]string{"etc/helix/conf.d/x.json": `{"a":2}`})
	if _, err := Install(v2, ""); err != nil {
		t.Fatalf("install v2: %v", err)
	}

	got, _ := os.ReadFile(confPath)
	if string(got) != `{"a":99}` {
		t.Errorf("local edit clobbered: %s", got)
	}
	newSide, err := os.ReadFile(confPath + ".helix-new")
	if err != nil || string(newSide) != `{"a":2}` {
		t.Errorf(".helix-new = %s err=%v", newSide, err)
	}
}

// TestConffileReplacesWhenUnmodified proves an untouched conffile is upgraded.
func TestConffileReplacesWhenUnmodified(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)
	control := map[string]any{
		"kind":      "asset",
		"conffiles": []map[string]any{{"path": "/etc/helix/conf.d/y.json"}},
	}
	v1 := buildSpec(t, "y", "1.0.0", control, map[string]string{"etc/helix/conf.d/y.json": `{"a":1}`})
	if _, err := Install(v1, ""); err != nil {
		t.Fatal(err)
	}
	v2 := buildSpec(t, "y", "2.0.0", control, map[string]string{"etc/helix/conf.d/y.json": `{"a":2}`})
	if _, err := Install(v2, ""); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(root, "etc/helix/conf.d/y.json"))
	if string(got) != `{"a":2}` {
		t.Errorf("unmodified conffile not upgraded: %s", got)
	}
	if _, err := os.Stat(filepath.Join(root, "etc/helix/conf.d/y.json.helix-new")); !os.IsNotExist(err) {
		t.Error("unexpected .helix-new for unmodified conffile")
	}
}

// TestDeterministicPack proves identical specs pack to byte-identical archives
// (content-addressed dedupe relies on this).
func TestDeterministicPack(t *testing.T) {
	mk := func() string {
		return buildSpec(t, "det", "1.0.0", map[string]any{"kind": "asset"},
			map[string]string{"opt/a": "aaa", "opt/b": "bbb"})
	}
	a, _ := os.ReadFile(mk())
	b, _ := os.ReadFile(mk())
	if string(a) != string(b) {
		t.Error("pack is not deterministic")
	}
}
