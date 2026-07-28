package main

import "encoding/binary"

// Tunnel wire protocol. Must stay byte-for-byte compatible with
// gateway/src/protocol.ts.
//
//   byte 0      : frame type
//   bytes 1..4  : stream id (uint32, big-endian)
//   bytes 5..N  : payload

const frameHeader = 5

const (
	// control (stream id 0)
	fRegister    = 0x01 // device -> gw   JSON { sessionId, target }
	fRegisterAck = 0x02 // gw -> device   JSON { ok, host, error }

	// HTTP request/response (per stream)
	fReqHead = 0x10 // gw -> device   JSON { method, url, headers }
	fReqData = 0x11 // gw -> device   raw body bytes
	fReqEnd  = 0x12 // gw -> device
	fResHead = 0x13 // device -> gw   JSON { status, headers }
	fResData = 0x14 // device -> gw   raw body bytes
	fResEnd  = 0x15 // device -> gw
	fAbort   = 0x16 // either        JSON { error }

	// WebSocket passthrough (per stream)
	fWsOpen  = 0x20 // gw -> device   raw HTTP upgrade request head bytes
	fWsAck   = 0x21 // device -> gw   raw HTTP response head bytes (101 ...)
	fWsData  = 0x22 // either        raw bytes
	fWsClose = 0x23 // either
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

// hopByHop headers are not forwarded across the proxy boundary.
var hopByHop = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailer":             true,
	"transfer-encoding":   true,
	"upgrade":             true,
}
