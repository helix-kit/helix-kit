// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// version is a parsed dotted numeric version (major.minor.patch, extra parts
// tolerated). Pre-release/build suffixes are not modeled — device packages use
// plain numeric semver.
type version []int

var versionRE = regexp.MustCompile(`^\d+(\.\d+)*$`)

func parseVersion(s string) (version, error) {
	if !versionRE.MatchString(s) {
		return nil, fmt.Errorf("not a dotted numeric version")
	}
	parts := strings.Split(s, ".")
	v := make(version, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, err
		}
		v[i] = n
	}
	return v, nil
}

// compare returns -1, 0, or 1 for a<b, a==b, a>b, treating missing trailing
// components as zero.
func (a version) compare(b version) int {
	n := max(len(a), len(b))
	for i := 0; i < n; i++ {
		var ai, bi int
		if i < len(a) {
			ai = a[i]
		}
		if i < len(b) {
			bi = b[i]
		}
		if ai != bi {
			if ai < bi {
				return -1
			}
			return 1
		}
	}
	return 0
}

// Dependency is a parsed "name (op version)" constraint. Op is empty for a bare
// name (any version satisfies).
type Dependency struct {
	Name    string
	Op      string // one of >= > = <= <  (empty = any)
	Version version
	raw     string
}

var depRE = regexp.MustCompile(`^([a-z0-9][a-z0-9-]*)\s*(?:\(\s*(>=|<=|>|<|=)\s*([0-9.]+)\s*\))?$`)

// ParseDependency parses a dependency spec like "helixd (>= 0.1.0)" or "helixd".
func ParseDependency(spec string) (Dependency, error) {
	m := depRE.FindStringSubmatch(strings.TrimSpace(spec))
	if m == nil {
		return Dependency{}, fmt.Errorf("invalid dependency spec %q", spec)
	}
	d := Dependency{Name: m[1], Op: m[2], raw: spec}
	if m[3] != "" {
		v, err := parseVersion(m[3])
		if err != nil {
			return Dependency{}, fmt.Errorf("dependency %q: %w", spec, err)
		}
		d.Version = v
	}
	return d, nil
}

// SatisfiedBy reports whether an installed version satisfies this dependency.
func (d Dependency) SatisfiedBy(installed string) bool {
	if d.Op == "" {
		return true
	}
	iv, err := parseVersion(installed)
	if err != nil {
		return false
	}
	c := iv.compare(d.Version)
	switch d.Op {
	case ">=":
		return c >= 0
	case ">":
		return c > 0
	case "=":
		return c == 0
	case "<=":
		return c <= 0
	case "<":
		return c < 0
	}
	return false
}

// CheckDepends verifies every dependency of m is satisfied by an installed
// package in db. It returns the list of unmet dependency specs (empty = ok).
func CheckDepends(m *Manifest, db *DB) ([]string, error) {
	var unmet []string
	for _, spec := range m.Depends {
		d, err := ParseDependency(spec)
		if err != nil {
			return nil, err
		}
		e := db.Get(d.Name)
		if e == nil || e.Status != StatusInstalled || !d.SatisfiedBy(e.Version) {
			unmet = append(unmet, spec)
		}
	}
	return unmet, nil
}
