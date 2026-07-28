// SPDX-License-Identifier: AGPL-3.0-only

// Command helix-pkg is the Helix device package tool. On a build host it packs a
// spec directory into a .helixpkg (`build`); on a device it installs, removes,
// lists, and inspects packages. runtime-manager invokes `helix-pkg install` from
// a transient systemd unit; the CLI invokes `build` on the host.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/helix-kit/helix-device/internal/pkg"
	"github.com/helix-kit/helix-device/internal/shared/config"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "build":
		err = cmdBuild(os.Args[2:])
	case "install":
		err = cmdInstall(os.Args[2:])
	case "remove":
		err = cmdRemove(os.Args[2:])
	case "list":
		err = cmdList(os.Args[2:])
	case "info":
		err = cmdInfo(os.Args[2:])
	case "ctl":
		err = cmdCtl(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "helix-pkg:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: helix-pkg <build|install|remove|list|info|ctl> [args]")
}

// cmdCtl is a thin client for runtime-manager's local control socket. The CLI
// drives install/remove/status/put-config through this (via `docker exec` on the
// test host), so operations flow through runtime-manager (reconcile + auto-start)
// rather than mutating the device behind its back.
func cmdCtl(args []string) error {
	fs := flag.NewFlagSet("ctl", flag.ExitOnError)
	method := fs.String("method", "", "control method")
	params := fs.String("params", "{}", "JSON params object")
	_ = fs.Parse(args)
	if *method == "" {
		return fmt.Errorf("ctl requires -method")
	}
	conn, err := net.DialTimeout("unix", config.RuntimeSocketPath(), 5*time.Second)
	if err != nil {
		return fmt.Errorf("dial runtime socket: %w", err)
	}
	defer conn.Close()

	req, _ := json.Marshal(map[string]json.RawMessage{
		"method": json.RawMessage(fmt.Sprintf("%q", *method)),
		"params": json.RawMessage(*params),
	})
	if _, err = conn.Write(append(req, '\n')); err != nil {
		return err
	}
	_ = conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return err
	}
	var resp struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.Unmarshal(line, &resp); err != nil {
		return err
	}
	if resp.Error != "" {
		return fmt.Errorf("%s", resp.Error)
	}
	if len(resp.Result) > 0 {
		fmt.Println(string(resp.Result))
	}
	return nil
}

func cmdBuild(args []string) error {
	fs := flag.NewFlagSet("build", flag.ExitOnError)
	spec := fs.String("spec", "", "package spec directory")
	out := fs.String("out", "", "output .helixpkg path")
	_ = fs.Parse(args)
	if *spec == "" || *out == "" {
		return fmt.Errorf("build requires -spec and -out")
	}
	m, err := pkg.Pack(*spec, *out)
	if err != nil {
		return err
	}
	fmt.Printf("built %s %s -> %s\n", m.Name, m.Version, *out)
	return nil
}

func cmdInstall(args []string) error {
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	path := fs.String("pkg", "", "path to a .helixpkg")
	sha := fs.String("sha256", "", "expected sha256 (verified before any change)")
	_ = fs.Parse(args)
	if *path == "" {
		return fmt.Errorf("install requires -pkg")
	}
	m, err := pkg.Install(*path, *sha)
	if err != nil {
		return err
	}
	fmt.Printf("installed %s %s\n", m.Name, m.Version)
	return nil
}

func cmdRemove(args []string) error {
	fs := flag.NewFlagSet("remove", flag.ExitOnError)
	name := fs.String("name", "", "package name")
	purge := fs.Bool("purge", false, "also remove conffiles")
	_ = fs.Parse(args)
	if *name == "" {
		return fmt.Errorf("remove requires -name")
	}
	if err := pkg.Remove(*name, *purge); err != nil {
		return err
	}
	fmt.Printf("removed %s\n", *name)
	return nil
}

func cmdList(args []string) error {
	db, err := pkg.LoadDB()
	if err != nil {
		return err
	}
	for _, e := range db.List() {
		fmt.Printf("%-24s %-12s %s\n", e.Name, e.Version, e.Status)
	}
	return nil
}

func cmdInfo(args []string) error {
	fs := flag.NewFlagSet("info", flag.ExitOnError)
	name := fs.String("name", "", "installed package name")
	path := fs.String("pkg", "", "a .helixpkg file to inspect")
	_ = fs.Parse(args)
	switch {
	case *path != "":
		m, err := pkg.ReadManifest(*path)
		if err != nil {
			return err
		}
		return printJSON(m)
	case *name != "":
		db, err := pkg.LoadDB()
		if err != nil {
			return err
		}
		e := db.Get(*name)
		if e == nil {
			return fmt.Errorf("package %q not installed", *name)
		}
		return printJSON(e)
	default:
		return fmt.Errorf("info requires -name or -pkg")
	}
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
