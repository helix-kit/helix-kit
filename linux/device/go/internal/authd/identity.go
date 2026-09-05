// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// lookupTimeout bounds an NSS lookup, which on a Helix device reaches LDAP.
const lookupTimeout = 5 * time.Second

// unixIdentity is what NSS knows about a user.
type unixIdentity struct {
	Username string
	UID      uint32
	GID      uint32
	Home     string
	Shell    string
}

// identityResolver maps a username onto its Unix identity.
type identityResolver interface {
	Resolve(ctx context.Context, username string) (unixIdentity, error)
}

// getentResolver consults NSS through getent(1).
//
// Go's os/user is deliberately not used. The device runtime builds with
// CGO_ENABLED=0 so its binaries stay static and cross-compilable, and under that
// build os/user reads /etc/passwd directly and never consults NSS — which would
// make precisely the LDAP/SSSD users this daemon exists to authenticate
// invisible to it. getent goes through the same NSS stack as sshd, so the two
// can never disagree about who a username is.
type getentResolver struct {
	// path is the getent binary; overridable for tests.
	path string
}

func newGetentResolver() *getentResolver { return &getentResolver{path: "getent"} }

func (r *getentResolver) Resolve(ctx context.Context, username string) (unixIdentity, error) {
	// A username containing a colon or newline could forge a passwd line; NSS
	// cannot produce one, so refuse it rather than parse it.
	if username == "" || strings.ContainsAny(username, ":\n\r") {
		return unixIdentity{}, fmt.Errorf("invalid username %q", username)
	}

	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, r.path, "passwd", username)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return unixIdentity{}, fmt.Errorf("getent passwd %s: %w", username, err)
	}
	return parsePasswdLine(stdout.String(), username)
}

// parsePasswdLine reads one passwd(5) record and checks it is the user asked for.
func parsePasswdLine(out, username string) (unixIdentity, error) {
	line := strings.TrimRight(firstLine(out), "\n")
	fields := strings.Split(line, ":")
	if len(fields) < 7 {
		return unixIdentity{}, fmt.Errorf("unexpected passwd record for %q", username)
	}
	// getent resolves aliases, so confirm the record is the requested user rather
	// than trusting the lookup to have been exact.
	if fields[0] != username {
		return unixIdentity{}, fmt.Errorf("passwd record is for %q, not %q", fields[0], username)
	}

	uid, err := strconv.ParseUint(fields[2], 10, 32)
	if err != nil {
		return unixIdentity{}, fmt.Errorf("parse uid for %q: %w", username, err)
	}
	gid, err := strconv.ParseUint(fields[3], 10, 32)
	if err != nil {
		return unixIdentity{}, fmt.Errorf("parse gid for %q: %w", username, err)
	}

	return unixIdentity{
		Username: fields[0],
		UID:      uint32(uid),
		GID:      uint32(gid),
		Home:     fields[5],
		Shell:    fields[6],
	}, nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
