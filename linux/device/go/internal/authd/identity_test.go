// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"os/exec"
	"strings"
	"testing"
)

func TestParsePasswdLine(t *testing.T) {
	id, err := parsePasswdLine("alice:x:200001:200001:alice:/home/alice:/usr/libexec/helix/session-launcher\n", "alice")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if id.UID != 200001 || id.GID != 200001 {
		t.Errorf("uid/gid = %d/%d, want 200001/200001", id.UID, id.GID)
	}
	if id.Home != "/home/alice" || id.Shell != "/usr/libexec/helix/session-launcher" {
		t.Errorf("home/shell = %q/%q", id.Home, id.Shell)
	}
}

// SSSD reports the password field as '*' rather than 'x'.
func TestParsePasswdLineAcceptsSSSDFormat(t *testing.T) {
	if _, err := parsePasswdLine("bob:*:200002:200002:bob:/home/bob:/bin/sh\n", "bob"); err != nil {
		t.Fatalf("parse: %v", err)
	}
}

func TestParsePasswdLineRejectsBadRecords(t *testing.T) {
	cases := map[string]string{
		"empty":                     "",
		"too few fields":            "alice:x:200001\n",
		"non-numeric uid":           "alice:x:notanumber:200001:alice:/home/alice:/bin/sh\n",
		"non-numeric gid":           "alice:x:200001:notanumber:alice:/home/alice:/bin/sh\n",
		"record for the wrong user": "root:x:0:0:root:/root:/bin/bash\n",
	}
	for name, line := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parsePasswdLine(line, "alice"); err == nil {
				t.Fatalf("parsePasswdLine(%q) accepted a bad record", line)
			}
		})
	}
}

// Only the first record is honoured, so a second forged line cannot take effect.
func TestParsePasswdLineUsesFirstRecordOnly(t *testing.T) {
	id, err := parsePasswdLine("alice:x:200001:200001:alice:/home/alice:/bin/sh\nalice:x:0:0:root:/root:/bin/bash\n", "alice")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if id.UID != 200001 {
		t.Fatalf("uid = %d, want 200001", id.UID)
	}
}

// A username NSS could never produce must be refused before reaching getent.
func TestResolveRejectsForgedUsernames(t *testing.T) {
	r := newGetentResolver()
	for _, username := range []string{"", "alice:x:0:0", "alice\nroot", "alice\r"} {
		if _, err := r.Resolve(context.Background(), username); err == nil {
			t.Errorf("Resolve(%q) was accepted", username)
		}
	}
}

// The real lookup must go through NSS. This is the check that would fail if the
// daemon ever went back to os/user under CGO_ENABLED=0.
func TestResolveUsesNSS(t *testing.T) {
	if _, err := exec.LookPath("getent"); err != nil {
		t.Skip("getent not available")
	}
	r := newGetentResolver()

	id, err := r.Resolve(context.Background(), "root")
	if err != nil {
		t.Fatalf("Resolve(root): %v", err)
	}
	if id.UID != 0 || id.GID != 0 {
		t.Fatalf("root resolved to %d/%d, want 0/0", id.UID, id.GID)
	}

	if _, err := r.Resolve(context.Background(), unknownUser); err == nil {
		t.Fatalf("Resolve(%s) succeeded for a user that does not exist", unknownUser)
	}
}

func TestFirstLine(t *testing.T) {
	if got := firstLine("a\nb\n"); got != "a" {
		t.Errorf("firstLine = %q, want a", got)
	}
	if got := firstLine("only"); got != "only" {
		t.Errorf("firstLine = %q, want only", got)
	}
	if got := firstLine(strings.Repeat("x", 3)); got != "xxx" {
		t.Errorf("firstLine = %q", got)
	}
}
