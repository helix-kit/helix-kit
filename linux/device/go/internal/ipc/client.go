// SPDX-License-Identifier: AGPL-3.0-only

package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	requestTimeout = 2 * time.Second
	reconnectMin   = 1 * time.Second
	reconnectMax   = 15 * time.Second
)

// Client is an app's connection to helixd's IPC socket. It auto-registers the
// service name on every (re)connect and exposes request/response plus an
// inbound notification stream.
type Client struct {
	socketPath string
	service    string
	log        *slog.Logger

	notifications chan Notification

	mu        sync.Mutex
	conn      net.Conn
	writeMu   sync.Mutex
	pending   map[string]chan Response
	connected chan struct{} // closed once registered; reset on disconnect
	closed    bool
	stop      chan struct{}
}

// NewClient creates (but does not start) a client for the given service name.
func NewClient(socketPath, service string, log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		socketPath:    socketPath,
		service:       service,
		log:           log,
		notifications: make(chan Notification, 256),
		pending:       make(map[string]chan Response),
		connected:     make(chan struct{}),
		stop:          make(chan struct{}),
	}
}

// Notifications is the inbound stream of core -> app pushes (mqtt-message /
// service-message).
func (c *Client) Notifications() <-chan Notification { return c.notifications }

// Start launches the reconnect loop in the background.
func (c *Client) Start() {
	go c.runLoop()
}

// WaitUntilConnected blocks until the client is registered or ctx is done.
func (c *Client) WaitUntilConnected(ctx context.Context) error {
	c.mu.Lock()
	ch := c.connected
	c.mu.Unlock()
	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Close stops the client and releases the socket.
func (c *Client) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	close(c.stop)
	if c.conn != nil {
		_ = c.conn.Close()
	}
	c.mu.Unlock()
}

func (c *Client) runLoop() {
	backoff := reconnectMin
	for {
		select {
		case <-c.stop:
			return
		default:
		}
		if err := c.connectOnce(); err != nil {
			c.log.Warn("ipc connect failed", "service", c.service, "err", err, "retry", backoff)
			select {
			case <-c.stop:
				return
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > reconnectMax {
				backoff = reconnectMax
			}
			continue
		}
		backoff = reconnectMin
	}
}

// connectOnce dials, registers, and reads until the connection drops.
func (c *Client) connectOnce() error {
	nc, err := net.Dial("unix", c.socketPath)
	if err != nil {
		return err
	}
	if regErr := c.register(nc); regErr != nil {
		_ = nc.Close()
		return regErr
	}
	c.mu.Lock()
	c.conn = nc
	close(c.connected) // signal any WaitUntilConnected waiters
	c.mu.Unlock()
	c.log.Info("ipc connected", "service", c.service)

	err = c.readLoop(nc)

	c.mu.Lock()
	c.conn = nil
	c.connected = make(chan struct{}) // fresh gate for the next connect
	// fail all pending requests
	for id, ch := range c.pending {
		select {
		case ch <- Response{ID: id, Error: &Error{Code: -100, Message: "ipc disconnected"}}:
		default:
		}
		delete(c.pending, id)
	}
	c.mu.Unlock()
	_ = nc.Close()
	return err
}

// register performs the synchronous register-service handshake (one line each
// way) before the async read loop starts.
func (c *Client) register(nc net.Conn) error {
	params, _ := json.Marshal(RegisterServiceParams{Service: c.service})
	req := Request{ID: nextID(), Method: MethodRegisterService, Params: params}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	_ = nc.SetDeadline(time.Now().Add(requestTimeout))
	if _, err := nc.Write(data); err != nil {
		return err
	}
	r := bufio.NewReaderSize(nc, 64*1024)
	line, err := r.ReadBytes('\n')
	if err != nil {
		return err
	}
	_ = nc.SetDeadline(time.Time{})
	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return err
	}
	if resp.Error != nil {
		return resp.Error
	}
	return nil
}

func (c *Client) readLoop(nc net.Conn) error {
	scanner := bufio.NewScanner(nc)
	scanner.Buffer(make([]byte, 64*1024), MaxMessageBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		// Distinguish response (has id) from notification (has method, no id).
		var probe struct {
			ID     string `json:"id"`
			Method string `json:"method"`
		}
		if err := json.Unmarshal(line, &probe); err != nil {
			continue
		}
		if probe.ID != "" {
			var resp Response
			if json.Unmarshal(line, &resp) == nil {
				c.deliverResponse(resp)
			}
			continue
		}
		if probe.Method != "" {
			var n Notification
			if json.Unmarshal(line, &n) == nil {
				select {
				case c.notifications <- n:
				default:
					c.log.Warn("ipc notification dropped (buffer full)", "service", c.service)
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return errors.New("ipc connection closed")
}

func (c *Client) deliverResponse(resp Response) {
	c.mu.Lock()
	ch := c.pending[resp.ID]
	delete(c.pending, resp.ID)
	c.mu.Unlock()
	if ch != nil {
		ch <- resp
	}
}

func (c *Client) request(method string, params any) error {
	raw, err := json.Marshal(params)
	if err != nil {
		return err
	}
	id := nextID()
	respCh := make(chan Response, 1)

	c.mu.Lock()
	conn := c.conn
	if conn == nil {
		c.mu.Unlock()
		return errors.New("ipc not connected")
	}
	c.pending[id] = respCh
	c.mu.Unlock()

	req := Request{ID: id, Method: method, Params: raw}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	c.writeMu.Lock()
	_, werr := conn.Write(data)
	c.writeMu.Unlock()
	if werr != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return werr
	}

	select {
	case resp := <-respCh:
		if resp.Error != nil {
			return resp.Error
		}
		return nil
	case <-time.After(requestTimeout):
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return errors.New("ipc request timeout")
	}
}

// Respond publishes a control response on `.../out`, echoing requestId. helixd
// fills in the service from this client's registered name.
func (c *Client) Respond(requestID, method string, payload json.RawMessage) error {
	return c.request(MethodRespond, RespondParams{Method: method, Payload: payload, RequestID: requestID})
}

// Emit publishes a telemetry event on this service's event topic.
func (c *Client) Emit(eventType string, payload json.RawMessage) error {
	return c.request(MethodEmitEvent, EmitEventParams{Type: eventType, Payload: payload})
}

var idCounter atomic.Uint64

func nextID() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10) + "-" +
		strconv.FormatUint(idCounter.Add(1), 10)
}
