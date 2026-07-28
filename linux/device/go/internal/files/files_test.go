// SPDX-License-Identifier: AGPL-3.0-only

package files

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/helix-kit/helix-device/internal/files/generated"
	"github.com/helix-kit/helix-device/internal/stream"
)

// pipeTransport is one half of an in-memory transport pair — the same shape the
// mux's own tests use, so a transfer can be exercised with no network at all.
type pipeTransport struct {
	in   <-chan []byte
	out  chan<- []byte
	done chan struct{}
}

func (p *pipeTransport) ReadMessage() ([]byte, error) {
	select {
	case msg, ok := <-p.in:
		if !ok {
			return nil, io.EOF
		}
		return msg, nil
	case <-p.done:
		return nil, io.EOF
	}
}

func (p *pipeTransport) WriteMessage(data []byte) error {
	frame := make([]byte, len(data))
	copy(frame, data)
	select {
	case p.out <- frame:
		return nil
	case <-p.done:
		return io.ErrClosedPipe
	}
}

func (p *pipeTransport) Close() error {
	select {
	case <-p.done:
	default:
		close(p.done)
	}
	return nil
}

// linkedSessions wires a device-side mux to a client-side one, as the gateway or a
// peer would.
func linkedSessions(t *testing.T) (device *stream.Session, client *stream.Session) {
	t.Helper()
	a := make(chan []byte, 64)
	b := make(chan []byte, 64)
	done := make(chan struct{})
	device = stream.NewSession(&pipeTransport{in: a, out: b, done: done}, stream.Config{Client: false})
	client = stream.NewSession(&pipeTransport{in: b, out: a, done: done}, stream.Config{Client: true})
	t.Cleanup(func() {
		device.Close()
		client.Close()
	})
	return device, client
}

func newRunner(t *testing.T, root string) *runner {
	t.Helper()
	roots, err := resolveRoots([]string{root})
	if err != nil {
		t.Fatalf("resolveRoots: %v", err)
	}
	return &runner{log: testLogger(), roots: roots}
}

func openTransfer(t *testing.T, client *stream.Session, meta generated.FilesTransferMeta) *stream.Stream {
	t.Helper()
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatalf("marshal meta: %v", err)
	}
	st, err := client.Open(raw)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	return st
}

// A download must survive being larger than the credit window several times over —
// that is the whole reason transfers ride the mux rather than a control message.
func TestDownloadLargeFile(t *testing.T) {
	root := t.TempDir()
	payload := make([]byte, 3<<20) // 3 MiB — many credit windows
	if _, err := rand.Read(payload); err != nil {
		t.Fatalf("rand: %v", err)
	}
	path := filepath.Join(root, "big.bin")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := newRunner(t, root)
	device, client := linkedSessions(t)
	go func() {
		st, err := device.Accept()
		if err != nil {
			return
		}
		r.handleTransfer(st)
	}()

	st := openTransfer(t, client, generated.FilesTransferMeta{Op: opGet, Path: path})
	got, err := io.ReadAll(st)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if sha256.Sum256(got) != sha256.Sum256(payload) {
		t.Fatalf("content mismatch: got %d bytes, want %d", len(got), len(payload))
	}
}

// An upload must land atomically at the target path.
func TestUploadFile(t *testing.T) {
	root := t.TempDir()
	payload := bytes.Repeat([]byte("helix-p2p"), 200_000) // ~1.8 MiB
	path := filepath.Join(root, "uploaded.bin")

	r := newRunner(t, root)
	device, client := linkedSessions(t)
	go func() {
		st, err := device.Accept()
		if err != nil {
			return
		}
		r.handleTransfer(st)
	}()

	st := openTransfer(t, client, generated.FilesTransferMeta{Op: opPut, Path: path, Size: len(payload)})
	if _, err := st.Write(payload); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := st.CloseWrite(); err != nil {
		t.Fatalf("close write: %v", err)
	}
	// The device half-closes once the file is committed.
	_, _ = io.ReadAll(st)

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("uploaded content mismatch: got %d bytes, want %d", len(got), len(payload))
	}
	// No temp files left behind.
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected only the uploaded file, got %d entries", len(entries))
	}
}

// The security boundary. Each of these must be refused, and the symlink cases are
// the ones a lexical path check would wave through.
func TestPathContainment(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("nope"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	// A symlink INSIDE the root pointing out of it: lexically contained, actually not.
	escape := filepath.Join(root, "escape")
	if err := os.Symlink(outside, escape); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	// A sibling directory sharing the root's string prefix.
	sibling := root + "-secret"
	if err := os.Mkdir(sibling, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sibling) })

	r := newRunner(t, root)
	for _, tc := range []struct {
		name string
		path string
	}{
		{"traversal", filepath.Join(root, "..", filepath.Base(outside), "secret")},
		{"absolute outside", filepath.Join(outside, "secret")},
		{"through a symlink out of the root", filepath.Join(escape, "secret")},
		{"prefix-sharing sibling", filepath.Join(sibling, "secret")},
		{"relative", "etc/passwd"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := r.resolve(tc.path); err == nil {
				t.Fatalf("resolve(%q) was allowed; it must be refused", tc.path)
			}
		})
	}

	// And the legitimate case still works.
	inside := filepath.Join(root, "ok.txt")
	if err := os.WriteFile(inside, []byte("fine"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := r.resolve(inside); err != nil {
		t.Fatalf("resolve(%q) should be allowed: %v", inside, err)
	}
}

// A transfer naming a path outside the roots must be reset, not served.
func TestTransferOutsideRootIsRejected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret")
	if err := os.WriteFile(secret, []byte("top secret"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := newRunner(t, root)
	device, client := linkedSessions(t)
	go func() {
		st, err := device.Accept()
		if err != nil {
			return
		}
		r.handleTransfer(st)
	}()

	st := openTransfer(t, client, generated.FilesTransferMeta{Op: opGet, Path: secret})
	got, err := io.ReadAll(st)
	if err == nil && len(got) > 0 {
		t.Fatalf("served %d bytes from outside the roots: %q", len(got), got)
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
