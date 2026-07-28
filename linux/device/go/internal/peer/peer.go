// SPDX-License-Identifier: AGPL-3.0-only

// Package peer is the device side of the Helix WebRTC data-plane transport.
package peer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"

	"github.com/helix-kit/helix-device/internal/stream"
)

const dataChannelLabel = "helix-stream"

// ICEServer is a STUN/TURN server, decoupled from the generated contract and pion's own type.
type ICEServer struct {
	URLs       []string
	Username   string
	Credential string
}

// Config negotiates one peer.
type Config struct {
	ICEServers []ICEServer
	// TransportPolicy is "relay" to force traffic through TURN; "" or "all" allows direct candidates.
	TransportPolicy string
	// SendCandidate ships one locally-gathered ICE candidate to the remote peer. Called from pion's goroutines.
	SendCandidate func(candidate string)
	// Tracks are outbound media tracks; they MUST be declared here since they attach before the offer and Helix does not renegotiate.
	Tracks []TrackSpec
	Logger *slog.Logger
}

// Peer is one negotiated WebRTC connection to a browser.
type Peer struct {
	pc  *webrtc.PeerConnection
	log *slog.Logger

	mu         sync.Mutex
	pending    []webrtc.ICECandidateInit
	haveAnswer bool

	tracks    map[string]*Track
	transport *dataChannelTransport
	ready     chan struct{}
	readyOnce sync.Once
	failed    chan struct{}
	failOnce  sync.Once
}

func toPionICEServers(servers []ICEServer) []webrtc.ICEServer {
	out := make([]webrtc.ICEServer, 0, len(servers))
	for _, s := range servers {
		out = append(out, webrtc.ICEServer{
			URLs:           s.URLs,
			Username:       s.Username,
			Credential:     s.Credential,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}
	return out
}

// New builds a peer, creates the reliable DataChannel and returns the SDP offer for the browser; ICE gathering continues in the background.
func New(cfg Config) (*Peer, string, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	// Query+gather mDNS to resolve a browser's ".local" host candidates; without it same-LAN peers behind identical NAT often fail.
	settings := webrtc.SettingEngine{}
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeQueryAndGather)

	// A custom API starts with an EMPTY MediaEngine, so tracks would silently negotiate no codec without registering defaults.
	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		return nil, "", fmt.Errorf("register codecs: %w", err)
	}
	interceptors := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(media, interceptors); err != nil {
		return nil, "", fmt.Errorf("register interceptors: %w", err)
	}
	api := webrtc.NewAPI(
		webrtc.WithSettingEngine(settings),
		webrtc.WithMediaEngine(media),
		webrtc.WithInterceptorRegistry(interceptors),
	)

	rtcConfig := webrtc.Configuration{ICEServers: toPionICEServers(cfg.ICEServers)}
	if cfg.TransportPolicy == "relay" {
		rtcConfig.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}

	pc, err := api.NewPeerConnection(rtcConfig)
	if err != nil {
		return nil, "", fmt.Errorf("new peer connection: %w", err)
	}

	p := &Peer{
		pc:     pc,
		log:    cfg.Logger,
		tracks: map[string]*Track{},
		ready:  make(chan struct{}),
		failed: make(chan struct{}),
	}

	// An m-line can only be negotiated if the track exists before the offer.
	if trackErr := p.addTracks(cfg.Tracks); trackErr != nil {
		_ = pc.Close()
		return nil, "", trackErr
	}

	ordered := true
	dc, err := pc.CreateDataChannel(dataChannelLabel, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		_ = pc.Close()
		return nil, "", fmt.Errorf("create data channel: %w", err)
	}
	p.transport = newDataChannelTransport(dc)
	dc.OnOpen(func() {
		p.readyOnce.Do(func() { close(p.ready) })
	})

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil || cfg.SendCandidate == nil {
			return
		}
		encoded, marshalErr := json.Marshal(c.ToJSON())
		if marshalErr != nil {
			p.log.Warn("peer: encode ICE candidate failed", "err", marshalErr)
			return
		}
		cfg.SendCandidate(string(encoded))
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		p.log.Info("peer: connection state", "state", state.String())
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			p.failOnce.Do(func() { close(p.failed) })
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		_ = pc.Close()
		return nil, "", fmt.Errorf("create offer: %w", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		_ = pc.Close()
		return nil, "", fmt.Errorf("set local description: %w", err)
	}

	return p, offer.SDP, nil
}

// AcceptAnswer applies the browser's SDP answer and flushes any ICE candidates that arrived before it.
func (p *Peer) AcceptAnswer(sdp string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.haveAnswer {
		return nil // a duplicate answer is a no-op, not an error
	}
	answer := webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}
	if err := p.pc.SetRemoteDescription(answer); err != nil {
		return fmt.Errorf("set remote description: %w", err)
	}
	p.haveAnswer = true
	for _, candidate := range p.pending {
		if err := p.pc.AddICECandidate(candidate); err != nil {
			p.log.Warn("peer: add buffered ICE candidate failed", "err", err)
		}
	}
	p.pending = nil
	return nil
}

// AddCandidate applies one remote ICE candidate, buffering it until the answer lands (pion rejects candidates before the remote description).
func (p *Peer) AddCandidate(encoded string) error {
	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal([]byte(encoded), &candidate); err != nil {
		return fmt.Errorf("decode ICE candidate: %w", err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.haveAnswer {
		p.pending = append(p.pending, candidate)
		return nil
	}
	if err := p.pc.AddICECandidate(candidate); err != nil {
		return fmt.Errorf("add ICE candidate: %w", err)
	}
	return nil
}

// ErrPeerFailed is returned when the connection fails before the channel opens.
var ErrPeerFailed = errors.New("peer connection failed")

// Transport blocks until the DataChannel is open and returns it as a stream.Transport.
func (p *Peer) Transport(ctx context.Context) (stream.Transport, error) {
	select {
	case <-p.ready:
		return p.transport, nil
	case <-p.failed:
		return nil, ErrPeerFailed
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Close tears the peer down.
func (p *Peer) Close() error { return p.pc.Close() }
