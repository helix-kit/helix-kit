// SPDX-License-Identifier: AGPL-3.0-only

package pkg

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"strings"
)

// chownByName chowns path to "user:group" (either side may be empty or numeric).
// It is used for conffiles that declare an explicit owner; callers treat failure
// as non-fatal (unprivileged test runs cannot chown).
func chownByName(path, owner string) error {
	uname, gname, _ := strings.Cut(owner, ":")
	uid, gid := -1, -1
	if uname != "" {
		id, err := lookupUID(uname)
		if err != nil {
			return err
		}
		uid = id
	}
	if gname != "" {
		id, err := lookupGID(gname)
		if err != nil {
			return err
		}
		gid = id
	}
	return os.Chown(path, uid, gid)
}

func lookupUID(name string) (int, error) {
	if n, err := strconv.Atoi(name); err == nil {
		return n, nil
	}
	u, err := user.Lookup(name)
	if err != nil {
		return 0, fmt.Errorf("lookup user %q: %w", name, err)
	}
	return strconv.Atoi(u.Uid)
}

func lookupGID(name string) (int, error) {
	if n, err := strconv.Atoi(name); err == nil {
		return n, nil
	}
	g, err := user.LookupGroup(name)
	if err != nil {
		return 0, fmt.Errorf("lookup group %q: %w", name, err)
	}
	return strconv.Atoi(g.Gid)
}
