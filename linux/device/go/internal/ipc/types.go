// SPDX-License-Identifier: AGPL-3.0-only

// Package ipc is the local inter-process transport between the single helixd
// core process and on-device apps. It is a newline-delimited JSON (NDJSON)
// protocol over a Unix-domain stream socket:
//
//	{"id":"...","method":"...","params":{...}}\n   request  (app -> core)
//	{"id":"...","result":{...},"error":{...}}\n     response (core -> app)
//	{"method":"...","params":{...}}\n               notification (core -> app)
//
// Over MQTT, helixd speaks the standard Helix wire format (shared with the
// embedded and web sides): the control plane is one topic pair per device,
// `helix/device/<id>/in` (requests) and `.../out` (responses), carrying a
// HelixPacket. Events (device -> cloud telemetry) go on
// `helix/device/<id>/service/<svc>/event`. helixd routes by `message.service`
// and is otherwise app-agnostic.
package ipc

import (
	"encoding/json"
	"strconv"
	"time"
)

// MaxMessageBytes bounds a single NDJSON line. The IPC bus carries control and
// small JSON payloads only; bulk bytes go over the separate stream data plane.
const MaxMessageBytes = 512 * 1024

// --- IPC framing (app <-> helixd over the Unix socket) ---

// Request is one outer NDJSON frame sent app -> core.
type Request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Response answers a Request, correlated by ID.
type Response struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

// Notification is a core -> app push with no id (server-initiated).
type Notification struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Error is an RPC-level failure.
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Message }

// --- Helix wire format (helixd <-> cloud over MQTT) ---

// HelixMessage is the Helix service message body.
type HelixMessage struct {
	Service string          `json:"service"`
	Method  string          `json:"method"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// HelixPacket is the control-plane envelope on `in`/`out`.
type HelixPacket struct {
	RequestID string       `json:"requestId,omitempty"`
	Message   HelixMessage `json:"message"`
}

// DeviceEventEnvelope is the telemetry envelope on the per-service event topic.
type DeviceEventEnvelope struct {
	MsgID     string          `json:"msgId"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// BuildEventEnvelope stamps a fresh event envelope.
func BuildEventEnvelope(eventType string, payload json.RawMessage) DeviceEventEnvelope {
	if len(payload) == 0 {
		payload = json.RawMessage("{}")
	}
	return DeviceEventEnvelope{
		MsgID:     strconv.FormatInt(time.Now().UnixNano(), 10),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Type:      eventType,
		Payload:   payload,
	}
}

// --- IPC method params (app -> helixd) ---

// RegisterServiceParams registers this connection as a named service.
type RegisterServiceParams struct {
	Service string `json:"service"`
}

// RespondParams asks helixd to publish a control response on `out`. helixd fills
// in `service` from the caller's registered name and echoes requestId.
type RespondParams struct {
	Method    string          `json:"method"`
	Payload   json.RawMessage `json:"payload"`
	RequestID string          `json:"requestId,omitempty"`
}

// EmitEventParams asks helixd to publish a telemetry event on the caller's
// per-service event topic.
type EmitEventParams struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// --- IPC notification params (helixd -> app) ---

// CommandParams delivers an inbound cloud request to a registered service.
type CommandParams struct {
	Service   string          `json:"service"`
	Method    string          `json:"method"`
	Payload   json.RawMessage `json:"payload"`
	RequestID string          `json:"requestId,omitempty"`
}

// IPC request method names.
const (
	MethodRegisterService = "register-service"
	MethodRespond         = "respond"
	MethodEmitEvent       = "emit-event"
)

// IPC notification method names.
const NotifyCommand = "command"
