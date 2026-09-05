// SPDX-License-Identifier: AGPL-3.0-only

// Package memstore is an in-memory store.UserStore used by the LDAP tests, so
// the protocol layer can be exercised end-to-end without PostgreSQL.
package memstore

import (
	"context"
	"sort"
	"sync"

	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/store"
)

// Store holds users in memory, keyed by username.
type Store struct {
	mu    sync.RWMutex
	users map[string]identity.UnixUser
	// Err, when set, is returned by every method to simulate a backend outage.
	Err error
}

// New builds a store seeded with users.
func New(users ...identity.UnixUser) *Store {
	s := &Store{users: make(map[string]identity.UnixUser, len(users))}
	for _, u := range users {
		s.users[u.Username] = u
	}
	return s
}

// Put inserts or replaces a user.
func (s *Store) Put(u identity.UnixUser) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.Username] = u
}

// Delete removes a user.
func (s *Store) Delete(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.users, username)
}

// GetByUsername implements store.UserStore.
func (s *Store) GetByUsername(_ context.Context, username string) (*identity.UnixUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.Err != nil {
		return nil, s.Err
	}
	u, ok := s.users[username]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &u, nil
}

// GetByUID implements store.UserStore.
func (s *Store) GetByUID(_ context.Context, uid uint32) (*identity.UnixUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.Err != nil {
		return nil, s.Err
	}
	for _, u := range s.users {
		if u.UID == uid {
			return &u, nil
		}
	}
	return nil, store.ErrNotFound
}

// List implements store.UserStore.
func (s *Store) List(_ context.Context, limit int) ([]identity.UnixUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.Err != nil {
		return nil, s.Err
	}
	out := make([]identity.UnixUser, 0, len(s.users))
	for _, u := range s.users {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UID < out[j].UID })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
