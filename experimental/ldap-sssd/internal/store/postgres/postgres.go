// SPDX-License-Identifier: AGPL-3.0-only

// Package postgres is the PostgreSQL-backed implementation of store.UserStore.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/store"
)

const columns = `uuid, email, username, linux_uid`

// Store reads Helix identities from PostgreSQL through a connection pool.
type Store struct {
	pool     *pgxpool.Pool
	timeout  time.Duration
	maxLimit int
}

// New opens the pool and verifies connectivity before returning.
func New(ctx context.Context, dsn string, timeout time.Duration, maxLimit int) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	s := &Store{pool: pool, timeout: timeout, maxLimit: maxLimit}
	if err := s.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

// Ping checks the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return s.pool.Ping(ctx)
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// GetByUsername resolves one identity by its Unix username.
func (s *Store) GetByUsername(ctx context.Context, username string) (*identity.UnixUser, error) {
	return s.one(ctx, `SELECT `+columns+` FROM users WHERE username = $1`, username)
}

// GetByUID resolves one identity by its Unix uid.
func (s *Store) GetByUID(ctx context.Context, uid uint32) (*identity.UnixUser, error) {
	return s.one(ctx, `SELECT `+columns+` FROM users WHERE linux_uid = $1`, int64(uid))
}

// List enumerates identities in uid order, bounded by the configured maximum.
func (s *Store) List(ctx context.Context, limit int) ([]identity.UnixUser, error) {
	if limit <= 0 || limit > s.maxLimit {
		limit = s.maxLimit
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	rows, err := s.pool.Query(ctx, `SELECT `+columns+` FROM users ORDER BY linux_uid LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var out []identity.UnixUser
	for rows.Next() {
		u, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	return out, nil
}

func (s *Store) one(ctx context.Context, sql string, arg any) (*identity.UnixUser, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	rows, err := s.pool.Query(ctx, sql, arg)
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("query user: %w", err)
		}
		return nil, store.ErrNotFound
	}
	u, err := scan(rows)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func scan(rows pgx.Rows) (*identity.UnixUser, error) {
	var (
		raw [16]byte
		u   identity.UnixUser
		uid int64
	)
	if err := rows.Scan(&raw, &u.Email, &u.Username, &uid); err != nil {
		return nil, fmt.Errorf("scan user: %w", err)
	}
	if uid < 0 || uid > 0xFFFFFFFF {
		return nil, fmt.Errorf("user %q: linux_uid %d out of range", u.Username, uid)
	}
	u.UUID = uuid.UUID(raw)
	u.UID = uint32(uid)
	if err := identity.ValidateUsername(u.Username); err != nil {
		return nil, err
	}
	return &u, nil
}

// IsNotFound reports whether err means "no such identity".
func IsNotFound(err error) bool { return errors.Is(err, store.ErrNotFound) }
