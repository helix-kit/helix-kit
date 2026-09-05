// SPDX-License-Identifier: AGPL-3.0-only

// Package ldapserver is the read-only LDAP projection of Helix identities.
//
// It owns no user data: every search is answered from store.UserStore, and the
// POSIX attributes Linux needs are synthesized per request by identity.Directory.
package ldapserver

import (
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"time"

	ldapd "github.com/vjeantet/ldapserver"

	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/store"
)

// Options configures a Server.
type Options struct {
	Directory    identity.Directory
	BindDN       string
	BindPassword string
	SearchLimit  int
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	Logger       *slog.Logger
}

// Server is the LDAP façade.
type Server struct {
	opts  Options
	store store.UserStore
	log   *slog.Logger

	srv *ldapd.Server
	lis *listener

	started chan struct{}
	addr    atomic.Pointer[net.Addr]
	stopped sync.Once
}

// New builds a server. Call Serve or ListenAndServe to run it.
func New(st store.UserStore, opts Options) *Server {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	s := &Server{opts: opts, store: st, log: opts.Logger, started: make(chan struct{})}

	routes := ldapd.NewRouteMux()
	routes.Bind(s.handleBind)
	// The Root DSE route must be registered first: it is the narrower match.
	routes.Search(s.handleRootDSE).BaseDn("").Scope(ldapd.SearchRequestScopeBaseObject).Label("root-dse")
	routes.Search(s.handleSearch).Label("search")
	routes.Add(s.refuseWrite("add"))
	routes.Modify(s.refuseWrite("modify"))
	routes.Delete(s.refuseWrite("delete"))
	routes.Compare(s.refuseWrite("compare"))
	// Extended and ModifyDN have no usable route here (an Extended route matches
	// one OID at a time), so they fall through to the catch-all refusal.
	routes.NotFound(s.handleNotFound)

	s.srv = ldapd.NewServer()
	s.srv.ReadTimeout = opts.ReadTimeout
	s.srv.WriteTimeout = opts.WriteTimeout
	s.srv.Handle(routes)
	return s
}

// ListenAndServe binds addr and serves until Stop is called.
func (s *Server) ListenAndServe(addr string) error {
	raw, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	return s.Serve(raw)
}

// Serve runs the server on an already-bound listener.
func (s *Server) Serve(raw net.Listener) error {
	s.lis = newListener(raw, s.log)
	a := raw.Addr()
	s.addr.Store(&a)
	s.log.Info("ldap listening", "addr", a.String(), "base_dn", s.opts.Directory.BaseDN)
	close(s.started)

	// ListenAndServe re-binds, so hand the library our listener through its
	// option hook and give it an address it will not use.
	return s.srv.ListenAndServe("127.0.0.1:0", func(srv *ldapd.Server) {
		srv.Listener.Close()
		srv.Listener = s.lis
	})
}

// Addr reports the bound address once Serve has started.
func (s *Server) Addr() net.Addr {
	if p := s.addr.Load(); p != nil {
		return *p
	}
	return nil
}

// Started blocks until the server is listening.
func (s *Server) Started() <-chan struct{} { return s.started }

// Stop closes the listener and disconnects clients gracefully.
func (s *Server) Stop() {
	s.stopped.Do(func() {
		if s.lis != nil {
			s.lis.Close()
		}
		s.srv.Stop()
	})
}

// listener wraps accepted connections so each one carries its own auth state and
// logs its own lifecycle.
type listener struct {
	net.Listener
	log    *slog.Logger
	nextID atomic.Uint64
	// parked is never closed. The upstream accept loop dereferences the returned
	// connection before checking the error, so returning (nil, err) on shutdown
	// panics it; parking the goroutine is the only safe way out.
	parked chan struct{}
}

func newListener(inner net.Listener, log *slog.Logger) *listener {
	return &listener{Listener: inner, log: log, parked: make(chan struct{})}
}

func (l *listener) Accept() (net.Conn, error) {
	raw, err := l.Listener.Accept()
	if err != nil {
		<-l.parked
		return nil, err
	}
	c := &conn{Conn: raw, id: l.nextID.Add(1), log: l.log}
	l.log.Info("ldap connection opened", "conn", c.id, "remote", raw.RemoteAddr().String())
	return c, nil
}

// conn is an accepted connection plus the bind state that applies to it.
type conn struct {
	net.Conn
	id  uint64
	log *slog.Logger

	mu     sync.Mutex
	bound  bool
	bindDN string
	closed bool
}

func (c *conn) Close() error {
	c.mu.Lock()
	first := !c.closed
	c.closed = true
	c.mu.Unlock()
	if first {
		c.log.Info("ldap connection closed", "conn", c.id)
	}
	return c.Conn.Close()
}

func (c *conn) setBound(bound bool, dn string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bound, c.bindDN = bound, dn
}

func (c *conn) isBound() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bound
}

// session returns the per-connection state for a request.
func session(m *ldapd.Message) *conn {
	c, _ := m.Client.GetConn().(*conn)
	return c
}

// checkPassword compares in constant time.
func checkPassword(want, got string) bool {
	return subtle.ConstantTimeCompare([]byte(want), []byte(got)) == 1
}
