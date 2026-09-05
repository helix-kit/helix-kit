// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver; keeps CGO_ENABLED=0
)

// CachedUser is what the device remembers about someone the cloud has already
// authorized here.
//
// It exists so a device that cannot reach the cloud still knows who it has seen
// and what they were allowed to do. That is also why it is only ever written
// after a cloud-connected success: an unknown user must not be able to talk the
// device into believing in them while it is offline.
type CachedUser struct {
	UserID        string
	Username      string
	LinuxUID      uint32
	Scopes        []string
	PolicyVersion int
	RefreshedAt   time.Time
}

// HasScope reports whether the cached snapshot carries a scope.
func (u *CachedUser) HasScope(scope string) bool {
	for _, held := range u.Scopes {
		if held == scope {
			return true
		}
	}
	return false
}

// ErrNoCachedUser means the device has never successfully authorized this user.
var ErrNoCachedUser = errors.New("no cached user")

// Store is helix-authd's local state.
type Store struct {
	db *sql.DB
}

// OpenStore opens (and creates) the device's authentication state database.
func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create state directory: %w", err)
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db.SetMaxOpenConns(1) // single writer; avoids SQLITE_BUSY under WAL

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS cached_users (
		username       TEXT PRIMARY KEY,
		user_id        TEXT NOT NULL,
		linux_uid      INTEGER NOT NULL,
		scopes         TEXT NOT NULL,
		policy_version INTEGER NOT NULL,
		refreshed_at   INTEGER NOT NULL
	)`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create cached_users: %w", err)
	}

	// The state file names who may log in; it is not for other users to read.
	if err := os.Chmod(path, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("chmod %s: %w", path, err)
	}
	return &Store{db: db}, nil
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

// PutCachedUser records an authorization the cloud has just confirmed.
func (s *Store) PutCachedUser(user CachedUser) error {
	scopes, err := json.Marshal(user.Scopes)
	if err != nil {
		return fmt.Errorf("encode scopes: %w", err)
	}
	_, err = s.db.Exec(
		`INSERT INTO cached_users (username, user_id, linux_uid, scopes, policy_version, refreshed_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(username) DO UPDATE SET
		   user_id = excluded.user_id,
		   linux_uid = excluded.linux_uid,
		   scopes = excluded.scopes,
		   policy_version = excluded.policy_version,
		   refreshed_at = excluded.refreshed_at`,
		user.Username, user.UserID, int64(user.LinuxUID), string(scopes),
		user.PolicyVersion, user.RefreshedAt.UTC().Unix(),
	)
	if err != nil {
		return fmt.Errorf("cache user %q: %w", user.Username, err)
	}
	return nil
}

// CachedUser returns what the device remembers, or ErrNoCachedUser.
func (s *Store) CachedUser(username string) (*CachedUser, error) {
	var (
		user        CachedUser
		scopes      string
		uid         int64
		refreshedAt int64
	)
	err := s.db.QueryRow(
		`SELECT username, user_id, linux_uid, scopes, policy_version, refreshed_at
		 FROM cached_users WHERE username = ?`, username,
	).Scan(&user.Username, &user.UserID, &uid, &scopes, &user.PolicyVersion, &refreshedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoCachedUser
	}
	if err != nil {
		return nil, fmt.Errorf("read cached user %q: %w", username, err)
	}
	if uid < 0 || uid > 0xFFFFFFFF {
		return nil, fmt.Errorf("cached user %q has an out-of-range uid %d", username, uid)
	}
	if err := json.Unmarshal([]byte(scopes), &user.Scopes); err != nil {
		return nil, fmt.Errorf("decode cached scopes for %q: %w", username, err)
	}
	user.LinuxUID = uint32(uid)
	user.RefreshedAt = time.Unix(refreshedAt, 0).UTC()
	return &user, nil
}

// CachedUsers lists every remembered user, for background refresh.
func (s *Store) CachedUsers() ([]CachedUser, error) {
	rows, err := s.db.Query(
		`SELECT username, user_id, linux_uid, scopes, policy_version, refreshed_at
		 FROM cached_users ORDER BY username`)
	if err != nil {
		return nil, fmt.Errorf("list cached users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []CachedUser
	for rows.Next() {
		var (
			user        CachedUser
			scopes      string
			uid         int64
			refreshedAt int64
		)
		if err := rows.Scan(&user.Username, &user.UserID, &uid, &scopes,
			&user.PolicyVersion, &refreshedAt); err != nil {
			return nil, fmt.Errorf("scan cached user: %w", err)
		}
		if err := json.Unmarshal([]byte(scopes), &user.Scopes); err != nil {
			return nil, fmt.Errorf("decode cached scopes for %q: %w", user.Username, err)
		}
		user.LinuxUID = uint32(uid)
		user.RefreshedAt = time.Unix(refreshedAt, 0).UTC()
		out = append(out, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list cached users: %w", err)
	}
	return out, nil
}
