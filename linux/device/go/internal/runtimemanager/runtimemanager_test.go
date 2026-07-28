// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/helix-kit/helix-device/internal/pkg"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

// fakeSystemd records actions and simulates unit state without a real systemd.
type fakeSystemd struct {
	active  map[string]bool
	enabled map[string]bool
	reloads int
	actions []string
}

func newFake() *fakeSystemd {
	return &fakeSystemd{active: map[string]bool{}, enabled: map[string]bool{}}
}

func (f *fakeSystemd) DaemonReload() error {
	f.reloads++
	f.actions = append(f.actions, "reload")
	return nil
}
func (f *fakeSystemd) Enable(u string) error {
	f.enabled[u] = true
	f.actions = append(f.actions, "enable "+u)
	return nil
}
func (f *fakeSystemd) Disable(u string) error {
	f.enabled[u] = false
	f.actions = append(f.actions, "disable "+u)
	return nil
}
func (f *fakeSystemd) Start(u string) error {
	f.active[u] = true
	f.actions = append(f.actions, "start "+u)
	return nil
}
func (f *fakeSystemd) Stop(u string) error {
	f.active[u] = false
	f.actions = append(f.actions, "stop "+u)
	return nil
}
func (f *fakeSystemd) Restart(u string) error {
	f.actions = append(f.actions, "restart "+u)
	return nil
}
func (f *fakeSystemd) Show(u string) (UnitStatus, error) {
	st := UnitStatus{ActiveState: "inactive"}
	if f.active[u] {
		st.ActiveState = "active"
		st.SubState = "running"
	}
	return st, nil
}
func (f *fakeSystemd) RunTransient(unit string, argv []string) error {
	f.actions = append(f.actions, "transient "+unit)
	return nil
}

func quietLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func writeCatalog(t *testing.T, svcs ...pkg.ServiceDescriptor) {
	t.Helper()
	ms := &pkg.ManagedServices{Services: svcs}
	if err := ms.Save(); err != nil {
		t.Fatal(err)
	}
}

func TestRenderUnitGolden(t *testing.T) {
	d := &pkg.ServiceDescriptor{
		Name:      "shell",
		Enabled:   true,
		ExecStart: []string{"/usr/lib/helix/bin/helix-shell", "-service", "shell"},
		User:      "helix",
		Group:     "helix",
		After:     []string{"helixd.service"},
		Requires:  []string{"helixd.service"},
	}
	got := RenderUnit(d)
	for _, want := range []string{
		"Description=Helix service shell",
		"After=network-online.target helixd.service",
		"Requires=helixd.service",
		"User=helix",
		"ExecStart=/usr/lib/helix/bin/helix-shell -service shell",
		"Restart=on-failure",
		"RestartSec=2",
		"WantedBy=helix.target",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("unit missing %q in:\n%s", want, got)
		}
	}
}

func TestReconcileStartsAndStops(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)
	fake := newFake()
	log := quietLog()

	writeCatalog(t, pkg.ServiceDescriptor{
		Name:      "shell",
		Enabled:   true,
		ExecStart: []string{"/usr/lib/helix/bin/helix-shell", "-service", "shell"},
	})
	if err := Reconcile(fake, log); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	unitFile := filepath.Join(config.SystemdUnitDir(), "helix-shell.service")
	if _, err := os.Stat(unitFile); err != nil {
		t.Errorf("unit not rendered: %v", err)
	}
	if fake.reloads == 0 {
		t.Error("expected a daemon-reload after writing units")
	}
	if !fake.enabled["helix-shell.service"] || !fake.active["helix-shell.service"] {
		t.Errorf("service not enabled+started: enabled=%v active=%v", fake.enabled, fake.active)
	}

	// Second reconcile with no changes: unit content identical, so no reload.
	before := fake.reloads
	if err := Reconcile(fake, log); err != nil {
		t.Fatal(err)
	}
	if fake.reloads != before {
		t.Errorf("idempotent reconcile triggered a reload (%d -> %d)", before, fake.reloads)
	}

	// Now drop the service from the catalog: reconcile should remove the unit.
	writeCatalog(t)
	if err := Reconcile(fake, log); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(unitFile); !os.IsNotExist(err) {
		t.Error("stale unit not removed")
	}
	if fake.active["helix-shell.service"] {
		t.Error("stale service not stopped")
	}
}

func TestReconcileDisabledServiceNotStarted(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())
	fake := newFake()
	writeCatalog(t, pkg.ServiceDescriptor{
		Name:      "idle",
		Enabled:   false,
		ExecStart: []string{"/usr/lib/helix/bin/idle"},
	})
	if err := Reconcile(fake, quietLog()); err != nil {
		t.Fatal(err)
	}
	if fake.active["helix-idle.service"] {
		t.Error("disabled service should not be started")
	}
}

func TestPutConfigPathConfinement(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HELIX_ROOT", root)
	fake := newFake()
	writeCatalog(t, pkg.ServiceDescriptor{
		Name: "shell", Enabled: true, AllowControl: true,
		ExecStart: []string{"/usr/lib/helix/bin/helix-shell"},
	})
	if err := Reconcile(fake, quietLog()); err != nil {
		t.Fatal(err)
	}
	ctrl := NewController(fake, nil, quietLog())

	// A known service writes conf.d/<service>.json.
	if _, err := ctrl.Handle("put-config", []byte(`{"service":"shell","section":{"shell":"/bin/sh"}}`), true); err != nil {
		t.Fatalf("put-config: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(root, "etc/helix/conf.d/shell.json"))
	if err != nil || !strings.Contains(string(got), "/bin/sh") {
		t.Errorf("drop-in not written: %s err=%v", got, err)
	}

	// An unknown service is refused (no arbitrary path can be written).
	if _, err := ctrl.Handle("put-config", []byte(`{"service":"evil","section":{}}`), true); err == nil {
		t.Error("expected unknown service to be refused")
	}

	// An untrusted caller cannot control a service without AllowControl.
	writeCatalog(t, pkg.ServiceDescriptor{Name: "locked", Enabled: true, AllowControl: false,
		ExecStart: []string{"/x"}})
	if err := ctrl.gateControl("locked", false); err == nil {
		t.Error("expected AllowControl gate to reject untrusted control")
	}
}
