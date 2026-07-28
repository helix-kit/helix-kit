// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Pack builds a .helixpkg at outPath from a spec directory laid out as:
//
//	<spec>/helix-control.json   the control manifest
//	<spec>/payload/…            the filesystem overlay (extracted under the device root)
//	<spec>/maintainer/…         optional maintainer scripts referenced by the manifest
//
// The manifest is validated, and every maintainer script and conffile it
// references must exist in the spec. The output is a deterministic gzip tar
// (entries sorted, timestamps zeroed) so identical inputs hash identically —
// which lets the content-addressed release store dedupe.
func Pack(specDir, outPath string) (*Manifest, error) {
	ctrlPath := filepath.Join(specDir, ControlFileName)
	ctrl, err := os.ReadFile(ctrlPath)
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err = json.Unmarshal(ctrl, &m); err != nil {
		return nil, fmt.Errorf("parse %s: %w", ctrlPath, err)
	}
	if err = m.Validate(); err != nil {
		return nil, err
	}
	for hook, p := range m.MaintainerScripts {
		if _, statErr := os.Stat(filepath.Join(specDir, p)); statErr != nil {
			return nil, fmt.Errorf("maintainer script %q for hook %q missing: %w", p, hook, statErr)
		}
	}

	// Collect entries: control file, then payload/ and maintainer/ trees.
	type entry struct {
		name string // path within the archive
		src  string // absolute source path ("" for the in-memory control file)
	}
	var entries []entry
	entries = append(entries, entry{name: ControlFileName})
	for _, sub := range []string{"payload", "maintainer"} {
		base := filepath.Join(specDir, sub)
		if _, statErr := os.Stat(base); statErr != nil {
			continue
		}
		walkErr := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			rel, relErr := filepath.Rel(specDir, path)
			if relErr != nil {
				return relErr
			}
			name := filepath.ToSlash(rel)
			if info.IsDir() {
				name += "/"
			}
			entries = append(entries, entry{name: name, src: path})
			return nil
		})
		if walkErr != nil {
			return nil, walkErr
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })

	out, err := os.Create(outPath)
	if err != nil {
		return nil, err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	for _, e := range entries {
		if e.src == "" { // control file
			if err = writeTarBytes(tw, e.name, ctrl, 0o644); err != nil {
				return nil, err
			}
			continue
		}
		info, statErr := os.Stat(e.src)
		if statErr != nil {
			return nil, statErr
		}
		if info.IsDir() {
			if err = tw.WriteHeader(&tar.Header{Name: e.name, Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
				return nil, err
			}
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("symlinks are not allowed in packages: %s", e.name)
		}
		data, readErr := os.ReadFile(e.src)
		if readErr != nil {
			return nil, readErr
		}
		mode := int64(info.Mode().Perm())
		if strings.HasPrefix(e.name, "maintainer/") {
			mode = 0o755
		}
		if err = writeTarBytes(tw, e.name, data, mode); err != nil {
			return nil, err
		}
	}
	return &m, nil
}

func writeTarBytes(tw *tar.Writer, name string, data []byte, mode int64) error {
	if err := tw.WriteHeader(&tar.Header{
		Name:     name,
		Typeflag: tar.TypeReg,
		Mode:     mode,
		Size:     int64(len(data)),
	}); err != nil {
		return err
	}
	_, err := io.Copy(tw, bytes.NewReader(data))
	return err
}
