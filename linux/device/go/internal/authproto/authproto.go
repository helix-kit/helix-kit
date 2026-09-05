// SPDX-License-Identifier: AGPL-3.0-only

// Package authproto is the wire protocol between pam_helix.so and helix-authd.
//
// One connection carries exactly one authentication attempt. The PAM module is a
// conversation relay and nothing more: helix-authd decides what to display, what
// to ask, and whether the attempt succeeds, so every authentication rule lives on
// the daemon side of this socket.
package authproto

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
)

// Version is the only protocol version this build speaks. A peer announcing
// anything else is refused rather than guessed at.
const Version = 1

// MaxMessageBytes bounds a single frame, so a peer cannot exhaust memory.
const MaxMessageBytes = 16 << 10

// Type is the message discriminator.
type Type string

const (
	// TypeStart opens an attempt. PAM -> authd, exactly once, first.
	TypeStart Type = "start"
	// TypeDisplay shows text to the user. authd -> PAM.
	TypeDisplay Type = "display"
	// TypePrompt asks the user for input. authd -> PAM.
	TypePrompt Type = "prompt"
	// TypePromptResponse carries the answer. PAM -> authd.
	TypePromptResponse Type = "prompt_response"
	// TypeResult ends the attempt. authd -> PAM, exactly once, last.
	TypeResult Type = "result"
)

// Level maps a display message onto a PAM message style.
type Level string

const (
	LevelInfo  Level = "info"  // PAM_TEXT_INFO
	LevelError Level = "error" // PAM_ERROR_MSG
)

// Status is the outcome of an attempt.
type Status string

const (
	StatusApproved          Status = "approved"
	StatusDenied            Status = "denied"
	StatusExpired           Status = "expired"
	StatusInvalidCredential Status = "invalid_credential"
	StatusUnavailable       Status = "unavailable"
	StatusProtocolError     Status = "protocol_error"
)

// Protocol errors. Every one of them must deny authentication.
var (
	ErrTooLarge   = errors.New("authproto: message exceeds maximum size")
	ErrBadVersion = errors.New("authproto: unsupported protocol version")
	ErrMalformed  = errors.New("authproto: malformed message")
)

// Message is one protocol frame. Fields are shared across types rather than
// split into per-type structs, because the wire format is a single flat object.
type Message struct {
	Version int  `json:"version"`
	Type    Type `json:"type"`

	// start
	RequestID  string `json:"request_id,omitempty"`
	Username   string `json:"username,omitempty"`
	PAMService string `json:"pam_service,omitempty"`
	RHost      string `json:"rhost,omitempty"`

	// display
	Level Level  `json:"level,omitempty"`
	Text  string `json:"text,omitempty"`

	// prompt
	PromptID string `json:"prompt_id,omitempty"`
	Secret   bool   `json:"secret,omitempty"`

	// prompt_response
	Value string `json:"value,omitempty"`

	// result
	Status Status `json:"status,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// LogValue redacts Value unconditionally. Prompt responses may carry a pasted
// persistent credential or an offline response, and the daemon has no business
// logging either; redacting every response is simpler to audit than tracking
// which prompt was marked secret.
func (m *Message) LogValue() slog.Value {
	attrs := []slog.Attr{slog.String("type", string(m.Type))}
	if m.RequestID != "" {
		attrs = append(attrs, slog.String("request_id", m.RequestID))
	}
	if m.Username != "" {
		attrs = append(attrs, slog.String("username", m.Username))
	}
	if m.PromptID != "" {
		attrs = append(attrs, slog.String("prompt_id", m.PromptID))
	}
	if m.Status != "" {
		attrs = append(attrs, slog.String("status", string(m.Status)))
	}
	if m.Value != "" {
		attrs = append(attrs, slog.String("value", "[redacted]"))
	}
	return slog.GroupValue(attrs...)
}

// Validate checks a decoded frame is one this build can act on.
func (m *Message) Validate() error {
	if m.Version != Version {
		return fmt.Errorf("%w: %d", ErrBadVersion, m.Version)
	}
	switch m.Type {
	case TypeStart:
		if m.Username == "" {
			return fmt.Errorf("%w: start without username", ErrMalformed)
		}
	case TypePromptResponse:
		if m.PromptID == "" {
			return fmt.Errorf("%w: prompt_response without prompt_id", ErrMalformed)
		}
	case TypeDisplay, TypePrompt, TypeResult:
	default:
		return fmt.Errorf("%w: unknown type %q", ErrMalformed, m.Type)
	}
	return nil
}

// Conn is one framed connection: newline-delimited JSON, one attempt per conn.
type Conn struct {
	r *bufio.Reader
	w io.Writer
	c io.Closer
}

// NewConn wraps a stream. rw is typically a *net.UnixConn.
func NewConn(rw io.ReadWriteCloser) *Conn {
	return &Conn{
		// One byte of headroom lets an oversized frame be detected rather than
		// silently split across two reads and parsed as two frames.
		r: bufio.NewReaderSize(rw, MaxMessageBytes+1),
		w: rw,
		c: rw,
	}
}

// Close releases the underlying stream.
func (c *Conn) Close() error { return c.c.Close() }

// Read returns the next validated frame.
func (c *Conn) Read() (*Message, error) {
	line, err := c.r.ReadSlice('\n')
	switch {
	case errors.Is(err, bufio.ErrBufferFull):
		return nil, ErrTooLarge
	case errors.Is(err, io.EOF) && len(line) == 0:
		return nil, io.EOF
	case err != nil && !errors.Is(err, io.EOF):
		return nil, err
	}
	if len(line) > MaxMessageBytes {
		return nil, ErrTooLarge
	}

	var m Message
	if err := json.Unmarshal(line, &m); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrMalformed, err)
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

// Write encodes a frame. Frames that would exceed the limit are refused here
// rather than sent, so a peer never has to handle a truncated message.
func (c *Conn) Write(m *Message) error {
	m.Version = Version
	encoded, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("authproto: encode: %w", err)
	}
	if len(encoded)+1 > MaxMessageBytes {
		return ErrTooLarge
	}
	if _, err := c.w.Write(append(encoded, '\n')); err != nil {
		return fmt.Errorf("authproto: write: %w", err)
	}
	return nil
}

// Display builds an informational display frame.
func Display(level Level, text string) *Message {
	return &Message{Version: Version, Type: TypeDisplay, Level: level, Text: text}
}

// Prompt builds a prompt frame. secret selects PAM_PROMPT_ECHO_OFF.
func Prompt(promptID, text string, secret bool) *Message {
	return &Message{Version: Version, Type: TypePrompt, PromptID: promptID, Text: text, Secret: secret}
}

// Result builds a terminal result frame.
func Result(status Status, reason string) *Message {
	return &Message{Version: Version, Type: TypeResult, Status: status, Reason: reason}
}
