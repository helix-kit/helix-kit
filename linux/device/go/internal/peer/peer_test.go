// SPDX-License-Identifier: AGPL-3.0-only

package peer_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/helix-kit/helix-device/internal/peer"
	"github.com/helix-kit/helix-device/internal/stream"
)

// relay stands in for the control plane, buffering gathered candidates until a destination is attached.
type relay struct {
	mu      sync.Mutex
	deliver func(string)
	pending []string
}

func (r *relay) send(candidate string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.deliver == nil {
		r.pending = append(r.pending, candidate)
		return
	}
	r.deliver(candidate)
}

func (r *relay) to(deliver func(string)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deliver = deliver
	for _, candidate := range r.pending {
		deliver(candidate)
	}
	r.pending = nil
}

// browser stands in for the browser half of a Helix peer: it answers the device's offer and speaks HelixStream over the DataChannel.
type browser struct {
	pc      *webrtc.PeerConnection
	session chan *stream.Session
}

func newBrowser(t *testing.T, sendCandidate func(string)) *browser {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("browser peer connection: %v", err)
	}
	b := &browser{pc: pc, session: make(chan *stream.Session, 1)}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		encoded, marshalErr := json.Marshal(c.ToJSON())
		if marshalErr != nil {
			return
		}
		sendCandidate(string(encoded))
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		dc.OnOpen(func() {
			b.session <- stream.NewSession(peer.WrapDataChannel(dc), stream.Config{Client: true})
		})
	})
	return b
}

func (b *browser) answer(t *testing.T, offer string) string {
	t.Helper()
	if err := b.pc.SetRemoteDescription(
		webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer},
	); err != nil {
		t.Fatalf("browser set remote: %v", err)
	}
	answer, err := b.pc.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("browser create answer: %v", err)
	}
	if err := b.pc.SetLocalDescription(answer); err != nil {
		t.Fatalf("browser set local: %v", err)
	}
	return answer.SDP
}

func (b *browser) addCandidate(t *testing.T, encoded string) {
	t.Helper()
	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal([]byte(encoded), &candidate); err != nil {
		t.Fatalf("browser decode candidate: %v", err)
	}
	if err := b.pc.AddICECandidate(candidate); err != nil {
		t.Logf("browser add candidate: %v", err)
	}
}

// connect negotiates a real device<->browser peer over loopback ICE, trickling candidates like the control plane does.
func connect(t *testing.T) (*stream.Session, *stream.Session) {
	t.Helper()

	toBrowser := &relay{}
	device, offer, err := peer.New(peer.Config{SendCandidate: toBrowser.send})
	if err != nil {
		t.Fatalf("device peer: %v", err)
	}
	t.Cleanup(func() { _ = device.Close() })

	b := newBrowser(t, func(c string) {
		if addErr := device.AddCandidate(c); addErr != nil {
			t.Logf("device add candidate: %v", addErr)
		}
	})
	t.Cleanup(func() { _ = b.pc.Close() })
	toBrowser.to(func(c string) { b.addCandidate(t, c) })

	if answerErr := device.AcceptAnswer(b.answer(t, offer)); answerErr != nil {
		t.Fatalf("device accept answer: %v", answerErr)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	transport, err := device.Transport(ctx)
	if err != nil {
		t.Fatalf("device transport: %v", err)
	}
	deviceSession := stream.NewSession(transport, stream.Config{Client: false})
	t.Cleanup(func() { _ = deviceSession.Close() })

	select {
	case browserSession := <-b.session:
		t.Cleanup(func() { _ = browserSession.Close() })
		return deviceSession, browserSession
	case <-ctx.Done():
		t.Fatal("browser data channel never opened")
		return nil, nil
	}
}

// TestHelixStreamOverDataChannel proves the mux and its flow control work over a DataChannel unchanged.
func TestHelixStreamOverDataChannel(t *testing.T) {
	deviceSession, browserSession := connect(t)

	go func() {
		st, err := deviceSession.Accept()
		if err != nil {
			return
		}
		_, _ = io.Copy(st, st)
		_ = st.Close()
	}()

	st, err := browserSession.Open([]byte(`{"hello":"peer"}`))
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}

	// Big enough to exhaust the credit window and push past the send-buffer high-water mark, exercising flow control and backpressure.
	payload := make([]byte, 4<<20)
	if _, err := rand.Read(payload); err != nil {
		t.Fatalf("rand: %v", err)
	}

	go func() {
		_, _ = st.Write(payload)
		_ = st.CloseWrite()
	}()

	got := make([]byte, 0, len(payload))
	buf := make([]byte, 64<<10)
	for len(got) < len(payload) {
		n, readErr := st.Read(buf)
		got = append(got, buf[:n]...)
		if readErr != nil {
			break
		}
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("echo mismatch: got %d bytes, want %d", len(got), len(payload))
	}
}

// TestMediaTrackOnTheSamePeer proves media rides the same peer as the mux.
func TestMediaTrackOnTheSamePeer(t *testing.T) {
	toBrowser := &relay{}
	tracks := make(chan *webrtc.TrackRemote, 1)

	device, offer, err := peer.New(peer.Config{
		SendCandidate: toBrowser.send,
		Tracks: []peer.TrackSpec{
			{Codec: peer.CodecH264, ID: "video", StreamID: "helix"},
		},
	})
	if err != nil {
		t.Fatalf("device peer: %v", err)
	}
	t.Cleanup(func() { _ = device.Close() })

	track := device.Track("video")
	if track == nil {
		t.Fatal("declared track missing")
	}

	b := newBrowser(t, func(c string) {
		if addErr := device.AddCandidate(c); addErr != nil {
			t.Logf("device add candidate: %v", addErr)
		}
	})
	t.Cleanup(func() { _ = b.pc.Close() })
	toBrowser.to(func(c string) { b.addCandidate(t, c) })
	b.pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case tracks <- remote:
		default:
		}
	})

	if answerErr := device.AcceptAnswer(b.answer(t, offer)); answerErr != nil {
		t.Fatalf("accept answer: %v", answerErr)
	}

	// Keep writing samples until the receiver sees RTP; the track only flows once ICE/DTLS/SRTP finish.
	done := make(chan struct{})
	defer close(done)
	go func() {
		frame := bytes.Repeat([]byte{0x00, 0x00, 0x01, 0x65}, 64)
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = track.WriteSample(frame, 20*time.Millisecond)
			}
		}
	}()

	select {
	case remote := <-tracks:
		if remote.Kind() != webrtc.RTPCodecTypeVideo {
			t.Fatalf("expected a video track, got %s", remote.Kind())
		}
	case <-time.After(20 * time.Second):
		t.Fatal("browser never received the media track")
	}
}
