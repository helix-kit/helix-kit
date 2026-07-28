// Helix P2P transport device agent (experimental).
//
// A Linux device that establishes a *direct* WebRTC DataChannel to a browser
// and streams bulk data over it. The cloud (EC2) only relays the handshake
// (SDP/ICE) via the signaling server — once the DataChannel opens, every byte
// of payload flows peer-to-peer and never crosses EC2. This is the reusable
// P2P transport substrate: file transfer here, but the same channel carries any
// bytes (media, streams, generic data).
//
//	agent --outbound WSS--> signaling(room) --brokers--> browser
//	         then: DataChannel "helix" --DIRECT--> browser   (no EC2 in path)
//
// The device is the WebRTC *initiator*: it creates the DataChannel and the SDP
// offer as soon as the signaling server reports both peers are present.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

// signalMsg is the opaque envelope relayed by the signaling server. Only `type`
// is meaningful to the server; the rest is WebRTC's business.
type signalMsg struct {
	Type      string                   `json:"type"`
	Initiator bool                     `json:"initiator,omitempty"`
	SDP       string                   `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit `json:"candidate,omitempty"`
	// SDP offer/answer fields are carried via embedded SessionDescription below.
}

// fileMeta is the app-level header sent as a string message before the binary
// chunks (mirrors the embedded "JSON control + binary data" precedent).
type fileMeta struct {
	Type   string `json:"type"`
	Name   string `json:"name"`
	Size   int    `json:"size"`
	Mime   string `json:"mime"`
	SHA256 string `json:"sha256"`
	Chunk  int    `json:"chunk"`
}

func main() {
	signal := flag.String("signal", envOr("SIGNAL_URL", "ws://localhost:9200/__p2p__"), "signaling WebSocket base URL")
	room := flag.String("room", envOr("ROOM", "demo"), "rendezvous room id")
	file := flag.String("file", envOr("FILE", ""), "file to serve (empty = generate random data)")
	genSize := flag.Int("gen-size", intEnvOr("GEN_SIZE", 64<<20), "bytes of random data to generate when -file is empty")
	chunk := flag.Int("chunk", 16<<10, "chunk size in bytes")
	flag.Parse()

	payload, name, err := loadPayload(*file, *genSize)
	if err != nil {
		log.Fatalf("payload: %v", err)
	}
	sum := sha256.Sum256(payload)
	log.Printf("serving %q: %d bytes, sha256=%s", name, len(payload), hex.EncodeToString(sum[:]))

	for {
		if err := run(*signal, *room, payload, name, hex.EncodeToString(sum[:]), *chunk); err != nil {
			log.Printf("session ended: %v; reconnecting in 3s", err)
		}
		time.Sleep(3 * time.Second)
	}
}

func run(signal, room string, payload []byte, name, sha string, chunk int) error {
	u, err := url.Parse(signal)
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("room", room)
	q.Set("role", "device")
	u.RawQuery = q.Encode()

	log.Printf("connecting to signaling %s (room=%s)", u.String(), room)
	ws, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	// Serialize signaling writes through one goroutine (gorilla: single writer).
	out := make(chan any, 64)
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for m := range out {
			if err := ws.WriteJSON(m); err != nil {
				return
			}
		}
	}()
	sendSig := func(m any) { defer func() { recover() }(); out <- m }
	defer func() { close(out); <-writerDone }()

	// mDNS query+gather so we resolve a same-LAN browser's ".local" host
	// candidates. For a cross-network peer (e.g. phone on cellular) these are
	// unused and STUN server-reflexive candidates carry the connection.
	se := webrtc.SettingEngine{}
	se.SetICEMulticastDNSMode(ice.MulticastDNSModeQueryAndGather)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))

	dev := &device{api: api, sendSig: sendSig, payload: payload, name: name, sha: sha, chunk: chunk}

	// One WebRTC session per browser. A fresh PeerConnection is built for every
	// "ready" (each new browser / page reload), so retries from a flaky mobile
	// network always start clean instead of colliding on stale ICE state.
	for {
		var m signalRaw
		if err := ws.ReadJSON(&m); err != nil {
			dev.closeSession()
			return err
		}
		switch m.Type {
		case "ready":
			if m.Initiator {
				dev.newSession()
			}
		case "answer":
			dev.onAnswer(m.SDP)
		case "candidate":
			dev.onCandidate(m.Candidate)
		case "peer-left":
			log.Printf("browser left — tearing down session")
			dev.closeSession()
		}
	}
}

// device owns the signaling socket's sender and builds one PeerConnection per
// connected browser.
type device struct {
	api     *webrtc.API
	sendSig func(any)
	payload []byte
	name    string
	sha     string
	chunk   int

	mu   sync.Mutex
	sess *webrtc.PeerConnection
}

func (d *device) newSession() {
	d.closeSession()

	pc, err := d.api.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
			{
				// TURN fallback (our coturn on EC2) for peers that can't go
				// direct. ICE still prefers host/srflx; relay is last resort.
				URLs: []string{
					"turn:turn.port.helix-kit.com:3478?transport=udp",
					"turn:turn.port.helix-kit.com:3478?transport=tcp",
					"turns:turn.port.helix-kit.com:5349?transport=tcp",
				},
				Username:       "helix",
				Credential:     "helixsecret",
				CredentialType: webrtc.ICECredentialTypePassword,
			},
		},
	})
	if err != nil {
		log.Printf("new peer connection: %v", err)
		return
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		init := c.ToJSON()
		d.sendSig(signalMsg{Type: "candidate", Candidate: &init})
	})
	pc.OnICEConnectionStateChange(func(s webrtc.ICEConnectionState) { log.Printf("ice: %s", s) })
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) { log.Printf("peer connection: %s", s) })

	dc, err := pc.CreateDataChannel("helix", nil)
	if err != nil {
		log.Printf("create data channel: %v", err)
		pc.Close()
		return
	}
	dc.OnOpen(func() {
		log.Printf("data channel open — streaming %d bytes (%q)", len(d.payload), d.name)
		go func() {
			if err := sendFile(dc, d.payload, d.name, d.sha, d.chunk); err != nil {
				log.Printf("send failed: %v", err)
			}
		}()
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		log.Printf("create offer: %v", err)
		pc.Close()
		return
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		log.Printf("set local: %v", err)
		pc.Close()
		return
	}

	d.mu.Lock()
	d.sess = pc
	d.mu.Unlock()

	d.sendSig(pc.LocalDescription())
	log.Printf("offer sent — new session")
}

func (d *device) onAnswer(sdp string) {
	d.mu.Lock()
	pc := d.sess
	d.mu.Unlock()
	if pc == nil {
		return
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}); err != nil {
		log.Printf("set remote answer: %v", err)
	}
}

func (d *device) onCandidate(c *webrtc.ICECandidateInit) {
	if c == nil {
		return
	}
	d.mu.Lock()
	pc := d.sess
	d.mu.Unlock()
	if pc == nil {
		return
	}
	if err := pc.AddICECandidate(*c); err != nil {
		log.Printf("add candidate: %v", err)
	}
}

func (d *device) closeSession() {
	d.mu.Lock()
	pc := d.sess
	d.sess = nil
	d.mu.Unlock()
	if pc != nil {
		pc.Close()
	}
}

// signalRaw decodes inbound signaling, including SDP answers (which arrive as a
// raw RTCSessionDescription: {type, sdp}).
type signalRaw struct {
	Type      string                   `json:"type"`
	Initiator bool                     `json:"initiator"`
	SDP       string                   `json:"sdp"`
	Candidate *webrtc.ICECandidateInit `json:"candidate"`
}

// sendFile streams the payload over the DataChannel with backpressure: a string
// meta header, then binary chunks, then a string "file-end". WebRTC preserves
// message order on an ordered channel, so control and data interleave safely.
func sendFile(dc *webrtc.DataChannel, payload []byte, name, sha string, chunk int) error {
	meta, _ := json.Marshal(fileMeta{Type: "file-meta", Name: name, Size: len(payload), Mime: "application/octet-stream", SHA256: sha, Chunk: chunk})
	if err := dc.SendText(string(meta)); err != nil {
		return err
	}

	// Backpressure: pause sending when the send buffer grows past maxBuffered,
	// resume when OnBufferedAmountLow fires. Without this a fast producer blows
	// up memory / drops the channel.
	const maxBuffered = 1 << 20 // 1 MiB
	dc.SetBufferedAmountLowThreshold(maxBuffered / 2)
	resume := make(chan struct{}, 1)
	dc.OnBufferedAmountLow(func() {
		select {
		case resume <- struct{}{}:
		default:
		}
	})

	start := time.Now()
	for off := 0; off < len(payload); off += chunk {
		end := off + chunk
		if end > len(payload) {
			end = len(payload)
		}
		if dc.BufferedAmount() > maxBuffered {
			<-resume
		}
		if err := dc.Send(payload[off:end]); err != nil {
			return err
		}
	}
	// Wait for the OS/SCTP buffer to flush before signaling completion.
	for dc.BufferedAmount() > 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if err := dc.SendText(`{"type":"file-end"}`); err != nil {
		return err
	}
	secs := time.Since(start).Seconds()
	log.Printf("sent %d bytes in %.2fs = %.1f MB/s", len(payload), secs, float64(len(payload))/1048576/secs)
	return nil
}

func loadPayload(path string, genSize int) ([]byte, string, error) {
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, "", err
		}
		return b, filepath.Base(path), nil
	}
	b := make([]byte, genSize)
	if _, err := rand.Read(b); err != nil {
		return nil, "", err
	}
	return b, fmt.Sprintf("helix-p2p-%dMB.bin", genSize>>20), nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func intEnvOr(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return def
}
