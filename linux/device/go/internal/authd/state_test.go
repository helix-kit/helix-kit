// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "nested", "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func sampleUser() CachedUser {
	return CachedUser{
		UserID:        testUserID,
		Username:      "alice",
		LinuxUID:      200001,
		Scopes:        []string{DeviceLoginScope, "app.foo.read"},
		PolicyVersion: 7,
		RefreshedAt:   time.Now().UTC().Truncate(time.Second),
	}
}

func TestStoreRoundTrip(t *testing.T) {
	store := openTestStore(t)
	user := sampleUser()

	if err := store.PutCachedUser(user); err != nil {
		t.Fatalf("PutCachedUser: %v", err)
	}

	got, err := store.CachedUser("alice")
	if err != nil {
		t.Fatalf("CachedUser: %v", err)
	}
	if got.UserID != user.UserID || got.LinuxUID != user.LinuxUID || got.PolicyVersion != 7 {
		t.Errorf("got %+v, want %+v", got, user)
	}
	if !got.RefreshedAt.Equal(user.RefreshedAt) {
		t.Errorf("refreshedAt = %s, want %s", got.RefreshedAt, user.RefreshedAt)
	}
	if !got.HasScope(DeviceLoginScope) || got.HasScope("app.bar.write") {
		t.Errorf("scopes round-tripped as %v", got.Scopes)
	}
}

// A user the device has never authorized must be reported as absent, not as an
// empty record that later checks might treat as valid.
func TestStoreReportsUnknownUsers(t *testing.T) {
	store := openTestStore(t)

	if _, err := store.CachedUser("nobody"); !errors.Is(err, ErrNoCachedUser) {
		t.Fatalf("error = %v, want ErrNoCachedUser", err)
	}
}

// Re-authorizing replaces the snapshot rather than accumulating stale ones.
func TestStoreRefreshReplacesTheSnapshot(t *testing.T) {
	store := openTestStore(t)
	user := sampleUser()
	if err := store.PutCachedUser(user); err != nil {
		t.Fatalf("PutCachedUser: %v", err)
	}

	user.Scopes = []string{DeviceLoginScope}
	user.PolicyVersion = 9
	if err := store.PutCachedUser(user); err != nil {
		t.Fatalf("PutCachedUser: %v", err)
	}

	got, err := store.CachedUser("alice")
	if err != nil {
		t.Fatalf("CachedUser: %v", err)
	}
	if got.PolicyVersion != 9 || len(got.Scopes) != 1 {
		t.Fatalf("got %+v, want the newer snapshot", got)
	}

	users, err := store.CachedUsers()
	if err != nil {
		t.Fatalf("CachedUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("got %d cached users, want 1", len(users))
	}
}

func TestStoreListsEveryUser(t *testing.T) {
	store := openTestStore(t)

	alice := sampleUser()
	bob := CachedUser{
		UserID: "user_bob", Username: "bob", LinuxUID: 200002,
		Scopes: []string{DeviceLoginScope}, PolicyVersion: 7, RefreshedAt: time.Now().UTC(),
	}
	for _, user := range []CachedUser{bob, alice} {
		if err := store.PutCachedUser(user); err != nil {
			t.Fatalf("PutCachedUser(%s): %v", user.Username, err)
		}
	}

	users, err := store.CachedUsers()
	if err != nil {
		t.Fatalf("CachedUsers: %v", err)
	}
	if len(users) != 2 || users[0].Username != "alice" || users[1].Username != "bob" {
		t.Fatalf("got %+v, want alice then bob", users)
	}
}

// The file names who may log in, so it must not be readable by them.
func TestStoreFileIsRootOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer func() { _ = store.Close() }()

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("state file mode = %o, want 600", perm)
	}
}

// State has to survive a restart, or a device reboot would silently revoke every
// user's offline access.
func TestStoreSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")

	first, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	if putErr := first.PutCachedUser(sampleUser()); putErr != nil {
		t.Fatalf("PutCachedUser: %v", putErr)
	}
	if closeErr := first.Close(); closeErr != nil {
		t.Fatalf("Close: %v", closeErr)
	}

	second, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = second.Close() }()

	if _, err := second.CachedUser("alice"); err != nil {
		t.Fatalf("alice did not survive the reopen: %v", err)
	}
}
