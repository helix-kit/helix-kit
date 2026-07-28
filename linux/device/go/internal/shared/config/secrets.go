// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// loadSecrets parses a service's EnvironmentFile secret overlay, refusing any world-readable file.
func loadSecrets(service string) (map[string]string, error) {
	path := SecretFilePath(service)
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("stat %s: %w", path, err)
	}
	if perm := info.Mode().Perm(); perm&0o007 != 0 {
		return nil, fmt.Errorf("secret file %s is world-readable (%#o); must be 0640 or stricter", path, perm)
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("malformed secret line in %s: %q", path, line)
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		val = strings.Trim(val, `"'`)
		out[key] = val
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return out, nil
}
