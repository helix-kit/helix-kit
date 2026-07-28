// SPDX-License-Identifier: AGPL-3.0-only

package dataplane

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/stream"
)

// Manager owns a stream app's sessions: opening them over whichever transport was
// asked for, accepting the streams the far end opens on them, and tearing them
// down.
//
// Every stream app needs exactly this, and the only thing that differs between
// them is what they DO with an accepted stream — a shell forks a PTY, port-forward
// dials a TCP target, files serves a transfer. So that is the one thing an app
// supplies (onStream); the lifecycle lives here once instead of being copied into
// each service.
type Manager struct {
	cfg *config.Config
	log *slog.Logger

	mu       sync.Mutex
	sessions map[string]*entry
}

type entry struct {
	session   *Session
	cancel    context.CancelFunc
	createdAt time.Time
	meta      any
}

// SessionInfo is one live session, for an app's `list`.
type SessionInfo struct {
	ID        string
	CreatedAt time.Time
	// Streams currently open on it (terminals, connections, transfers).
	Streams int
	// Meta is whatever the app attached at Open — port-forward keeps its target
	// here, so the manager can own the session table without knowing what an app's
	// sessions mean.
	Meta any
}

// NewManager builds an empty session table.
func NewManager(cfg *config.Config, log *slog.Logger) *Manager {
	return &Manager{cfg: cfg, log: log, sessions: map[string]*entry{}}
}

// OpenOptions is one `open` command, reduced to what the data plane needs.
type OpenOptions struct {
	Params OpenParams
	// Meta is attached to the session and returned in List.
	Meta any
	// SendCandidate trickles a locally-gathered ICE candidate to the browser.
	SendCandidate func(candidate string)
	// OnStream handles one stream the far end opened. Called on its own goroutine.
	OnStream func(*stream.Stream)
}

// Open starts a session and its accept loop, and returns the SDP offer (empty on
// the relay transport). It never blocks on the peer connection: on the p2p path the
// caller must answer the control-plane request with this offer before the browser
// can complete the handshake.
func (m *Manager) Open(rootCtx context.Context, opts OpenOptions) (string, error) {
	sCtx, cancel := context.WithCancel(rootCtx)
	session, err := Open(sCtx, m.cfg, m.log, opts.Params, opts.SendCandidate)
	if err != nil {
		cancel()
		return "", err
	}

	e := &entry{session: session, cancel: cancel, createdAt: time.Now(), meta: opts.Meta}
	id := opts.Params.SessionID
	m.mu.Lock()
	if old := m.sessions[id]; old != nil {
		old.cancel() // a re-open of the same id replaces the previous session
	}
	m.sessions[id] = e
	m.mu.Unlock()

	go m.acceptLoop(sCtx, id, e, opts.OnStream)
	m.log.Info("session opened", "session", id, "transport", opts.Params.Transport)
	return session.Offer, nil
}

func (m *Manager) acceptLoop(
	ctx context.Context,
	id string,
	e *entry,
	onStream func(*stream.Stream),
) {
	defer func() {
		e.session.Close()
		m.mu.Lock()
		if m.sessions[id] == e {
			delete(m.sessions, id)
		}
		m.mu.Unlock()
		m.log.Info("session closed", "session", id)
	}()
	go func() {
		<-ctx.Done()
		e.session.Close()
	}()

	// Relay is live already; a peer becomes live once the browser answers and ICE
	// completes. The loop below is identical either way — the whole point of
	// modelling WebRTC as a transport under the mux.
	mux, err := e.session.Wait(ctx)
	if err != nil {
		m.log.Warn("data plane never came up", "session", id, "err", err)
		return
	}
	for {
		st, err := mux.Accept()
		if err != nil {
			return
		}
		go onStream(st)
	}
}

// Signal applies the browser's half of the WebRTC handshake to a session.
func (m *Manager) Signal(sessionID string, answer string, candidate string) error {
	m.mu.Lock()
	e := m.sessions[sessionID]
	m.mu.Unlock()
	if e == nil {
		return ErrUnknownSession
	}
	return e.session.Signal(answer, candidate)
}

// Close tears one session down; its accept loop does the rest.
func (m *Manager) Close(sessionID string) {
	m.mu.Lock()
	e := m.sessions[sessionID]
	m.mu.Unlock()
	if e != nil {
		e.cancel()
	}
}

// CloseAll tears every session down (app shutdown).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	for _, e := range m.sessions {
		e.cancel()
	}
	m.mu.Unlock()
}

// List reports every live session, for an app's `list` method.
func (m *Manager) List() []SessionInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SessionInfo, 0, len(m.sessions))
	for id, e := range m.sessions {
		out = append(out, SessionInfo{
			ID:        id,
			CreatedAt: e.createdAt,
			Streams:   e.session.StreamCount(),
			Meta:      e.meta,
		})
	}
	return out
}
