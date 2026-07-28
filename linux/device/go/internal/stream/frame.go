// SPDX-License-Identifier: AGPL-3.0-only

// Package stream is HelixStream: a transport-agnostic multiplexer carrying many bidirectional byte streams over one message-oriented connection.
//
// Wire format (one binary message per frame):
//
//	byte 0      frame type
//	bytes 1..4  stream id (uint32, big-endian; 0 = connection control)
//	bytes 5..N  payload
package stream

import "encoding/binary"

const frameHeader = 5

type frameType byte

const (
	fOpen   frameType = 0x01 // new stream; payload = app-defined open meta
	fData   frameType = 0x02 // raw stream bytes
	fEnd    frameType = 0x03 // half-close: no more DATA this direction
	fReset  frameType = 0x04 // abort stream; payload optional reason
	fSignal frameType = 0x05 // app control for a stream (e.g. shell resize)
	fCredit frameType = 0x06 // flow-control: payload uint32 bytes granted
	fPing   frameType = 0x10 // connection keepalive (stream id 0)
	fPong   frameType = 0x11 // keepalive reply (stream id 0)
)

func encodeFrame(t frameType, streamID uint32, payload []byte) []byte {
	buf := make([]byte, frameHeader+len(payload))
	buf[0] = byte(t)
	binary.BigEndian.PutUint32(buf[1:5], streamID)
	copy(buf[frameHeader:], payload)
	return buf
}

func decodeFrame(data []byte) (t frameType, streamID uint32, payload []byte, ok bool) {
	if len(data) < frameHeader {
		return 0, 0, nil, false
	}
	return frameType(data[0]), binary.BigEndian.Uint32(data[1:5]), data[frameHeader:], true
}

func encodeCredit(n uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return b
}

func decodeCredit(p []byte) uint32 {
	if len(p) < 4 {
		return 0
	}
	return binary.BigEndian.Uint32(p)
}
