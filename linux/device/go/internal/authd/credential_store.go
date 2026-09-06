// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// CredentialState is where a persistent credential is in its life.
type CredentialState string

const (
	// CredentialPending has been enrolled but not yet proved by paste-back.
	CredentialPending CredentialState = "PENDING"
	// CredentialActive can be used to log in.
	CredentialActive CredentialState = "ACTIVE"
	// CredentialExpired ran out of time. Terminal.
	CredentialExpired CredentialState = "EXPIRED"
	// CredentialRevoked was replaced or withdrawn. Terminal.
	CredentialRevoked CredentialState = "REVOKED"
)

// StoredCredential is the device's record. It never contains the secret.
type StoredCredential struct {
	ID          string
	Username    string
	UserID      string
	LinuxUID    uint32
	Verifier    string
	State       CredentialState
	DurationSec int
	CreatedAt   time.Time
	ActivatedAt *time.Time
	ExpiresAt   *time.Time
}

// Expired reports whether an active credential has run out of time.
func (c *StoredCredential) Expired(now time.Time) bool {
	return c.ExpiresAt != nil && now.After(*c.ExpiresAt)
}

// ErrNoCredential means no such credential is on this device.
var ErrNoCredential = errors.New("no such credential")

// ErrCredentialNotPending means a credential was not in a state that allows the
// transition being attempted.
var ErrCredentialNotPending = errors.New("credential is not pending")

const createCredentialsTable = `CREATE TABLE IF NOT EXISTS credentials (
	id           TEXT PRIMARY KEY,
	username     TEXT NOT NULL,
	user_id      TEXT NOT NULL,
	linux_uid    INTEGER NOT NULL,
	verifier     TEXT NOT NULL,
	state        TEXT NOT NULL,
	duration_sec INTEGER NOT NULL,
	created_at   INTEGER NOT NULL,
	activated_at INTEGER,
	expires_at   INTEGER
)`

// PutPendingCredential records a freshly enrolled credential.
//
// Any earlier pending enrollment for the same user is dropped first: only one
// enrollment may be in flight, so an abandoned attempt cannot later be activated
// by a credential the user finds lying around.
func (s *Store) PutPendingCredential(cred StoredCredential) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(
		`DELETE FROM credentials WHERE username = ? AND state = ?`,
		cred.Username, string(CredentialPending),
	); err != nil {
		return fmt.Errorf("clear pending credentials: %w", err)
	}

	if _, err := tx.Exec(
		`INSERT INTO credentials (id, username, user_id, linux_uid, verifier, state, duration_sec, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		cred.ID, cred.Username, cred.UserID, int64(cred.LinuxUID), cred.Verifier,
		string(CredentialPending), cred.DurationSec, cred.CreatedAt.UTC().Unix(),
	); err != nil {
		return fmt.Errorf("store pending credential: %w", err)
	}
	return tx.Commit()
}

// ActivateCredential turns a pending credential into the one active credential
// for its user, in a single transaction.
//
// Any other credential the user holds on this device is revoked at the same
// moment, which is what keeps "at most one active" true rather than merely
// intended.
func (s *Store) ActivateCredential(id string, now time.Time, lifetime time.Duration) (*StoredCredential, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var (
		username string
		state    string
	)
	err = tx.QueryRow(`SELECT username, state FROM credentials WHERE id = ?`, id).Scan(&username, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoCredential
	}
	if err != nil {
		return nil, fmt.Errorf("read credential: %w", err)
	}
	if CredentialState(state) != CredentialPending {
		return nil, ErrCredentialNotPending
	}

	if _, err := tx.Exec(
		`UPDATE credentials SET state = ? WHERE username = ? AND id != ? AND state = ?`,
		string(CredentialRevoked), username, id, string(CredentialActive),
	); err != nil {
		return nil, fmt.Errorf("revoke previous credential: %w", err)
	}

	expiresAt := now.Add(lifetime)
	if _, err := tx.Exec(
		`UPDATE credentials SET state = ?, activated_at = ?, expires_at = ? WHERE id = ?`,
		string(CredentialActive), now.UTC().Unix(), expiresAt.UTC().Unix(), id,
	); err != nil {
		return nil, fmt.Errorf("activate credential: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return s.Credential(id)
}

// Credential reads one record by id.
func (s *Store) Credential(id string) (*StoredCredential, error) {
	return s.scanCredential(s.db.QueryRow(
		`SELECT id, username, user_id, linux_uid, verifier, state, duration_sec, created_at, activated_at, expires_at
		 FROM credentials WHERE id = ?`, id))
}

// ActiveCredential returns a user's active credential, if they have one.
func (s *Store) ActiveCredential(username string) (*StoredCredential, error) {
	return s.scanCredential(s.db.QueryRow(
		`SELECT id, username, user_id, linux_uid, verifier, state, duration_sec, created_at, activated_at, expires_at
		 FROM credentials WHERE username = ? AND state = ?`, username, string(CredentialActive)))
}

// RevokeCredential ends a credential immediately. Rotation calls this before the
// replacement exists, so an abandoned rotation leaves the user with nothing --
// which is safer than leaving the credential they meant to replace.
func (s *Store) RevokeCredential(id string) error {
	_, err := s.db.Exec(
		`UPDATE credentials SET state = ? WHERE id = ? AND state IN (?, ?)`,
		string(CredentialRevoked), id, string(CredentialActive), string(CredentialPending))
	if err != nil {
		return fmt.Errorf("revoke credential %s: %w", id, err)
	}
	return nil
}

// ExpireCredential marks a credential as timed out.
func (s *Store) ExpireCredential(id string) error {
	_, err := s.db.Exec(
		`UPDATE credentials SET state = ? WHERE id = ? AND state IN (?, ?)`,
		string(CredentialExpired), id, string(CredentialActive), string(CredentialPending))
	if err != nil {
		return fmt.Errorf("expire credential %s: %w", id, err)
	}
	return nil
}

// PurgeStalePending drops enrollments nobody ever completed.
func (s *Store) PurgeStalePending(olderThan time.Time) error {
	_, err := s.db.Exec(
		`DELETE FROM credentials WHERE state = ? AND created_at < ?`,
		string(CredentialPending), olderThan.UTC().Unix())
	if err != nil {
		return fmt.Errorf("purge stale enrollments: %w", err)
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Store) scanCredential(row rowScanner) (*StoredCredential, error) {
	var (
		cred        StoredCredential
		uid         int64
		state       string
		createdAt   int64
		activatedAt sql.NullInt64
		expiresAt   sql.NullInt64
	)
	err := row.Scan(&cred.ID, &cred.Username, &cred.UserID, &uid, &cred.Verifier,
		&state, &cred.DurationSec, &createdAt, &activatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoCredential
	}
	if err != nil {
		return nil, fmt.Errorf("read credential: %w", err)
	}

	cred.LinuxUID = uint32(uid)
	cred.State = CredentialState(state)
	cred.CreatedAt = time.Unix(createdAt, 0).UTC()
	if activatedAt.Valid {
		at := time.Unix(activatedAt.Int64, 0).UTC()
		cred.ActivatedAt = &at
	}
	if expiresAt.Valid {
		at := time.Unix(expiresAt.Int64, 0).UTC()
		cred.ExpiresAt = &at
	}
	return &cred, nil
}
