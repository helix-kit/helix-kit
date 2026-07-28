// SPDX-License-Identifier: AGPL-3.0-only

// Package dataplane opens a HelixStream data-plane session over whichever transport (relay or p2p) the control plane asked for.
package dataplane

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/helix-kit/helix-device/internal/peer"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/stream"
)

// Transport kinds, as they appear on the wire in an `open` command.
const (
	TransportRelay = "relay"
	TransportP2P   = "p2p"
)

// CandidateMethod is the method name a device app uses to trickle one of its ICE candidates to the browser.
const CandidateMethod = "candidate"

const dialTimeout = 15 * time.Second

// OpenParams is an `open` command reduced to what the data plane needs.
type OpenParams struct {
	SessionID string
	// Transport is "relay" (default) or "p2p".
	Transport string
	// Relay only: the gateway data-plane URL and the session token.
	DataURL string
	Token   string
	// P2P only: ICE servers minted by /api/ice-config, and an optional "relay" policy that forces the connection through TURN.
	ICEServers         []peer.ICEServer
	ICETransportPolicy string
}

// ErrNoDataURL is returned when a relay open arrives without a data-plane URL.
var ErrNoDataURL = errors.New("relay transport requires a dataUrl")

// Session is a data-plane session. Relay is live once Open returns; p2p becomes live once the browser answers, so consumers take the mux from Wait.
type Session struct {
	// Offer is the device's SDP offer — p2p only, empty for relay.
	Offer string

	peer *peer.Peer
	log  *slog.Logger

	mu      sync.Mutex
	mux     *stream.Session
	muxErr  error
	settled chan struct{}
}

// Open starts a data-plane session, never blocking on the peer connection; on p2p it returns once the SDP offer exists and ICE finishes in the background. sendCandidate is nil for relay.
func Open(
	ctx context.Context,
	cfg *config.Config,
	log *slog.Logger,
	params OpenParams,
	sendCandidate func(candidate string),
) (*Session, error) {
	s := &Session{log: log, settled: make(chan struct{})}

	if params.Transport == TransportP2P {
		p, offer, err := peer.New(peer.Config{
			ICEServers:      params.ICEServers,
			TransportPolicy: params.ICETransportPolicy,
			SendCandidate:   sendCandidate,
			Logger:          log,
		})
		if err != nil {
			return nil, fmt.Errorf("peer negotiation failed: %w", err)
		}
		s.peer = p
		s.Offer = offer
		go s.awaitPeer(ctx, p)
		return s, nil
	}

	if params.DataURL == "" {
		return nil, ErrNoDataURL
	}
	tlsCfg, err := config.ClientTLS(cfg.Gateway.CACert, cfg.Gateway.ClientCert, cfg.Gateway.ClientKey)
	if err != nil {
		return nil, err
	}
	header := http.Header{}
	if params.SessionID != "" {
		header.Set("X-Helix-Session", params.SessionID)
	}
	if params.Token != "" {
		header.Set("X-Helix-Token", params.Token)
	}
	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	transport, err := stream.DialWebSocket(dialCtx, params.DataURL, tlsCfg, header)
	cancel()
	if err != nil {
		return nil, fmt.Errorf("data-plane dial failed: %w", err)
	}
	s.settle(stream.NewSession(transport, stream.Config{Client: false, Logger: log}), nil)
	return s, nil
}

func (s *Session) awaitPeer(ctx context.Context, p *peer.Peer) {
	transport, err := p.Transport(ctx)
	if err != nil {
		s.settle(nil, err)
		return
	}
	s.settle(stream.NewSession(transport, stream.Config{Client: false, Logger: s.log}), nil)
}

func (s *Session) settle(mux *stream.Session, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.settled:
		return
	default:
	}
	s.mux, s.muxErr = mux, err
	close(s.settled)
}

// Wait blocks until the mux is live (immediately for relay; after the browser answers for p2p).
func (s *Session) Wait(ctx context.Context) (*stream.Session, error) {
	select {
	case <-s.settled:
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.mux, s.muxErr
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// ErrUnknownSession is returned when a signal names a session that was never opened.
var ErrUnknownSession = errors.New("unknown session")

var errNotAPeer = errors.New("session is not a peer session")

// Signal applies the browser's half of the WebRTC handshake — its SDP answer, its trickled ICE candidates, or both.
func (s *Session) Signal(answer string, candidate string) error {
	if answer != "" {
		if err := s.acceptAnswer(answer); err != nil {
			return err
		}
	}
	if candidate != "" {
		if err := s.addCandidate(candidate); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) acceptAnswer(sdp string) error {
	if s.peer == nil {
		return errNotAPeer
	}
	return s.peer.AcceptAnswer(sdp)
}

func (s *Session) addCandidate(candidate string) error {
	if s.peer == nil {
		return errNotAPeer
	}
	return s.peer.AddCandidate(candidate)
}

// StreamCount reports the live streams on the mux — 0 while a peer is still connecting.
func (s *Session) StreamCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.mux == nil {
		return 0
	}
	return s.mux.StreamCount()
}

// Close tears down the mux and, for p2p, the peer connection.
func (s *Session) Close() {
	s.mu.Lock()
	mux := s.mux
	s.mu.Unlock()
	if mux != nil {
		mux.Close()
	}
	if s.peer != nil {
		_ = s.peer.Close()
	}
}
