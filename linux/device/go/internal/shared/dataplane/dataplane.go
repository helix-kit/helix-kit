// SPDX-License-Identifier: AGPL-3.0-only

// Package dataplane opens a HelixStream data-plane session over whichever
// transport the control plane asked for, and is the one place that knows there
// is more than one.
//
// A stream app (shell, port-forward, file transfer) says "give me a mux for this
// session" and gets back a *stream.Session. Whether the bytes travel:
//
//	relay — the device dials the gateway over mTLS WebSocket and every byte
//	        crosses the cloud; or
//	p2p   — the device and the browser negotiate a direct WebRTC peer and the
//	        cloud carries only SDP/ICE,
//
// is a transport detail the app never sees. That is the whole point of modelling
// WebRTC as a transport under the mux rather than as a parallel stack: the apps'
// accept loops are identical either way.
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

// CandidateMethod is the method name a device app uses to trickle one of its ICE
// candidates to the browser. It rides an unsolicited response (empty requestId)
// on the app's own service, so it is a transport-level constant shared by every
// P2P-capable service rather than a per-service contract method.
const CandidateMethod = "candidate"

// dialTimeout bounds the relay WebSocket dial; the p2p path does not dial at all
// at open time (it returns an offer and finishes ICE in the background).
const dialTimeout = 15 * time.Second

// OpenParams is an `open` command reduced to what the data plane needs. Each app
// builds one from its own generated contract type, so the transport layer is not
// coupled to any single service's schema.
type OpenParams struct {
	SessionID string
	// Transport is "relay" (default) or "p2p".
	Transport string
	// Relay only: the gateway data-plane URL and the session token.
	DataURL string
	Token   string
	// P2P only: ICE servers minted for the caller by /api/ice-config, and an
	// optional "relay" policy that forces the connection through TURN.
	ICEServers         []peer.ICEServer
	ICETransportPolicy string
}

// ErrNoDataURL is returned when a relay open arrives without a data-plane URL.
var ErrNoDataURL = errors.New("relay transport requires a dataUrl")

// Session is a data-plane session. For the relay transport the mux is live as
// soon as Open returns; for p2p it becomes live once the browser answers and ICE
// completes, so consumers take it from Wait rather than from a field.
type Session struct {
	// Offer is the device's SDP offer — p2p only, empty for relay. The app hands
	// it straight back in its `open` response.
	Offer string

	peer *peer.Peer
	log  *slog.Logger

	mu      sync.Mutex
	mux     *stream.Session
	muxErr  error
	settled chan struct{}
}

// Open starts a data-plane session. It never blocks on the peer connection:
// on the p2p path it returns as soon as the SDP offer exists, so the app can
// answer the control-plane request immediately and let ICE finish in the
// background. sendCandidate ships one locally-gathered ICE candidate back to the
// browser (over the control plane); it is nil for relay.
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

// awaitPeer publishes the mux once the DataChannel opens (or the failure if it
// never does).
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

// Wait blocks until the mux is live. Relay returns immediately; p2p returns once
// the browser has answered and the DataChannel is open.
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

// ErrUnknownSession is what an app returns when a signal names a session it never
// opened.
var ErrUnknownSession = errors.New("unknown session")

var errNotAPeer = errors.New("session is not a peer session")

// Signal applies the browser's half of the WebRTC handshake — its SDP answer, its
// trickled ICE candidates, or both. Every P2P-capable app's `signal` handler is
// exactly this, so it lives here rather than being copied per service.
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

// StreamCount reports the live streams on the mux — 0 while a peer is still
// connecting. Apps surface it in `list`.
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
