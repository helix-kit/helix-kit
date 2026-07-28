// SPDX-License-Identifier: AGPL-3.0-only

package stream

import (
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Transport is a message-oriented binary carrier; each ReadMessage/WriteMessage moves one whole HelixStream frame.
type Transport interface {
	ReadMessage() ([]byte, error)
	WriteMessage([]byte) error
	Close() error
}

// Config tunes a Session.
type Config struct {
	// Client selects the stream-id parity so both peers can open without collision: client odd, server even.
	Client bool
	// InitialWindow is the per-stream receive window in bytes (default 256 KiB).
	InitialWindow int
	// MaxChunk is the largest DATA payload per frame (default 32 KiB).
	MaxChunk int
	// Logger is optional.
	Logger *slog.Logger
}

// ErrSessionClosed is returned once the session is torn down.
var ErrSessionClosed = errors.New("stream session closed")

// Session multiplexes Streams over one Transport.
type Session struct {
	t   Transport
	log *slog.Logger

	initialWindow   int
	maxChunk        int
	creditThreshold int

	writeMu sync.Mutex

	mu      sync.Mutex
	streams map[uint32]*Stream
	nextID  uint32

	accept    chan *Stream
	closeOnce sync.Once
	closed    chan struct{}
	closeErr  error
}

// NewSession wraps a Transport and starts serving frames.
func NewSession(t Transport, cfg Config) *Session {
	if cfg.InitialWindow <= 0 {
		cfg.InitialWindow = 256 * 1024
	}
	if cfg.MaxChunk <= 0 {
		cfg.MaxChunk = 32 * 1024
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	firstID := uint32(2)
	if cfg.Client {
		firstID = 1
	}
	s := &Session{
		t:               t,
		log:             cfg.Logger,
		initialWindow:   cfg.InitialWindow,
		maxChunk:        cfg.MaxChunk,
		creditThreshold: cfg.InitialWindow / 2,
		streams:         make(map[uint32]*Stream),
		nextID:          firstID,
		accept:          make(chan *Stream, 64),
		closed:          make(chan struct{}),
	}
	go s.readLoop()
	go s.pingLoop()
	return s
}

// Open starts a new local stream; meta is an app-defined open payload (may nil).
func (s *Session) Open(meta []byte) (*Stream, error) {
	s.mu.Lock()
	select {
	case <-s.closed:
		s.mu.Unlock()
		return nil, ErrSessionClosed
	default:
	}
	id := s.nextID
	s.nextID += 2
	st := newStream(s, id, meta)
	s.streams[id] = st
	s.mu.Unlock()

	if err := s.writeFrame(fOpen, id, meta); err != nil {
		s.removeStream(id)
		return nil, err
	}
	return st, nil
}

// Accept returns the next peer-initiated stream, or an error once closed.
func (s *Session) Accept() (*Stream, error) {
	select {
	case st := <-s.accept:
		return st, nil
	case <-s.closed:
		return nil, s.closeErr
	}
}

// Close tears down the session and all streams.
func (s *Session) Close() error {
	s.closeWithErr(ErrSessionClosed)
	return nil
}

// Done is closed when the session ends.
func (s *Session) Done() <-chan struct{} { return s.closed }

// StreamCount returns the number of streams currently open on the session.
func (s *Session) StreamCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.streams)
}

func (s *Session) writeFrame(t frameType, id uint32, payload []byte) error {
	frame := encodeFrame(t, id, payload)
	s.writeMu.Lock()
	err := s.t.WriteMessage(frame)
	s.writeMu.Unlock()
	if err != nil {
		s.closeWithErr(err)
	}
	return err
}

func (s *Session) removeStream(id uint32) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
}

func (s *Session) getStream(id uint32) *Stream {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streams[id]
}

func (s *Session) readLoop() {
	for {
		msg, err := s.t.ReadMessage()
		if err != nil {
			s.closeWithErr(err)
			return
		}
		t, id, payload, ok := decodeFrame(msg)
		if !ok {
			continue
		}
		s.dispatch(t, id, payload)
	}
}

func (s *Session) dispatch(t frameType, id uint32, payload []byte) {
	switch t {
	case fPing:
		_ = s.writeFrame(fPong, 0, nil)
	case fPong:
	case fOpen:
		st := newStream(s, id, append([]byte(nil), payload...))
		s.mu.Lock()
		s.streams[id] = st
		s.mu.Unlock()
		select {
		case s.accept <- st:
		case <-s.closed:
		}
	case fData:
		if st := s.getStream(id); st != nil {
			st.onData(payload)
		}
	case fEnd:
		if st := s.getStream(id); st != nil {
			st.onEnd()
		}
	case fReset:
		if st := s.getStream(id); st != nil {
			st.teardown(errors.New("peer reset"))
			s.removeStream(id)
		}
	case fSignal:
		if st := s.getStream(id); st != nil {
			st.onSignal(payload)
		}
	case fCredit:
		if st := s.getStream(id); st != nil {
			st.onCredit(decodeCredit(payload))
		}
	}
}

func (s *Session) pingLoop() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.closed:
			return
		case <-ticker.C:
			_ = s.writeFrame(fPing, 0, nil)
		}
	}
}

func (s *Session) closeWithErr(err error) {
	s.closeOnce.Do(func() {
		s.closeErr = err
		close(s.closed)
		s.mu.Lock()
		streams := make([]*Stream, 0, len(s.streams))
		for _, st := range s.streams {
			streams = append(streams, st)
		}
		s.streams = make(map[uint32]*Stream)
		s.mu.Unlock()
		for _, st := range streams {
			st.teardown(err)
		}
		_ = s.t.Close()
	})
}
