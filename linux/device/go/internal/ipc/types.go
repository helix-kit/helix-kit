// SPDX-License-Identifier: AGPL-3.0-only

// Package ipc is the local NDJSON transport between helixd and on-device apps.
package ipc

import (
	"encoding/json"
	"strconv"
	"time"
)

// MaxMessageBytes bounds a single NDJSON line.
const MaxMessageBytes = 512 * 1024

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

// RegisterServiceParams registers this connection as a named service.
type RegisterServiceParams struct {
	Service string `json:"service"`
}

// RespondParams asks helixd to publish a control response on `out`.
type RespondParams struct {
	Method    string          `json:"method"`
	Payload   json.RawMessage `json:"payload"`
	RequestID string          `json:"requestId,omitempty"`
}

// EmitEventParams asks helixd to publish a telemetry event.
type EmitEventParams struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

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
