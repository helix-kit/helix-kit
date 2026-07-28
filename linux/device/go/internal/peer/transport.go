// SPDX-License-Identifier: AGPL-3.0-only

package peer

import (
	"errors"
	"sync"

	"github.com/pion/webrtc/v4"

	"github.com/helix-kit/helix-device/internal/stream"
)

// ErrChannelClosed is returned once the DataChannel is gone.
var ErrChannelClosed = errors.New("peer data channel closed")

// highWater bounds the send buffer: DataChannel.Send never blocks, so without a ceiling a fast producer grows the SCTP buffer until the channel dies.
const highWater = 1 << 20 // 1 MiB

// dataChannelTransport adapts a WebRTC DataChannel to stream.Transport; pion pushes inbound messages (OnMessage) while the mux pulls, so inbound frames land in a buffered channel.
type dataChannelTransport struct {
	dc *webrtc.DataChannel

	inbound chan []byte
	resume  chan struct{}

	closeOnce sync.Once
	closed    chan struct{}
}

func newDataChannelTransport(dc *webrtc.DataChannel) *dataChannelTransport {
	t := &dataChannelTransport{
		dc:      dc,
		inbound: make(chan []byte, 64),
		resume:  make(chan struct{}, 1),
		closed:  make(chan struct{}),
	}

	dc.SetBufferedAmountLowThreshold(highWater / 2)
	dc.OnBufferedAmountLow(func() {
		select {
		case t.resume <- struct{}{}:
		default:
		}
	})

	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		// pion reuses the read buffer and the decoder hands out sub-slices, so copy before handing it over.
		frame := make([]byte, len(msg.Data))
		copy(frame, msg.Data)
		select {
		case t.inbound <- frame:
		case <-t.closed:
		}
	})

	dc.OnClose(func() { t.markClosed() })
	dc.OnError(func(error) { t.markClosed() })

	return t
}

func (t *dataChannelTransport) markClosed() {
	t.closeOnce.Do(func() { close(t.closed) })
}

func (t *dataChannelTransport) ReadMessage() ([]byte, error) {
	select {
	case frame := <-t.inbound:
		return frame, nil
	case <-t.closed:
		// Drain anything already buffered before reporting the close.
		select {
		case frame := <-t.inbound:
			return frame, nil
		default:
			return nil, ErrChannelClosed
		}
	}
}

func (t *dataChannelTransport) WriteMessage(data []byte) error {
	for t.dc.BufferedAmount() > highWater {
		select {
		case <-t.resume:
		case <-t.closed:
			return ErrChannelClosed
		}
	}
	select {
	case <-t.closed:
		return ErrChannelClosed
	default:
	}
	return t.dc.Send(data)
}

func (t *dataChannelTransport) Close() error {
	t.markClosed()
	return t.dc.Close()
}

var _ stream.Transport = (*dataChannelTransport)(nil)

// WrapDataChannel adapts an already-open DataChannel into a stream.Transport, for the peer that received the channel.
func WrapDataChannel(dc *webrtc.DataChannel) stream.Transport {
	return newDataChannelTransport(dc)
}
