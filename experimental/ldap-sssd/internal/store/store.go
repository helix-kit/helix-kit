// SPDX-License-Identifier: AGPL-3.0-only

// Package store defines the narrow read-only view of Helix identities that the
// LDAP façade is allowed to take. The façade owns no user data of its own.
package store

import (
	"context"
	"errors"

	"github.com/helix-kit/experimental-ldap/internal/identity"
)

// ErrNotFound means no identity matched the lookup.
var ErrNotFound = errors.New("user not found")

// UserStore is the only door the LDAP layer has onto PostgreSQL. It is
// deliberately read-only: LDAP is a projection, never a second source of truth.
type UserStore interface {
	GetByUsername(ctx context.Context, username string) (*identity.UnixUser, error)
	GetByUID(ctx context.Context, uid uint32) (*identity.UnixUser, error)
	// List supports bounded enumeration only; callers must pass a hard limit.
	List(ctx context.Context, limit int) ([]identity.UnixUser, error)
}
