// SPDX-License-Identifier: AGPL-3.0-only

package portforward

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/helix-kit/helix-device/internal/portforward/generated"
	"github.com/helix-kit/helix-device/internal/shared/config"
	"github.com/helix-kit/helix-device/internal/shared/dataplane"
	"github.com/helix-kit/helix-device/internal/stream"
)

// TestHandleListReportsSessions verifies the enriched `list` response: each open
// tunnel is reported with its target, age, and live connection count.
func TestHandleListReportsSessions(t *testing.T) {
	ctx := context.Background()

	// A gateway that accepts the device's outbound WS but opens no streams.
	upgrader := websocket.Upgrader{}
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := upgrader.Upgrade(w, req, nil); err != nil {
			t.Errorf("upgrade: %v", err)
		}
	}))
	defer gw.Close()
	wsURL := "ws" + strings.TrimPrefix(gw.URL, "http")

	cfg := &config.Config{}
	r := &runner{
		cfg:      cfg,
		log:      slog.Default(),
		allowed:  map[string]struct{}{"127.0.0.1:9000": {}},
		sessions: dataplane.NewManager(cfg, slog.Default()),
		rootCtx:  ctx,
	}
	created := time.Now()
	if _, err := r.HandleOpen(ctx, generated.PortForwardOpenInput{
		SessionId: "sess-1",
		Target:    "127.0.0.1:9000",
		DataUrl:   wsURL,
		Transport: dataplane.TransportRelay,
	}); err != nil {
		t.Fatalf("HandleOpen: %v", err)
	}

	out, err := r.HandleList(ctx, generated.PortForwardListInput{})
	if err != nil {
		t.Fatalf("HandleList: %v", err)
	}
	if len(out.Sessions) != 1 {
		t.Fatalf("want 1 session, got %d", len(out.Sessions))
	}
	got := out.Sessions[0]
	if got.SessionId != "sess-1" {
		t.Fatalf("sessionId = %q, want sess-1", got.SessionId)
	}
	if got.Target != "127.0.0.1:9000" {
		t.Fatalf("target = %q, want 127.0.0.1:9000", got.Target)
	}
	if got.Connections != 0 {
		t.Fatalf("connections = %d, want 0", got.Connections)
	}
	// The manager stamps createdAt when it opens the session, so assert a window
	// rather than an exact millisecond.
	if got.CreatedAt < int(created.UnixMilli()) || got.CreatedAt > int(time.Now().UnixMilli()) {
		t.Fatalf("createdAt = %d, want within [%d, now]", got.CreatedAt, created.UnixMilli())
	}
}

// TestTunnelHTTPThroughStream drives the app's data path end-to-end over a real
// WebSocket: a "gateway" opens a stream, the device app dials the allow-listed
// target and pipes raw bytes, and an HTTP request/response round-trips.
func TestTunnelHTTPThroughStream(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// The local service being tunneled.
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "HELLO-TUNNEL")
	}))
	defer target.Close()
	targetAddr := strings.TrimPrefix(target.URL, "http://")

	cfg := &config.Config{}
	r := &runner{
		cfg:      cfg,
		log:      slog.Default(),
		rootCtx:  ctx,
		allowed:  map[string]struct{}{targetAddr: {}},
		sessions: dataplane.NewManager(cfg, slog.Default()),
	}

	// The "gateway": accepts the device's outbound WS and opens streams on it.
	gwCh := make(chan *stream.Session, 1)
	upgrader := websocket.Upgrader{}
	wsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		conn, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			return
		}
		gwCh <- stream.NewSession(stream.WrapWebSocket(conn), stream.Config{Client: true})
	}))
	defer wsSrv.Close()
	wsURL := "ws" + strings.TrimPrefix(wsSrv.URL, "http")

	// The device opens the session exactly as the control plane would: dial the
	// gateway over the relay transport, then run the app's accept loop.
	if _, err := r.HandleOpen(ctx, generated.PortForwardOpenInput{
		SessionId: "sess-1",
		Target:    targetAddr,
		DataUrl:   wsURL,
		Transport: dataplane.TransportRelay,
	}); err != nil {
		t.Fatalf("HandleOpen: %v", err)
	}

	var gw *stream.Session
	select {
	case gw = <-gwCh:
	case <-time.After(3 * time.Second):
		t.Fatal("gateway did not receive device connection")
	}

	// One browser connection == one stream carrying a raw HTTP/1.1 request.
	st, err := gw.Open(nil)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	req := "GET / HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n"
	if _, err := st.Write([]byte(req)); err != nil {
		t.Fatalf("write request: %v", err)
	}

	done := make(chan string, 1)
	go func() {
		buf, _ := io.ReadAll(st)
		done <- string(buf)
	}()
	select {
	case resp := <-done:
		if !strings.Contains(resp, "HELLO-TUNNEL") {
			t.Fatalf("tunneled response missing body:\n%s", resp)
		}
		if !strings.Contains(resp, "200 OK") {
			t.Fatalf("tunneled response missing status:\n%s", resp)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout reading tunneled response")
	}
}
