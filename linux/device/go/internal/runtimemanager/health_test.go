// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// writeFakeStat writes a /proc/<pid>/stat with the given cpu ticks + starttime,
// placing them at the right offsets after the parenthesized comm field.
func writeFakeStat(t *testing.T, procDir string, pid int, utime, stime, starttime uint64) {
	t.Helper()
	after := make([]string, 22)
	for i := range after {
		after[i] = "0"
	}
	after[0] = "S"                                // state (field 3)
	after[11] = strconv.FormatUint(utime, 10)     // utime (field 14)
	after[12] = strconv.FormatUint(stime, 10)     // stime (field 15)
	after[19] = strconv.FormatUint(starttime, 10) // starttime (field 22)
	stat := strconv.Itoa(pid) + " (helix svc) " + strings.Join(after, " ")
	dir := filepath.Join(procDir, strconv.Itoa(pid))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "stat"), []byte(stat), 0o644); err != nil {
		t.Fatal(err)
	}
}

// fakeProc writes a minimal /proc/<pid>/{stat,status} + /proc/uptime tree and
// returns a collector reading it, with a controllable clock.
func fakeProc(t *testing.T, pid int, utime, stime, starttime uint64, rssKB int64) (*Collector, string) {
	t.Helper()
	proc := t.TempDir()
	writeFakeStat(t, proc, pid, utime, stime, starttime)
	status := "Name:\thelix\nVmRSS:\t" + strconv.FormatInt(rssKB, 10) + " kB\n"
	if err := os.WriteFile(filepath.Join(proc, strconv.Itoa(pid), "status"), []byte(status), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(proc, "uptime"), []byte("10000.0 5000.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := &Collector{procDir: proc, now: func() time.Time { return time.Unix(0, 0) }, prev: map[int]cpuSample{}}
	return c, proc
}

func TestReadRSSAndUptime(t *testing.T) {
	c, _ := fakeProc(t, 42, 100, 50, 200000, 8192)
	if got := c.readRSS(42); got != 8192*1024 {
		t.Errorf("rss = %d, want %d", got, 8192*1024)
	}
	// system uptime 10000s, starttime 200000 ticks / 100 = 2000s -> proc up 8000s.
	if got := c.uptime(42); got != 8000 {
		t.Errorf("uptime = %d, want 8000", got)
	}
}

func TestCPUPercentDelta(t *testing.T) {
	c, _ := fakeProc(t, 7, 100, 0, 0, 1024)
	now := time.Unix(0, 0)
	c.now = func() time.Time { return now }

	// First sample: no prior -> 0.
	if p := c.cpuPercent(7); p != 0 {
		t.Errorf("first cpu%% = %v, want 0", p)
	}
	// Advance 1s and add 50 ticks of CPU (utime 100->150). At CLK_TCK=100,
	// 50 ticks / 100 / 1s = 50%.
	now = now.Add(time.Second)
	writeFakeStat(t, c.procDir, 7, 150, 0, 0)
	if p := c.cpuPercent(7); p < 49.9 || p > 50.1 {
		t.Errorf("cpu%% = %v, want ~50", p)
	}
}

func TestRunProvidersDiscoversAndParses(t *testing.T) {
	dir := t.TempDir()
	writeExec(t, filepath.Join(dir, "helix-metrics-linux"),
		`#!/bin/sh
echo '{"provider":"linux","hardwareProfile":"generic-linux","metrics":{"cpu":{"totalJiffies":100}}}'`)

	host := runProviders(context.Background(), config.Metrics{PluginDir: dir})
	p, ok := host.Providers["linux"]
	if !ok {
		t.Fatalf("provider not discovered: %+v", host)
	}
	if p.HardwareProfile != "generic-linux" {
		t.Errorf("hardwareProfile = %q", p.HardwareProfile)
	}
	if p.Metrics["cpu"] == nil {
		t.Errorf("metrics missing cpu: %+v", p.Metrics)
	}
}

func TestRunProvidersAllowList(t *testing.T) {
	dir := t.TempDir()
	writeExec(t, filepath.Join(dir, "keep"), `#!/bin/sh
echo '{"provider":"keep","metrics":{}}'`)
	writeExec(t, filepath.Join(dir, "skip"), `#!/bin/sh
echo '{"provider":"skip","metrics":{}}'`)

	host := runProviders(context.Background(), config.Metrics{PluginDir: dir, Providers: []string{"keep"}})
	if _, ok := host.Providers["keep"]; !ok {
		t.Error("allow-listed provider missing")
	}
	if _, ok := host.Providers["skip"]; ok {
		t.Error("non-allow-listed provider ran")
	}
}

func TestRunProvidersFailureRecorded(t *testing.T) {
	dir := t.TempDir()
	writeExec(t, filepath.Join(dir, "boom"), "#!/bin/sh\nexit 3")
	host := runProviders(context.Background(), config.Metrics{PluginDir: dir})
	if _, ok := host.Errors["boom"]; !ok {
		t.Errorf("expected error recorded for failing provider: %+v", host)
	}
}

func TestRunProvidersMissingDir(t *testing.T) {
	host := runProviders(context.Background(), config.Metrics{PluginDir: filepath.Join(t.TempDir(), "nope")})
	if len(host.Providers) != 0 {
		t.Error("expected no providers for missing dir")
	}
}

func writeExec(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}
