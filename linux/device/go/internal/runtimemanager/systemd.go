// SPDX-License-Identifier: AGPL-3.0-only

package runtimemanager

import (
	"bufio"
	"fmt"
	"os/exec"
	"strings"
)

// Systemd is the subset of systemctl/systemd-run runtime-manager drives; an interface so it can be faked in tests.
type Systemd interface {
	DaemonReload() error
	Enable(unit string) error
	Disable(unit string) error
	Start(unit string) error
	Stop(unit string) error
	Restart(unit string) error
	Show(unit string) (UnitStatus, error)
	// RunTransient runs argv synchronously as a oneshot transient unit (isolates package installs).
	RunTransient(unit string, argv []string) error
}

// UnitStatus is the parsed output of `systemctl show`.
type UnitStatus struct {
	ActiveState   string // active | inactive | failed | activating | ...
	SubState      string // running | dead | exited | ...
	MainPID       int
	UnitFileState string // enabled | disabled | static | ...
	Loaded        bool
}

// systemctl is the production Systemd backed by the systemctl/systemd-run CLIs.
type systemctl struct{}

// NewSystemd returns the production systemd driver.
func NewSystemd() Systemd { return systemctl{} }

func (systemctl) run(args ...string) error {
	cmd := exec.Command("systemctl", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (s systemctl) DaemonReload() error       { return s.run("daemon-reload") }
func (s systemctl) Enable(unit string) error  { return s.run("enable", unit) }
func (s systemctl) Disable(unit string) error { return s.run("disable", unit) }
func (s systemctl) Start(unit string) error   { return s.run("start", unit) }
func (s systemctl) Stop(unit string) error    { return s.run("stop", unit) }
func (s systemctl) Restart(unit string) error { return s.run("restart", unit) }

func (systemctl) Show(unit string) (UnitStatus, error) {
	cmd := exec.Command("systemctl", "show", unit,
		"--property=ActiveState,SubState,MainPID,UnitFileState,LoadState")
	out, err := cmd.Output()
	if err != nil {
		return UnitStatus{}, err
	}
	var st UnitStatus
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), "=")
		if !ok {
			continue
		}
		switch k {
		case "ActiveState":
			st.ActiveState = v
		case "SubState":
			st.SubState = v
		case "MainPID":
			fmt.Sscanf(v, "%d", &st.MainPID)
		case "UnitFileState":
			st.UnitFileState = v
		case "LoadState":
			st.Loaded = v == "loaded"
		}
	}
	return st, nil
}

func (systemctl) RunTransient(unit string, argv []string) error {
	args := append([]string{"--wait", "--collect", "--quiet",
		"--unit=" + unit, "--property=Type=oneshot", "--"}, argv...)
	cmd := exec.Command("systemd-run", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemd-run %s: %w: %s", unit, err, strings.TrimSpace(string(out)))
	}
	return nil
}
