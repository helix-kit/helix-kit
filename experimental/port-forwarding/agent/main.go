// Helix port-forwarding device agent (experimental).
//
// Holds a single outbound WebSocket to the cloud gateway and, for every stream
// the gateway opens, relays to a local TCP service (default 127.0.0.1:<port>).
// The device exposes zero inbound ports.
//
//	agent --outbound WSS--> connect.port.helix-kit.com/__tunnel__
//	stream --> 127.0.0.1:<local-port>
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type registerMsg struct {
	SessionID string `json:"sessionId"`
	Target    string `json:"target"`
}

type registerAck struct {
	OK    bool   `json:"ok"`
	Host  string `json:"host"`
	Error string `json:"error"`
}

type reqHead struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

type resHead struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
}

// agentConn owns the single gateway WebSocket and serializes all writes through
// one goroutine so stream handlers can send concurrently.
type agentConn struct {
	ws     *websocket.Conn
	target string // host:port of the local service
	out    chan []byte

	mu      sync.Mutex
	streams map[uint32]*stream
	http    *http.Transport
}

type stream struct {
	id    uint32
	bodyW *io.PipeWriter // request body (HTTP) written here
	conn  net.Conn       // raw target connection (WebSocket)
	once  sync.Once
}

func main() {
	gateway := flag.String("gateway", envOr("GATEWAY_URL", "wss://connect.port.helix-kit.com/__tunnel__"), "gateway tunnel WebSocket URL")
	session := flag.String("session", envOr("SESSION_ID", "demo"), "session id (becomes <id>.port.helix-kit.com)")
	target := flag.String("target", envOr("TARGET", "127.0.0.1:8000"), "local service host:port to forward to")
	flag.Parse()

	for {
		if err := run(*gateway, *session, *target); err != nil {
			log.Printf("connection lost: %v; reconnecting in 3s", err)
		}
		time.Sleep(3 * time.Second)
	}
}

func run(gateway, session, target string) error {
	log.Printf("connecting to %s (session=%s target=%s)", gateway, session, target)
	ws, _, err := websocket.DefaultDialer.Dial(gateway, nil)
	if err != nil {
		return err
	}
	defer ws.Close()

	ac := &agentConn{
		ws:      ws,
		target:  target,
		out:     make(chan []byte, 256),
		streams: make(map[uint32]*stream),
		http: &http.Transport{
			DisableCompression: true,
			MaxIdleConns:       64,
			IdleConnTimeout:    30 * time.Second,
			DialContext: func(context.Context, string, string) (net.Conn, error) {
				return net.DialTimeout("tcp", target, 5*time.Second)
			},
		},
	}

	// Dedicated writer goroutine (gorilla requires a single writer).
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for frame := range ac.out {
			if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				return
			}
		}
	}()

	// Register.
	reg, _ := json.Marshal(registerMsg{SessionID: session, Target: target})
	ac.send(encodeFrame(fRegister, 0, reg))

	ws.SetReadLimit(16 << 20)
	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			close(ac.out)
			<-writerDone
			ac.failAll()
			return err
		}
		ac.handle(decodeFrame(data))
	}
}

func (ac *agentConn) send(frame []byte) {
	defer func() { recover() }() // out may be closed during shutdown
	ac.out <- frame
}

func (ac *agentConn) handle(ftype byte, id uint32, payload []byte) {
	switch ftype {
	case fRegisterAck:
		var ack registerAck
		json.Unmarshal(payload, &ack)
		if !ack.OK {
			log.Printf("register rejected: %s", ack.Error)
			return
		}
		log.Printf("registered: https://%s -> %s", ack.Host, ac.target)

	case fReqHead:
		ac.startHTTP(id, payload)
	case fReqData:
		if s := ac.stream(id); s != nil && s.bodyW != nil {
			s.bodyW.Write(payload)
		}
	case fReqEnd:
		if s := ac.stream(id); s != nil && s.bodyW != nil {
			s.bodyW.Close()
		}

	case fWsOpen:
		ac.startWS(id, payload)
	case fWsData:
		if s := ac.stream(id); s != nil && s.conn != nil {
			s.conn.Write(payload)
		}
	case fWsClose:
		ac.closeStream(id)
	case fAbort:
		ac.closeStream(id)
	}
}

func (ac *agentConn) stream(id uint32) *stream {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	return ac.streams[id]
}

func (ac *agentConn) put(s *stream) {
	ac.mu.Lock()
	ac.streams[s.id] = s
	ac.mu.Unlock()
}

func (ac *agentConn) closeStream(id uint32) {
	ac.mu.Lock()
	s := ac.streams[id]
	delete(ac.streams, id)
	ac.mu.Unlock()
	if s != nil {
		s.close()
	}
}

