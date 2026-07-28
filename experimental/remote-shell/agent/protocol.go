package main

import "encoding/binary"

// Remote-shell tunnel wire protocol. Must stay byte-for-byte compatible with
// gateway/src/protocol.ts.
//
//   byte 0      : frame type
//   bytes 1..4  : stream id (uint32, big-endian; 0 = control)
//   bytes 5..N  : payload (raw PTY bytes, or JSON for control frames)

const frameHeader = 5

const (
	// control (stream id 0)
	fRegister    = 0x01 // agent -> gw   JSON { agentId }
	fRegisterAck = 0x02 // gw -> agent   JSON { ok }

	// per PTY session (stream id > 0)
	fOpen   = 0x10 // gw -> agent   JSON { cols, rows }
	fData   = 0x11 // either        raw bytes (stdin from browser / stdout to browser)
	fResize = 0x12 // gw -> agent   JSON { cols, rows }
	fClose  = 0x13 // either        session teardown
	fExit   = 0x14 // agent -> gw   JSON { code }
)

func encodeFrame(ftype byte, streamID uint32, payload []byte) []byte {
	buf := make([]byte, frameHeader+len(payload))
	buf[0] = ftype
	binary.BigEndian.PutUint32(buf[1:5], streamID)
	copy(buf[frameHeader:], payload)
	return buf
}

func decodeFrame(data []byte) (ftype byte, streamID uint32, payload []byte) {
	if len(data) < frameHeader {
		return 0, 0, nil
	}
	return data[0], binary.BigEndian.Uint32(data[1:5]), data[frameHeader:]
}
