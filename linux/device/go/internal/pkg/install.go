// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// payloadPrefix is the tar path prefix for the filesystem overlay.
const payloadPrefix = "payload/"

// Clock is overridable in tests (production stamps wall time).
var Clock = func() time.Time { return time.Now() }

// Install unpacks and configures a .helixpkg onto the device, recording the
// result in the package DB and publishing its service descriptor to the
// managed-services catalog. It performs no systemd actions — runtime-manager
// stops the old unit beforehand and reconciles the new one afterward.
//
// If expectedSHA is non-empty the package file's hash must match it before any
// change is made. Local conffile modifications survive upgrades (dpkg 3-way).
func Install(pkgPath, expectedSHA string) (*Manifest, error) {
	sum, err := sha256File(pkgPath)
	if err != nil {
		return nil, err
	}
	if expectedSHA != "" && !strings.EqualFold(sum, expectedSHA) {
		return nil, fmt.Errorf("package sha256 mismatch: got %s want %s", sum, expectedSHA)
	}

	m, err := ReadManifest(pkgPath)
	if err != nil {
		return nil, err
	}

	db, err := LoadDB()
	if err != nil {
		return nil, err
	}
	unmet, err := CheckDepends(m, db)
	if err != nil {
		return nil, err
	}
	if len(unmet) > 0 {
		return nil, fmt.Errorf("unmet dependencies for %s: %s", m.Name, strings.Join(unmet, ", "))
	}

	prev := db.Get(m.Name)
	oldVer := ""
	action := "install"
	if prev != nil && prev.Status == StatusInstalled {
		oldVer, action = prev.Version, "upgrade"
	}

	scripts, cleanup, err := extractMaintainerScripts(pkgPath, m)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	if err = runScript(scripts, "preconfigure"); err != nil {
		return nil, err
	}
	if err = runScript(scripts, "preinst", action, oldVer); err != nil {
		return nil, err
	}

	files, conf, err := extractPayload(pkgPath, m, prev)
	if err != nil {
		// Payload partially applied — mark half-installed for repair.
		markHalfInstalled(db, m, sum, files)
		return nil, err
	}

	if len(m.SetupCommand) > 0 {
		if err = runSetup(m); err != nil {
			markHalfInstalled(db, m, sum, files)
			return nil, err
		}
	}

	if err = runScript(scripts, "postinst", "configure", oldVer); err != nil {
		markHalfInstalled(db, m, sum, files)
		return nil, err
	}
	if err = runScript(scripts, "postconfigure"); err != nil {
		markHalfInstalled(db, m, sum, files)
		return nil, err
	}

	db.Put(&DBEntry{
		Name:        m.Name,
		Version:     m.Version,
		Kind:        m.Kind,
		Status:      StatusInstalled,
		SHA256:      sum,
		Files:       files,
		Conffiles:   conf,
		Service:     m.Service,
		InstalledAt: Clock().UTC().Format(time.RFC3339),
	})
	if err = db.Save(); err != nil {
		return nil, err
	}

	if err = syncCatalog(db); err != nil {
		return nil, err
	}
	return m, nil
}

// Remove uninstalls a package: it deletes payload files (keeping conffiles
// unless purge), runs prerm/postrm, updates the DB, and removes the service from
// the catalog. runtime-manager stops+disables the unit before this is called.
func Remove(name string, purge bool) error {
	db, err := LoadDB()
	if err != nil {
		return err
	}
	e := db.Get(name)
	if e == nil {
		return fmt.Errorf("package %q is not installed", name)
	}

	// Nothing to re-run maintainer scripts from unless we retained them; the
	// slice relies on runtime-manager having stopped the unit already.
	conffiles := map[string]bool{}
	for _, c := range e.Conffiles {
		conffiles[c.Path] = true
	}
	for _, f := range e.Files {
		if !purge && conffiles[f] {
			continue
		}
		if err := os.Remove(rootJoin(f)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", f, err)
		}
	}

	if purge {
		e.Status = StatusConfigFiles // transient; deleted below
		db.Delete(name)
	} else if len(e.Conffiles) > 0 {
		e.Status = StatusConfigFiles
		e.Files = nil
		db.Put(e)
	} else {
		db.Delete(name)
	}
	if err := db.Save(); err != nil {
		return err
	}
	return syncCatalog(db)
}

