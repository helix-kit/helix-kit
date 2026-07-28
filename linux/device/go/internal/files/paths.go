// SPDX-License-Identifier: AGPL-3.0-only

package files

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ErrOutsideRoots is returned for any path that does not resolve inside a
// configured root. It is deliberately vague: a file browser that reports "no such
// file" vs "not allowed" leaks the existence of paths outside its roots.
var ErrOutsideRoots = errors.New("path is not available")

// resolve maps a requested path to a real one inside the allow-list, or fails.
//
// This is the security boundary of the whole app. A file browser is the classic
// path-traversal target, and the checks that matter are:
//
//   - Resolve symlinks FIRST (filepath.EvalSymlinks), then compare. Comparing the
//     lexical path lets a symlink inside a root point anywhere — /root/link -> /etc
//     is textually "inside" the root but reads /etc.
//   - Compare against the SYMLINK-RESOLVED root, so a root that is itself reached
//     through a symlink still matches.
//   - Compare path SEGMENTS, not string prefixes: "/srv/data-secret" has the string
//     prefix "/srv/data" but is a different directory.
//
// A path that does not exist yet (an upload target) is resolved through its parent
// directory, which must itself pass all of the above.
func (r *runner) resolve(requested string) (string, error) {
	if len(r.roots) == 0 {
		return "", ErrOutsideRoots
	}
	if requested == "" {
		return r.roots[0], nil
	}
	if !filepath.IsAbs(requested) {
		return "", ErrOutsideRoots
	}

	cleaned := filepath.Clean(requested)
	real, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		// Not there yet (an upload target): validate the parent, which must exist,
		// and re-attach the final element.
		parent, err := filepath.EvalSymlinks(filepath.Dir(cleaned))
		if err != nil {
			return "", ErrOutsideRoots
		}
		real = filepath.Join(parent, filepath.Base(cleaned))
	}

	for _, root := range r.roots {
		if contains(root, real) {
			return real, nil
		}
	}
	return "", ErrOutsideRoots
}

// contains reports whether path is root itself or lies beneath it, comparing whole
// segments so "/srv/data" does not "contain" "/srv/data-secret".
func contains(root string, path string) bool {
	if path == root {
		return true
	}
	return strings.HasPrefix(path, root+string(filepath.Separator))
}

// resolveRoots canonicalises the configured roots once, at startup. A root that
// does not exist is a config error worth failing on — silently serving nothing is
// worse than not starting.
func resolveRoots(configured []string) ([]string, error) {
	roots := make([]string, 0, len(configured))
	for _, root := range configured {
		if !filepath.IsAbs(root) {
			return nil, fmt.Errorf("files: root must be absolute: %s", root)
		}
		real, err := filepath.EvalSymlinks(filepath.Clean(root))
		if err != nil {
			return nil, fmt.Errorf("files: root %s: %w", root, err)
		}
		roots = append(roots, real)
	}
	return roots, nil
}
