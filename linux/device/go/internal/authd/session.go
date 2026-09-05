// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"time"

	"github.com/helix-kit/helix-device/internal/authproto"
)

// Request is one authentication attempt, with the Unix identity already resolved
// through NSS — which on a Helix device means LDAP/SSSD, i.e. PostgreSQL.
type Request struct {
	RequestID  string
	Username   string
	PAMService string
	RHost      string
	DeviceID   string
	UID        uint32
	GID        uint32
	Home       string
	Shell      string
}

// Outcome is an authenticator's verdict.
type Outcome struct {
	Status authproto.Status
	Reason string
}

// Approve is the only outcome that lets a login through.
func Approve() Outcome { return Outcome{Status: authproto.StatusApproved} }

// Deny refuses the attempt with a machine-readable reason.
func Deny(reason string) Outcome {
	return Outcome{Status: authproto.StatusDenied, Reason: reason}
}

// Unavailable means the attempt could not be decided at all -- the cloud was
// unreachable, a dependency was down. PAM maps it to PAM_AUTHINFO_UNAVAIL, which
// tells sshd this was not a rejection of the user.
func Unavailable(reason string) Outcome {
	return Outcome{Status: authproto.StatusUnavailable, Reason: reason}
}

// Expired ends an attempt whose transaction outlived its window.
func Expired(reason string) Outcome {
	return Outcome{Status: authproto.StatusExpired, Reason: reason}
}

// Conversation is the authenticator's channel to the human at the other end of
// the SSH session. It deliberately exposes nothing else about the transport.
type Conversation interface {
	Display(text string) error
	Warn(text string) error
	Prompt(promptID, text string) (string, error)
	PromptSecret(promptID, text string) (string, error)
}

// Authenticator decides one attempt. The three Helix methods are implementations
// of this interface, selected inside Authenticate.
type Authenticator interface {
	Authenticate(ctx context.Context, req Request, conv Conversation) Outcome
}

// session drives one connection: one PAM attempt, start to result.
type session struct {
	conn     *authproto.Conn
	auth     Authenticator
	identity identityResolver
	deviceID string
	log      *slog.Logger
}

func newSession(conn net.Conn, auth Authenticator, identity identityResolver, deviceID string, log *slog.Logger) *session {
	return &session{
		conn:     authproto.NewConn(conn),
		auth:     auth,
		identity: identity,
		deviceID: deviceID,
		log:      log,
	}
}

// run handles the attempt. Every path ends in exactly one result frame, and any
// path that is not an explicit approval denies.
func (s *session) run(ctx context.Context) {
	defer func() { _ = s.conn.Close() }()

	start := time.Now()
	req, outcome, ok := s.begin(ctx)
	if !ok {
		s.finish(req, outcome, start)
		return
	}

	log := s.log.With("request_id", req.RequestID, "username", req.Username, "uid", req.UID)
	log.Info("authentication started", "pam_service", req.PAMService, "rhost", req.RHost)

	outcome = s.auth.Authenticate(ctx, req, &conversation{conn: s.conn, ctx: ctx})
	if outcome.Status == "" {
		// An authenticator that returned nothing is a bug; fail closed.
		outcome = Outcome{Status: authproto.StatusDenied, Reason: "no_decision"}
	}
	s.finish(req, outcome, start)
}

// begin reads the start frame and resolves the Unix identity.
func (s *session) begin(ctx context.Context) (Request, Outcome, bool) {
	m, err := s.conn.Read()
	if err != nil {
		s.log.Warn("could not read start frame", "error", err)
		return Request{}, protocolFailure(err), false
	}
	if m.Type != authproto.TypeStart {
		s.log.Warn("first frame was not start", "type", m.Type)
		return Request{}, Outcome{Status: authproto.StatusProtocolError, Reason: "expected_start"}, false
	}

	req := Request{
		RequestID:  m.RequestID,
		Username:   m.Username,
		PAMService: m.PAMService,
		RHost:      m.RHost,
		DeviceID:   s.deviceID,
	}

	id, err := s.identity.Resolve(ctx, m.Username)
	if err != nil {
		// An unknown user never reaches an authenticator: there is no identity to
		// authenticate, so this is a denial and not an error.
		s.log.Warn("unknown unix user", "request_id", req.RequestID, "username", req.Username, "error", err)
		return req, Deny("unknown_user"), false
	}
	req.UID, req.GID = id.UID, id.GID
	req.Home, req.Shell = id.Home, id.Shell
	return req, Outcome{}, true
}

// finish writes the single terminal result frame and logs the attempt.
func (s *session) finish(req Request, outcome Outcome, start time.Time) {
	if err := s.conn.Write(authproto.Result(outcome.Status, outcome.Reason)); err != nil {
		s.log.Warn("could not deliver result", "request_id", req.RequestID, "error", err)
	}
	s.log.Info("authentication finished",
		"request_id", req.RequestID,
		"username", req.Username,
		"uid", req.UID,
		"device_id", req.DeviceID,
		"status", string(outcome.Status),
		"reason", outcome.Reason,
		"duration_ms", time.Since(start).Milliseconds())
}

// protocolFailure maps a transport or framing error onto a terminal status.
func protocolFailure(err error) Outcome {
	switch {
	case errors.Is(err, io.EOF):
		return Outcome{Status: authproto.StatusProtocolError, Reason: "client_disconnected"}
	case errors.Is(err, authproto.ErrBadVersion):
		return Outcome{Status: authproto.StatusProtocolError, Reason: "unsupported_version"}
	case errors.Is(err, authproto.ErrTooLarge):
		return Outcome{Status: authproto.StatusProtocolError, Reason: "message_too_large"}
	default:
		return Outcome{Status: authproto.StatusProtocolError, Reason: "malformed_message"}
	}
}

// conversation adapts the socket to the Conversation interface.
type conversation struct {
	conn *authproto.Conn
	ctx  context.Context
}

func (c *conversation) Display(text string) error {
	return c.conn.Write(authproto.Display(authproto.LevelInfo, text))
}

func (c *conversation) Warn(text string) error {
	return c.conn.Write(authproto.Display(authproto.LevelError, text))
}

func (c *conversation) Prompt(promptID, text string) (string, error) {
	return c.ask(promptID, text, false)
}

func (c *conversation) PromptSecret(promptID, text string) (string, error) {
	return c.ask(promptID, text, true)
}

func (c *conversation) ask(promptID, text string, secret bool) (string, error) {
	if err := c.ctx.Err(); err != nil {
		return "", err
	}
	if err := c.conn.Write(authproto.Prompt(promptID, text, secret)); err != nil {
		return "", err
	}

	m, err := c.conn.Read()
	if err != nil {
		return "", err
	}
	if m.Type != authproto.TypePromptResponse {
		return "", fmt.Errorf("%w: expected prompt_response, got %q", authproto.ErrMalformed, m.Type)
	}
	if m.PromptID != promptID {
		// A mismatched id means the conversation has desynchronised; treating it
		// as an answer would attribute the wrong input to this prompt.
		return "", fmt.Errorf("%w: response for %q while awaiting %q", authproto.ErrMalformed, m.PromptID, promptID)
	}
	return m.Value, nil
}
