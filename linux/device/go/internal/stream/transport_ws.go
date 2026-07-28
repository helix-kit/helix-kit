// SPDX-License-Identifier: AGPL-3.0-only

package stream

import (
	"context"
	"crypto/tls"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// wsTransport adapts a gorilla WebSocket to the Transport interface. The Session
// guarantees a single reader (readLoop) and serialized writes (writeMu), which
// is exactly what gorilla requires.
type wsTransport struct {
	conn *websocket.Conn
}

// WrapWebSocket adapts an already-open WebSocket connection (e.g. a
// gateway-side upgraded connection) into a Transport.
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

// DialWebSocket opens an outbound WebSocket (optionally mTLS) for a device app's
// data plane and returns it as a Transport.
func DialWebSocket(ctx context.Context, url string, tlsConfig *tls.Config, header http.Header) (Transport, error) {
	dialer := websocket.Dialer{
		TLSClientConfig:  tlsConfig,
		HandshakeTimeout: 15 * time.Second,
	}
	conn, _, err := dialer.DialContext(ctx, url, header)
	if err != nil {
		return nil, err
	}
	return WrapWebSocket(conn), nil
}
