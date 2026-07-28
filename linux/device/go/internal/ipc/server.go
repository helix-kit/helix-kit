// SPDX-License-Identifier: AGPL-3.0-only

package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"
)

// Publisher is helixd's cloud transport, used to emit app messages to MQTT.
type Publisher interface {
	// PublishResponse sends a control-plane HelixPacket on `.../out`.
	PublishResponse(packet HelixPacket) error
	// PublishEvent sends a telemetry envelope on `.../service/<service>/event`.
	PublishEvent(service string, env DeviceEventEnvelope) error
}

// Server is the Unix-socket IPC endpoint hosted by helixd.
type Server struct {
	socketPath string
	log        *slog.Logger

	mu        sync.RWMutex
	services  map[string]*conn
	publisher Publisher
}

type conn struct {
	c    net.Conn
	name string
	wmu  sync.Mutex
}

func (c *conn) writeJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	c.wmu.Lock()
	defer c.wmu.Unlock()
	_, err = c.c.Write(data)
	return err
}

// NewServer creates an IPC server bound to socketPath (created on Serve).
func NewServer(socketPath string, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{socketPath: socketPath, log: log, services: make(map[string]*conn)}
}

// SetPublisher wires the cloud publisher (helixd's MQTT transport).
func (s *Server) SetPublisher(p Publisher) { s.publisher = p }

// Serve listens and accepts connections until ctx is cancelled.
func (s *Server) Serve(ctx context.Context) error {
	if err := os.MkdirAll(filepath.Dir(s.socketPath), 0o755); err != nil {
		return err
	}
	_ = os.Remove(s.socketPath) // stale socket from a previous run
	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return err
	}
	defer func() {
		_ = ln.Close()
		_ = os.Remove(s.socketPath)
	}()
	s.log.Info("ipc listening", "socket", s.socketPath)

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		c, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			s.log.Warn("ipc accept failed", "err", err)
			continue
		}
		go s.handleConn(ctx, c)
	}
}

func (s *Server) handleConn(ctx context.Context, netConn net.Conn) {
	cn := &conn{c: netConn}
	defer func() {
		_ = netConn.Close()
		s.dropConn(cn)
	}()

	scanner := bufio.NewScanner(netConn)
	scanner.Buffer(make([]byte, 64*1024), MaxMessageBytes)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			_ = cn.writeJSON(Response{Error: &Error{Code: -1, Message: "invalid json"}})
			continue
		}
		s.handleRequest(cn, req)
	}
}

func (s *Server) handleRequest(cn *conn, req Request) {
	switch req.Method {
	case MethodRegisterService:
		var p RegisterServiceParams
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Service == "" {
			_ = cn.writeJSON(errResponse(req.ID, -1, "invalid register params"))
			return
		}
		s.registerConn(p.Service, cn)
		s.log.Info("service registered", "service", p.Service)
		_ = cn.writeJSON(okResponse(req.ID))

	case MethodRespond:
		var p RespondParams
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Method == "" {
			_ = cn.writeJSON(errResponse(req.ID, -1, "invalid respond params"))
			return
		}
		if s.publisher == nil {
			_ = cn.writeJSON(errResponse(req.ID, -3, "no transport"))
			return
		}
		packet := HelixPacket{
			RequestID: p.RequestID,
			Message:   HelixMessage{Service: cn.name, Method: p.Method, Payload: p.Payload},
		}
		if err := s.publisher.PublishResponse(packet); err != nil {
			_ = cn.writeJSON(errResponse(req.ID, -3, err.Error()))
			return
		}
		_ = cn.writeJSON(okResponse(req.ID))

	case MethodEmitEvent:
		var p EmitEventParams
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Type == "" {
			_ = cn.writeJSON(errResponse(req.ID, -1, "invalid emit params"))
			return
		}
		if s.publisher == nil {
			_ = cn.writeJSON(errResponse(req.ID, -3, "no transport"))
			return
		}
		env := BuildEventEnvelope(p.Type, p.Payload)
		if err := s.publisher.PublishEvent(cn.name, env); err != nil {
			_ = cn.writeJSON(errResponse(req.ID, -3, err.Error()))
			return
		}
		_ = cn.writeJSON(okResponse(req.ID))

	default:
		_ = cn.writeJSON(errResponse(req.ID, -2, "unknown method"))
	}
}

// NotifyService pushes an inbound cloud command to a registered service, false if none.
func (s *Server) NotifyService(service string, params CommandParams) bool {
	s.mu.RLock()
	cn := s.services[service]
	s.mu.RUnlock()
	if cn == nil {
		return false
	}
	raw, _ := json.Marshal(params)
	_ = cn.writeJSON(Notification{Method: NotifyCommand, Params: raw})
	return true
}

func (s *Server) registerConn(name string, cn *conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev := s.services[name]; prev != nil && prev != cn {
		_ = prev.c.Close() // a fresh registration supersedes the old connection
	}
	cn.name = name
	s.services[name] = cn
}

func (s *Server) dropConn(cn *conn) {
	if cn.name == "" {
		return
	}
	s.mu.Lock()
	if s.services[cn.name] == cn {
		delete(s.services, cn.name)
		s.log.Info("service disconnected", "service", cn.name)
	}
	s.mu.Unlock()
}

func okResponse(id string) Response {
	return Response{ID: id, Result: json.RawMessage(`{"ok":true}`)}
}

func errResponse(id string, code int, msg string) Response {
	return Response{ID: id, Error: &Error{Code: code, Message: msg}}
}