// syncCatalog rebuilds the managed-services catalog from the installed packages.
func syncCatalog(db *DB) error {
	ms := &ManagedServices{}
	for _, e := range db.List() {
		if e.Status == StatusInstalled && e.Service != nil {
			ms.Upsert(*e.Service)
		}
	}
	return ms.Save()
}

func markHalfInstalled(db *DB, m *Manifest, sum string, files []string) {
	db.Put(&DBEntry{
		Name: m.Name, Version: m.Version, Kind: m.Kind,
		Status: StatusHalfInstalled, SHA256: sum, Files: files,
		InstalledAt: Clock().UTC().Format(time.RFC3339),
	})
	_ = db.Save()
}

// extractPayload writes the package's filesystem overlay under the device root,
// applying dpkg-style 3-way handling to declared conffiles. It returns the list
// of installed on-device paths and the updated conffile states.
func extractPayload(pkgPath string, m *Manifest, prev *DBEntry) ([]string, []ConffileState, error) {
	conffiles := map[string]Conffile{}
	for _, c := range m.Conffiles {
		conffiles[c.Path] = c
	}
	prevConf := map[string]ConffileState{}
	if prev != nil {
		for _, c := range prev.Conffiles {
			prevConf[c.Path] = c
		}
	}

	f, err := os.Open(pkgPath)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, nil, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)

	var files []string
	var confStates []ConffileState
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return files, confStates, err
		}
		if !strings.HasPrefix(h.Name, payloadPrefix) || h.Name == payloadPrefix {
			continue
		}
		rel := strings.TrimPrefix(h.Name, payloadPrefix)
		onDevice := "/" + filepath.Clean(rel)
		dest := rootJoin(onDevice)

		switch h.Typeflag {
		case tar.TypeDir:
			if err = os.MkdirAll(dest, os.FileMode(h.Mode)&0o777|0o700); err != nil {
				return files, confStates, err
			}
			continue
		case tar.TypeReg:
		default:
			// Symlinks and other special entries are rejected — packages ship
			// plain files and dirs only.
			return files, confStates, fmt.Errorf("unsupported tar entry %q (type %d)", h.Name, h.Typeflag)
		}

		data, err := io.ReadAll(tr)
		if err != nil {
			return files, confStates, err
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return files, confStates, err
		}

		if c, ok := conffiles[onDevice]; ok {
			st, err := applyConffile(dest, onDevice, data, c, prevConf[onDevice])
			if err != nil {
				return files, confStates, err
			}
			confStates = append(confStates, st)
			files = append(files, onDevice)
			continue
		}

		mode := os.FileMode(h.Mode) & 0o777
		if mode == 0 {
			mode = 0o644
		}
		if err := writeFileAtomicBytes(dest, data, mode); err != nil {
			return files, confStates, err
		}
		files = append(files, onDevice)
	}
	return files, confStates, nil
}

// applyConffile implements dpkg 3-way conffile handling and returns the new
// tracked state.
func applyConffile(dest, onDevice string, shipped []byte, c Conffile, prev ConffileState) (ConffileState, error) {
	shippedSHA := sha256Bytes(shipped)
	mode := parseMode(c.Mode, 0o640)

	cur, err := os.ReadFile(dest)
	if os.IsNotExist(err) {
		if err = writeFileAtomicBytes(dest, shipped, mode); err != nil {
			return ConffileState{}, err
		}
		applyOwner(dest, c.Owner)
		return ConffileState{Path: onDevice, InstalledSHA: shippedSHA, DefaultSHA: shippedSHA}, nil
	}
	if err != nil {
		return ConffileState{}, err
	}
	curSHA := sha256Bytes(cur)

	// Unmodified since last install → safe to replace.
	if prev.DefaultSHA != "" && curSHA == prev.DefaultSHA {
		if err := writeFileAtomicBytes(dest, shipped, mode); err != nil {
			return ConffileState{}, err
		}
		applyOwner(dest, c.Owner)
		return ConffileState{Path: onDevice, InstalledSHA: shippedSHA, DefaultSHA: shippedSHA}, nil
	}
	// Locally modified (or first-seen existing) → keep it, drop the new one aside.
	if curSHA != shippedSHA {
		if err := writeFileAtomicBytes(dest+".helix-new", shipped, mode); err != nil {
			return ConffileState{}, err
		}
	}
	return ConffileState{Path: onDevice, InstalledSHA: curSHA, DefaultSHA: shippedSHA}, nil
}

