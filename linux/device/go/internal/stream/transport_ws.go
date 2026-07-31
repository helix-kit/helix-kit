// SPDX-License-Identifier: AGPL-3.0-only

package stream

import (
	"context"
	"crypto/tls"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/helix-kit/helix-device/internal/shared/netutil"
)

// wsTransport adapts a gorilla WebSocket to the Transport interface; the Session's single reader and serialized writes are what gorilla requires.
type wsTransport struct {
	conn *websocket.Conn
}

// WrapWebSocket adapts an already-open WebSocket connection into a Transport.
func WrapWebSocket(conn *websocket.Conn) Transport {
	conn.SetReadLimit(16 << 20)
	return &wsTransport{conn: conn}
}

func (w *wsTransport) ReadMessage() ([]byte, error) {
	_, data, err := w.conn.ReadMessage()
	return data, err
}

func (w *wsTransport) WriteMessage(data []byte) error {
	return w.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (w *wsTransport) Close() error { return w.conn.Close() }

// DialWebSocket opens an outbound WebSocket (optionally mTLS) and returns it as a Transport.
func DialWebSocket(ctx context.Context, url string, tlsConfig *tls.Config, header http.Header) (Transport, error) {
	dialer := websocket.Dialer{
		TLSClientConfig: tlsConfig,
		// Resolution is the slow part of this dial on a site with a bad resolver, and
		// a session opens one of these each time, so share the cache.
		NetDialContext:   netutil.Shared().DialContext,
		HandshakeTimeout: 15 * time.Second,
	}
	conn, _, err := dialer.DialContext(ctx, url, header)
	if err != nil {
		return nil, err
	}
	return WrapWebSocket(conn), nil
}
