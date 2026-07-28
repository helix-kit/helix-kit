// SPDX-License-Identifier: AGPL-3.0-only

package stream

import (
	"bytes"
	"crypto/rand"
	"io"
	"sync"
	"testing"
	"time"
)

// memTransport is an in-memory Transport connecting two Sessions for tests.
type memTransport struct {
	in     <-chan []byte
	out    chan []byte
	mu     sync.Mutex
	closed bool
}

func memPair() (Transport, Transport) {
	a2b := make(chan []byte, 1024)
	b2a := make(chan []byte, 1024)
	return &memTransport{in: b2a, out: a2b}, &memTransport{in: a2b, out: b2a}
}

func (m *memTransport) ReadMessage() ([]byte, error) {
	msg, ok := <-m.in
	if !ok {
		return nil, io.EOF
	}
	return msg, nil
}

func (m *memTransport) WriteMessage(data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return io.ErrClosedPipe
	}
	m.out <- append([]byte(nil), data...)
	return nil
}

func (m *memTransport) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.closed {
		m.closed = true
		close(m.out)
	}
	return nil
}

func newPair(t *testing.T) (client, server *Session) {
	t.Helper()
	a, b := memPair()
	client = NewSession(a, Config{Client: true, InitialWindow: 64 * 1024, MaxChunk: 8 * 1024})
	server = NewSession(b, Config{Client: false, InitialWindow: 64 * 1024, MaxChunk: 8 * 1024})
	t.Cleanup(func() { client.Close(); server.Close() })
	return client, server
}

func TestOpenAcceptAndMeta(t *testing.T) {
	client, server := newPair(t)
	cs, err := client.Open([]byte("target=127.0.0.1:8080"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	ss, err := server.Accept()
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if string(ss.Meta()) != "target=127.0.0.1:8080" {
		t.Fatalf("meta mismatch: %q", ss.Meta())
	}
	_ = cs
}

func TestBidirectional(t *testing.T) {
	client, server := newPair(t)
	cs, _ := client.Open(nil)
	ss, _ := server.Accept()

	if _, err := cs.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	got := readN(t, ss, 4)
	if string(got) != "ping" {
		t.Fatalf("server got %q", got)
	}
	if _, err := ss.Write([]byte("pong!")); err != nil {
		t.Fatal(err)
	}
	if g := readN(t, cs, 5); string(g) != "pong!" {
		t.Fatalf("client got %q", g)
	}
}

func TestLargeTransferFlowControl(t *testing.T) {
	client, server := newPair(t)
	cs, _ := client.Open(nil)
	ss, _ := server.Accept()

	const size = 1 << 20 // 1 MiB, far exceeds the 64 KiB window -> exercises credits
	src := make([]byte, size)
	_, _ = rand.Read(src)

	done := make(chan []byte, 1)
	go func() {
		buf, _ := io.ReadAll(ss)
		done <- buf
	}()
	go func() {
		_, _ = cs.Write(src)
		_ = cs.CloseWrite()
	}()

	select {
	case got := <-done:
		if !bytes.Equal(got, src) {
			t.Fatalf("payload mismatch: got %d bytes want %d", len(got), size)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timeout draining stream")
	}
}

func TestHalfCloseEOF(t *testing.T) {
	client, server := newPair(t)
	cs, _ := client.Open(nil)
	ss, _ := server.Accept()

	_, _ = cs.Write([]byte("last"))
	_ = cs.CloseWrite()

	buf, err := io.ReadAll(ss)
	if err != nil {
		t.Fatalf("read after half-close: %v", err)
	}
	if string(buf) != "last" {
		t.Fatalf("got %q", buf)
	}
}

func TestSignals(t *testing.T) {
	client, server := newPair(t)
	cs, _ := client.Open(nil)
	ss, _ := server.Accept()

	if err := cs.Signal([]byte(`{"type":"resize","cols":120,"rows":40}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case sig := <-ss.Signals():
		if string(sig) != `{"type":"resize","cols":120,"rows":40}` {
			t.Fatalf("signal mismatch: %q", sig)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no signal received")
	}
}

func TestStreamCount(t *testing.T) {
	client, server := newPair(t)
	if got := client.StreamCount(); got != 0 {
		t.Fatalf("initial client count = %d, want 0", got)
	}

	// Open is synchronous on the opener's side: the stream is registered before the frame goes out.
	if _, err := client.Open(nil); err != nil {
		t.Fatalf("open 1: %v", err)
	}
	if _, err := client.Open(nil); err != nil {
		t.Fatalf("open 2: %v", err)
	}
	if got := client.StreamCount(); got != 2 {
		t.Fatalf("client count after 2 opens = %d, want 2", got)
	}

	// The server registers each stream in dispatch before handing it to Accept.
	for i := 0; i < 2; i++ {
		if _, err := server.Accept(); err != nil {
			t.Fatalf("accept %d: %v", i, err)
		}
	}
	if got := server.StreamCount(); got != 2 {
		t.Fatalf("server count = %d, want 2", got)
	}
}

func readN(t *testing.T, r io.Reader, n int) []byte {
	t.Helper()
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		t.Fatalf("readN: %v", err)
	}
	return buf
}
