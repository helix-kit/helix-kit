// SPDX-License-Identifier: AGPL-3.0-only

package identity

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

var (
	testDir  = NewDirectory("dc=helix,dc=local", "/home", "/usr/libexec/helix/session-launcher")
	alice    = UnixUser{UUID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Email: "alice@example.com", Username: "alice", UID: 200001}
	wantHome = "/home/alice"
)

func TestValidateUsername(t *testing.T) {
	valid := []string{"alice", "bob", "_svc", "a", "user-1", "a123456789012345678901234567890"}
	for _, name := range valid {
		if err := ValidateUsername(name); err != nil {
			t.Errorf("ValidateUsername(%q) = %v, want nil", name, err)
		}
	}

	invalid := []string{"", "Alice", "1alice", "-alice", "al ice", "alice$", "a1234567890123456789012345678901x", "alice\n", "root:x"}
	for _, name := range invalid {
		err := ValidateUsername(name)
		if err == nil {
			t.Errorf("ValidateUsername(%q) = nil, want error", name)
			continue
		}
		if !errors.Is(err, ErrInvalidUsername) {
			t.Errorf("ValidateUsername(%q) = %v, want ErrInvalidUsername", name, err)
		}
	}
}

func TestGIDDerivedFromUID(t *testing.T) {
	if got := alice.GID(); got != alice.UID {
		t.Fatalf("GID() = %d, want %d (private primary group)", got, alice.UID)
	}
}

func TestDerivedUnixAttributes(t *testing.T) {
	if got := testDir.HomeDirectory(alice); got != wantHome {
		t.Errorf("HomeDirectory = %q, want %q", got, wantHome)
	}
	// A trailing slash on the home root must not double up.
	d := NewDirectory("dc=helix,dc=local", "/home/", "/bin/false")
	if got := d.HomeDirectory(alice); got != wantHome {
		t.Errorf("HomeDirectory with trailing slash = %q, want %q", got, wantHome)
	}
}

func TestDNConstruction(t *testing.T) {
	if got, want := testDir.UserDN(alice), "uid=alice,ou=People,dc=helix,dc=local"; got != want {
		t.Errorf("UserDN = %q, want %q", got, want)
	}
	if got, want := testDir.GroupDN(alice), "cn=alice,ou=Groups,dc=helix,dc=local"; got != want {
		t.Errorf("GroupDN = %q, want %q", got, want)
	}
	if got, want := testDir.PeopleDN, "ou=People,dc=helix,dc=local"; got != want {
		t.Errorf("PeopleDN = %q, want %q", got, want)
	}
	if got, want := testDir.GroupsDN, "ou=Groups,dc=helix,dc=local"; got != want {
		t.Errorf("GroupsDN = %q, want %q", got, want)
	}
}

func TestUserEntryAttributes(t *testing.T) {
	e := testDir.UserEntry(alice)

	if e.DN != "uid=alice,ou=People,dc=helix,dc=local" {
		t.Errorf("DN = %q", e.DN)
	}
	want := map[string]string{
		"uid":           "alice",
		"cn":            "alice",
		"sn":            "alice",
		"mail":          "alice@example.com",
		"uidNumber":     "200001",
		"gidNumber":     "200001",
		"homeDirectory": "/home/alice",
		"loginShell":    "/usr/libexec/helix/session-launcher",
	}
	for attr, value := range want {
		got := e.Get(attr)
		if len(got) != 1 || got[0] != value {
			t.Errorf("attribute %s = %v, want [%s]", attr, got, value)
		}
	}

	classes := e.Get("objectClass")
	for _, oc := range []string{"top", "person", "organizationalPerson", "inetOrgPerson", "posixAccount"} {
		if !contains(classes, oc) {
			t.Errorf("objectClass %v missing %q", classes, oc)
		}
	}

	// The directory publishes identities, never credentials.
	for _, forbidden := range []string{"userPassword", "shadowLastChange"} {
		if e.Has(forbidden) {
			t.Errorf("user entry must not expose %s", forbidden)
		}
	}
}

func TestGroupEntryIsPrivatePrimaryGroup(t *testing.T) {
	e := testDir.GroupEntry(alice)

	if e.DN != "cn=alice,ou=Groups,dc=helix,dc=local" {
		t.Errorf("DN = %q", e.DN)
	}
	if got := e.Get("cn"); len(got) != 1 || got[0] != "alice" {
		t.Errorf("cn = %v", got)
	}
	if got := e.Get("gidNumber"); len(got) != 1 || got[0] != "200001" {
		t.Errorf("gidNumber = %v, want [200001]", got)
	}
	if !contains(e.Get("objectClass"), "posixGroup") {
		t.Errorf("objectClass = %v, want posixGroup", e.Get("objectClass"))
	}
	if e.Has("memberUid") {
		t.Error("private primary groups carry no supplementary membership")
	}
}

func TestEntryLookupIsCaseInsensitive(t *testing.T) {
	e := testDir.UserEntry(alice)
	if got := e.Get("UIDNUMBER"); len(got) != 1 || got[0] != "200001" {
		t.Errorf("Get(UIDNUMBER) = %v, want [200001]", got)
	}
	if !e.Has("objectclass") {
		t.Error("Has must match attribute names case-insensitively")
	}
	if e.Has("nosuchattribute") {
		t.Error("Has returned true for an absent attribute")
	}
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
