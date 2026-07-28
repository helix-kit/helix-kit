// SPDX-License-Identifier: AGPL-3.0-only

package stream

import (
	"errors"
	"io"
	"sync"
)

// ErrStreamClosed is returned when operating on a reset/closed stream.
var ErrStreamClosed = errors.New("stream closed")

// Stream is one bidirectional byte stream within a Session: an io.ReadWriteCloser with credit-based flow control and an out-of-band SIGNAL channel.
type Stream struct {
	id      uint32
	session *Session
	meta    []byte

	// receive side (peer -> us)
	rmu     sync.Mutex
	rcond   *sync.Cond
	rbuf    []byte
	reof    bool  // peer sent END
	rerr    error // reset/teardown
	unacked int   // bytes consumed since last CREDIT sent

	// send side (us -> peer)
	smu    sync.Mutex
	scond  *sync.Cond
	window int   // bytes we may still send
	sdone  bool  // we sent END
	serr   error // reset/teardown

	signals   chan []byte
	closeOnce sync.Once
}

func newStream(s *Session, id uint32, meta []byte) *Stream {
	st := &Stream{
		id:      id,
		session: s,
		meta:    meta,
		window:  s.initialWindow,
		signals: make(chan []byte, 16),
	}
	st.rcond = sync.NewCond(&st.rmu)
	st.scond = sync.NewCond(&st.smu)
	return st
}

// ID is the stream's numeric identifier within the session.
func (st *Stream) ID() uint32 { return st.id }

// Meta is the app-defined open payload (may be nil).
func (st *Stream) Meta() []byte { return st.meta }

// Signals delivers inbound SIGNAL payloads (app control frames).
func (st *Stream) Signals() <-chan []byte { return st.signals }

// Read implements io.Reader. Returns io.EOF after the peer half-closes.
func (st *Stream) Read(p []byte) (int, error) {
	st.rmu.Lock()
	for len(st.rbuf) == 0 {
		if st.rerr != nil {
			st.rmu.Unlock()
			return 0, st.rerr
		}
		if st.reof {
			st.rmu.Unlock()
			return 0, io.EOF
		}
		st.rcond.Wait()
	}
	n := copy(p, st.rbuf)
	st.rbuf = st.rbuf[n:]
	st.unacked += n
	var grant int
	if st.unacked >= st.session.creditThreshold {
		grant = st.unacked
		st.unacked = 0
	}
	st.rmu.Unlock()

	if grant > 0 {
		st.session.writeFrame(fCredit, st.id, encodeCredit(uint32(grant)))
	}
	return n, nil
}

// Write implements io.Writer, blocking on the flow-control window.
func (st *Stream) Write(p []byte) (int, error) {
	total := 0
	st.smu.Lock()
	defer st.smu.Unlock()
	for len(p) > 0 {
		for st.window == 0 && st.serr == nil && !st.sdone {
			st.scond.Wait()
		}
		if st.serr != nil {
			return total, st.serr
		}
		if st.sdone {
			return total, ErrStreamClosed
		}
		chunk := len(p)
		if chunk > st.window {
			chunk = st.window
		}
		if chunk > st.session.maxChunk {
			chunk = st.session.maxChunk
		}
		if err := st.session.writeFrame(fData, st.id, p[:chunk]); err != nil {
			st.serr = err
			return total, err
		}
		st.window -= chunk
		total += chunk
		p = p[chunk:]
	}
	return total, nil
}

// CloseWrite half-closes the send direction (sends END).
func (st *Stream) CloseWrite() error {
	st.smu.Lock()
	if st.sdone || st.serr != nil {
		st.smu.Unlock()
		return nil
	}
	st.sdone = true
	st.scond.Broadcast()
	st.smu.Unlock()
	return st.session.writeFrame(fEnd, st.id, nil)
}

// Signal sends an out-of-band control frame for this stream.
func (st *Stream) Signal(payload []byte) error {
	return st.session.writeFrame(fSignal, st.id, payload)
}

// Close gracefully closes the stream: half-close the send side and remove it from the session.
func (st *Stream) Close() error {
	_ = st.CloseWrite()
	st.teardown(ErrStreamClosed)
	st.session.removeStream(st.id)
	return nil
}

// Reset aborts the stream in both directions (sends RESET).
func (st *Stream) Reset(reason string) {
	st.session.writeFrame(fReset, st.id, []byte(reason))
	st.teardown(errors.New("stream reset: " + reason))
	st.session.removeStream(st.id)
}

func (st *Stream) onData(data []byte) {
	st.rmu.Lock()
	if st.rerr == nil && !st.reof {
		st.rbuf = append(st.rbuf, data...)
		st.rcond.Broadcast()
	}
	st.rmu.Unlock()
}

func (st *Stream) onEnd() {
	st.rmu.Lock()
	st.reof = true
	st.rcond.Broadcast()
	st.rmu.Unlock()
}

func (st *Stream) onCredit(n uint32) {
	st.smu.Lock()
	st.window += int(n)
	st.scond.Broadcast()
	st.smu.Unlock()
}

func (st *Stream) onSignal(payload []byte) {
	select {
	case st.signals <- append([]byte(nil), payload...):
	default:
	}
}

// teardown fails both directions without sending frames (used on RESET/close).
func (st *Stream) teardown(err error) {
	st.closeOnce.Do(func() {
		st.rmu.Lock()
		if st.rerr == nil {
			st.rerr = err
		}
		st.rcond.Broadcast()
		st.rmu.Unlock()

		st.smu.Lock()
		if st.serr == nil {
			st.serr = err
		}
		st.scond.Broadcast()
		st.smu.Unlock()

		close(st.signals)
	})
}