func (ac *agentConn) failAll() {
	ac.mu.Lock()
	for _, s := range ac.streams {
		s.close()
	}
	ac.streams = make(map[uint32]*stream)
	ac.mu.Unlock()
}

func (s *stream) close() {
	s.once.Do(func() {
		if s.bodyW != nil {
			s.bodyW.CloseWithError(io.EOF)
		}
		if s.conn != nil {
			s.conn.Close()
		}
	})
}

// startHTTP handles a proxied HTTP request: build the request with a streamed
// body, round-trip it to the local service, and stream the response back.
func (ac *agentConn) startHTTP(id uint32, payload []byte) {
	var head reqHead
	if err := json.Unmarshal(payload, &head); err != nil {
		ac.abort(id, "bad request head")
		return
	}

	pr, pw := io.Pipe()
	s := &stream{id: id, bodyW: pw}
	ac.put(s)

	go func() {
		defer ac.closeStream(id)

		u, err := url.Parse("http://" + ac.target + head.URL)
		if err != nil {
			ac.abort(id, "bad url")
			return
		}
		req, err := http.NewRequest(head.Method, u.String(), pr)
		if err != nil {
			ac.abort(id, err.Error())
			return
		}
		for k, v := range head.Headers {
			lk := strings.ToLower(k)
			if hopByHop[lk] {
				continue
			}
			if lk == "host" {
				req.Host = v // preserve the browser-facing host
				continue
			}
			req.Header.Set(k, v)
		}

		resp, err := ac.http.RoundTrip(req)
		if err != nil {
			ac.abort(id, err.Error())
			return
		}
		defer resp.Body.Close()

		outHeaders := map[string]string{}
		for k, vals := range resp.Header {
			if hopByHop[strings.ToLower(k)] {
				continue
			}
			outHeaders[k] = strings.Join(vals, ", ")
		}
		hb, _ := json.Marshal(resHead{Status: resp.StatusCode, Headers: outHeaders})
		ac.send(encodeFrame(fResHead, id, hb))

		buf := make([]byte, 32*1024)
		for {
			n, rerr := resp.Body.Read(buf)
			if n > 0 {
				ac.send(encodeFrame(fResData, id, append([]byte(nil), buf[:n]...)))
			}
			if rerr != nil {
				break
			}
		}
		ac.send(encodeFrame(fResEnd, id, nil))
	}()
}

// startWS handles a proxied WebSocket upgrade: dial the local service, replay
// the raw upgrade request, hand back the raw response head, then pipe bytes.
func (ac *agentConn) startWS(id uint32, rawReqHead []byte) {
	conn, err := net.DialTimeout("tcp", ac.target, 5*time.Second)
	if err != nil {
		ac.abort(id, err.Error())
		return
	}
	s := &stream{id: id, conn: conn}
	ac.put(s)

	if _, err := conn.Write(rawReqHead); err != nil {
		ac.closeStream(id)
		return
	}

	// Read the response head (up to and including the blank line) and forward
	// it verbatim as WS_ACK, then stream the rest of the connection as WS_DATA.
	br := bufio.NewReader(conn)
	headBytes, rest, err := readHTTPHead(br)
	if err != nil {
		ac.closeStream(id)
		return
	}
	ac.send(encodeFrame(fWsAck, id, headBytes))
	if len(rest) > 0 {
		ac.send(encodeFrame(fWsData, id, rest))
	}

	go func() {
		defer ac.closeStream(id)
		buf := make([]byte, 32*1024)
		for {
			n, rerr := br.Read(buf)
			if n > 0 {
				ac.send(encodeFrame(fWsData, id, append([]byte(nil), buf[:n]...)))
			}
			if rerr != nil {
				break
			}
		}
		ac.send(encodeFrame(fWsClose, id, nil))
	}()
}

// readHTTPHead reads bytes until the CRLFCRLF header terminator, returning the
// head (inclusive) and any already-buffered body bytes after it.
func readHTTPHead(br *bufio.Reader) (head []byte, rest []byte, err error) {
	var buf bytes.Buffer
	for {
		b, rerr := br.ReadByte()
		if rerr != nil {
			return nil, nil, rerr
		}
		buf.WriteByte(b)
		if bytes.HasSuffix(buf.Bytes(), []byte("\r\n\r\n")) {
			break
		}
	}
	// Drain whatever else is already buffered without blocking.
	n := br.Buffered()
	if n > 0 {
		rest = make([]byte, n)
		br.Read(rest)
	}
	return buf.Bytes(), rest, nil
}

func (ac *agentConn) abort(id uint32, msg string) {
	b, _ := json.Marshal(map[string]string{"error": msg})
	ac.send(encodeFrame(fAbort, id, b))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
