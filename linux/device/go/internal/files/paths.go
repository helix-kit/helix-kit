// SPDX-License-Identifier: AGPL-3.0-only

package files

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ErrOutsideRoots is deliberately vague so it does not leak paths outside the roots.
var ErrOutsideRoots = errors.New("path is not available")

// resolve maps a requested path into the allow-list — the app's security boundary:
// symlinks are resolved first and roots compared by whole segments to stop traversal.
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
		// Upload target not there yet: validate the parent and re-attach the base.
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

// contains reports whether path is root or beneath it, comparing whole segments.
func contains(root string, path string) bool {
	if path == root {
		return true
	}
	return strings.HasPrefix(path, root+string(filepath.Separator))
}

// resolveRoots canonicalises the configured roots at startup, failing on a missing root.
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
