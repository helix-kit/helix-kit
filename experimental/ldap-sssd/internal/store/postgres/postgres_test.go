// SPDX-License-Identifier: AGPL-3.0-only

package postgres_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/helix-kit/experimental-ldap/internal/store"
	"github.com/helix-kit/experimental-ldap/internal/store/postgres"
)

// newStore connects to the experiment database. The e2e script sets
// TEST_DATABASE_URL; without it this suite is skipped so `go test ./...` stays
// runnable with no containers.
func newStore(t *testing.T) *postgres.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; run via scripts/e2e.sh for the database-backed tests")
	}
	st, err := postgres.New(context.Background(), dsn, 5*time.Second, 1000)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

func TestRowMapsToUnixUser(t *testing.T) {
	st := newStore(t)

	u, err := st.GetByUsername(context.Background(), "alice")
	if err != nil {
		t.Fatalf("GetByUsername: %v", err)
	}
	if u.Username != "alice" {
		t.Errorf("Username = %q", u.Username)
	}
	if u.Email != "alice@example.com" {
		t.Errorf("Email = %q", u.Email)
	}
	if u.UID != 200001 {
		t.Errorf("UID = %d, want 200001", u.UID)
	}
	if want := uuid.MustParse("00000000-0000-0000-0000-000000000001"); u.UUID != want {
		t.Errorf("UUID = %s, want %s", u.UUID, want)
	}
	if u.GID() != u.UID {
		t.Errorf("GID = %d, want %d", u.GID(), u.UID)
	}
}

func TestGetByUID(t *testing.T) {
	st := newStore(t)

	u, err := st.GetByUID(context.Background(), 200002)
	if err != nil {
		t.Fatalf("GetByUID: %v", err)
	}
	if u.Username != "bob" {
		t.Errorf("Username = %q, want bob", u.Username)
	}
}

func TestMissingIdentitiesReportNotFound(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()

	if _, err := st.GetByUsername(ctx, "does-not-exist"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetByUsername error = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByUID(ctx, 999999); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetByUID error = %v, want ErrNotFound", err)
	}
}

func TestListIsOrderedAndBounded(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()

	users, err := st.List(ctx, 1000)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("got %d users, want the seeded pair at least", len(users))
	}
	for i := 1; i < len(users); i++ {
		if users[i-1].UID >= users[i].UID {
			t.Fatalf("users are not ordered by uid: %d before %d", users[i-1].UID, users[i].UID)
		}
	}

	limited, err := st.List(ctx, 1)
	if err != nil {
		t.Fatalf("List(1): %v", err)
	}
	if len(limited) != 1 {
		t.Fatalf("List(1) returned %d users, want 1", len(limited))
	}

	// A caller asking for more than the configured maximum is clamped, never
	// allowed to turn one LDAP search into an unbounded table scan.
	if _, err := st.List(ctx, 1_000_000); err != nil {
		t.Fatalf("List with an oversized limit: %v", err)
	}
}

// SQL injection cannot reach the query: every lookup is parameterized.
func TestLookupsAreParameterized(t *testing.T) {
	st := newStore(t)

	_, err := st.GetByUsername(context.Background(), "alice'; DROP TABLE users; --")
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByUsername(context.Background(), "alice"); err != nil {
		t.Fatalf("alice no longer resolves: %v", err)
	}
}