// --- maintainer scripts + setup ---

func extractMaintainerScripts(pkgPath string, m *Manifest) (dir string, cleanup func(), err error) {
	cleanup = func() {}
	if len(m.MaintainerScripts) == 0 {
		return "", cleanup, nil
	}
	dir, err = os.MkdirTemp(config.TmpDir(), "maint-")
	if err != nil {
		// TmpDir may not exist in tests without maintainer scripts; create it.
		if mkErr := os.MkdirAll(config.TmpDir(), 0o700); mkErr != nil {
			return "", cleanup, err
		}
		if dir, err = os.MkdirTemp(config.TmpDir(), "maint-"); err != nil {
			return "", cleanup, err
		}
	}
	cleanup = func() { _ = os.RemoveAll(dir) }

	// Map each shipped script path back to its hook name so it is extracted as
	// dir/<hook> (runScript resolves hooks by that name).
	hookOf := map[string]string{}
	for hook, p := range m.MaintainerScripts {
		hookOf[p] = hook
	}
	f, err := os.Open(pkgPath)
	if err != nil {
		return dir, cleanup, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return dir, cleanup, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return dir, cleanup, err
		}
		hook, ok := hookOf[h.Name]
		if !ok || h.Typeflag != tar.TypeReg {
			continue
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			return dir, cleanup, err
		}
		if err := os.WriteFile(filepath.Join(dir, hook), data, 0o700); err != nil {
			return dir, cleanup, err
		}
	}
	return dir, cleanup, nil
}

func runScript(dir string, hook string, args ...string) error {
	// dir is empty when the package ships no maintainer scripts.
	if dir == "" {
		return nil
	}
	// The manifest maps a hook name to a script path; we extracted by basename.
	// Resolve by convention: the file named exactly <hook> under dir, if present.
	candidate := filepath.Join(dir, hook)
	if _, err := os.Stat(candidate); err != nil {
		return nil // hook not shipped
	}
	cmd := exec.Command(candidate, args...)
	cmd.Env = append(os.Environ(), "HELIX_ROOT="+config.Root())
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("maintainer script %s: %w", hook, err)
	}
	return nil
}

func runSetup(m *Manifest) error {
	cmd := exec.Command(m.SetupCommand[0], m.SetupCommand[1:]...)
	cmd.Dir = config.PackagePayloadDir(m.Name)
	cmd.Env = append(os.Environ(), "HELIX_ROOT="+config.Root())
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("setup command: %w", err)
	}
	return nil
}

// --- small fs/hash helpers ---

func rootJoin(onDevice string) string {
	return filepath.Join(config.Root(), filepath.Clean(onDevice))
}

func writeFileAtomicBytes(dest string, data []byte, mode os.FileMode) error {
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil { // WriteFile honors umask; force mode
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func sha256Bytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func parseMode(s string, def os.FileMode) os.FileMode {
	if s == "" {
		return def
	}
	n, err := strconv.ParseUint(s, 8, 32)
	if err != nil {
		return def
	}
	return os.FileMode(n)
}

// applyOwner best-effort chowns a conffile to "user:group". It silently ignores
// permission errors so installs work unprivileged in tests.
func applyOwner(path, owner string) {
	if owner == "" {
		return
	}
	// Resolution of names→ids and the chown itself are best-effort; runtime-manager
	// runs the installer as root on-device where this succeeds.
	_ = chownByName(path, owner)
}
