// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/authproto"
)

const knownUser = "alice"

const unknownUser = "definitely-not-a-helix-user-9f2c"

// fakeResolver stands in for NSS so the protocol tests do not depend on the
// accounts that happen to exist on the machine running them.
type fakeResolver struct{ known map[string]unixIdentity }

func newFakeResolver() *fakeResolver {
	return &fakeResolver{known: map[string]unixIdentity{
		knownUser: {Username: knownUser, UID: 200001, GID: 200001, Home: "/home/alice", Shell: "/bin/sh"},
	}}
}

func (r *fakeResolver) Resolve(_ context.Context, username string) (unixIdentity, error) {
	id, ok := r.known[username]
	if !ok {
		return unixIdentity{}, errors.New("no such user")
	}
	return id, nil
}

// discardLog keeps test output about the code under test, not its logging.
func discardLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// stubMethods assembles the daemon the way New does -- the dispatcher owns the
// method prompt -- with a stub standing in for every method.
func stubMethods(t *testing.T, decision string) Authenticator {
	t.Helper()
	stub, err := newStubAuthenticator(decision)
	if err != nil {
		t.Fatalf("newStubAuthenticator: %v", err)
	}
	return &methodAuthenticator{
		log: discardLog(),
		methods: map[Method]Authenticator{
			MethodOnline:     stub,
			MethodOffline:    stub,
			MethodPersistent: stub,
		},
	}
}

// dial starts a session on one end of a pipe and returns the client end.
func dial(t *testing.T, auth Authenticator) *authproto.Conn {
	t.Helper()
	server, client := net.Pipe()

	s := newSession(server, auth, newFakeResolver(), "D123", discardLog())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		_ = client.Close()
		<-done
	})
	return authproto.NewConn(client)
}

func mustWrite(t *testing.T, c *authproto.Conn, m *authproto.Message) {
	t.Helper()
	if err := c.Write(m); err != nil {
		t.Fatalf("write %s: %v", m.Type, err)
	}
}

func mustRead(t *testing.T, c *authproto.Conn) *authproto.Message {
	t.Helper()
	m, err := c.Read()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return m
}

// readUntilResult drains display frames and answers prompts with the supplied
// values, returning the terminal result.
func readUntilResult(t *testing.T, c *authproto.Conn, answers map[string]string) *authproto.Message {
	t.Helper()
	for range 20 {
		m := mustRead(t, c)
		switch m.Type {
		case authproto.TypeResult:
			return m
		case authproto.TypeDisplay:
		case authproto.TypePrompt:
			answer, ok := answers[m.PromptID]
			if !ok {
				t.Fatalf("unexpected prompt %q", m.PromptID)
			}
			mustWrite(t, c, &authproto.Message{
				Type:     authproto.TypePromptResponse,
				PromptID: m.PromptID,
				Value:    answer,
			})
		default:
			t.Fatalf("unexpected frame %q", m.Type)
		}
	}
	t.Fatal("no result after 20 frames")
	return nil
}

func start(username string) *authproto.Message {
	return &authproto.Message{
		Type:       authproto.TypeStart,
		RequestID:  "req-1",
		Username:   username,
		PAMService: "sshd",
		RHost:      "192.0.2.1",
	}
}

func TestApprovedAttempt(t *testing.T) {
	c := dial(t, stubMethods(t, "approve"))

	mustWrite(t, c, start(knownUser))
	res := readUntilResult(t, c, map[string]string{"auth_method": "online"})

	if res.Status != authproto.StatusApproved {
		t.Fatalf("status = %q (%s), want approved", res.Status, res.Reason)
	}
}

func TestDeniedAttempt(t *testing.T) {
	c := dial(t, stubMethods(t, "deny"))

	mustWrite(t, c, start(knownUser))
	res := readUntilResult(t, c, map[string]string{"auth_method": "online"})

	if res.Status != authproto.StatusDenied {
		t.Fatalf("status = %q, want denied", res.Status)
	}
}

// An unconfigured daemon must not authenticate anyone.
func TestStubDefaultsToDeny(t *testing.T) {
	auth, err := newStubAuthenticator("")
	if err != nil {
		t.Fatal(err)
	}
	if auth.approve {
		t.Fatal("stub authenticator defaulted to approve")
	}
}

func TestStubRejectsUnknownDecision(t *testing.T) {
	if _, err := newStubAuthenticator("maybe"); err == nil {
		t.Fatal("newStubAuthenticator accepted an unknown decision")
	}
}

func TestUnknownMethodIsDenied(t *testing.T) {
	c := dial(t, stubMethods(t, "approve"))

	mustWrite(t, c, start(knownUser))
	res := readUntilResult(t, c, map[string]string{"auth_method": "sudo-please"})

	if res.Status != authproto.StatusDenied || res.Reason != "unknown_method" {
		t.Fatalf("status = %q reason = %q, want denied/unknown_method", res.Status, res.Reason)
	}
}

func TestMethodParsingIsForgivingButClosed(t *testing.T) {
	for _, in := range []string{"online", "  ONLINE\t", "Offline", "persistent"} {
		if _, ok := parseMethod(in); !ok {
			t.Errorf("parseMethod(%q) rejected a valid method", in)
		}
	}
	for _, in := range []string{"", "on", "online;offline", "root", "../online"} {
		if m, ok := parseMethod(in); ok {
			t.Errorf("parseMethod(%q) = %q, want rejection", in, m)
		}
	}
}

// There is no identity to authenticate, so the attempt dies before any method runs.
func TestUnknownUnixUserIsDenied(t *testing.T) {
	c := dial(t, refusingAuthenticator{t})

	mustWrite(t, c, start(unknownUser))
	res := mustRead(t, c)

	if res.Type != authproto.TypeResult {
		t.Fatalf("got %q, want a result frame", res.Type)
	}
	if res.Status != authproto.StatusDenied || res.Reason != "unknown_user" {
		t.Fatalf("status = %q reason = %q, want denied/unknown_user", res.Status, res.Reason)
	}
}

func TestProtocolViolationsFailClosed(t *testing.T) {
	cases := []struct {
		name  string
		frame string
		want  string
	}{
		{"unsupported version", `{"version":9,"type":"start","username":"root"}`, "unsupported_version"},
		{"malformed json", `{"version":1,"type":`, "malformed_message"},
		{"unknown type", `{"version":1,"type":"elevate"}`, "malformed_message"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, client := net.Pipe()
			s := newSession(server, refusingAuthenticator{t}, newFakeResolver(), "D123", discardLog())
			go s.run(context.Background())
			defer func() { _ = client.Close() }()

			if _, err := client.Write([]byte(tc.frame + "\n")); err != nil {
				t.Fatalf("write: %v", err)
			}
			res := mustRead(t, authproto.NewConn(client))

			if res.Status != authproto.StatusProtocolError {
				t.Fatalf("status = %q, want protocol_error", res.Status)
			}
			if res.Reason != tc.want {
				t.Fatalf("reason = %q, want %q", res.Reason, tc.want)
			}
		})
	}
}

func TestOversizedFrameFailsClosed(t *testing.T) {
	server, client := net.Pipe()
	s := newSession(server, refusingAuthenticator{t}, newFakeResolver(), "D123", discardLog())
	go s.run(context.Background())
	defer func() { _ = client.Close() }()

	go func() {
		_, _ = client.Write([]byte(`{"version":1,"type":"start","username":"` +
			strings.Repeat("A", authproto.MaxMessageBytes) + `"}` + "\n"))
	}()

	res := mustRead(t, authproto.NewConn(client))
	if res.Status != authproto.StatusProtocolError || res.Reason != "message_too_large" {
		t.Fatalf("status = %q reason = %q, want protocol_error/message_too_large", res.Status, res.Reason)
	}
}

func TestFirstFrameMustBeStart(t *testing.T) {
	c := dial(t, refusingAuthenticator{t})

	mustWrite(t, c, &authproto.Message{Type: authproto.TypePromptResponse, PromptID: "auth_method", Value: "online"})
	res := mustRead(t, c)

	if res.Status != authproto.StatusProtocolError || res.Reason != "expected_start" {
		t.Fatalf("status = %q reason = %q, want protocol_error/expected_start", res.Status, res.Reason)
	}
}

// A response carrying the wrong prompt id means the conversation desynchronised;
// crediting it to the pending prompt would attribute the wrong input.
func TestMismatchedPromptResponseIsDenied(t *testing.T) {
	c := dial(t, stubMethods(t, "approve"))

	mustWrite(t, c, start(knownUser))
	for {
		m := mustRead(t, c)
		if m.Type == authproto.TypePrompt {
			break
		}
	}
	mustWrite(t, c, &authproto.Message{
		Type:     authproto.TypePromptResponse,
		PromptID: "some_other_prompt",
		Value:    "online",
	})

	res := mustRead(t, c)
	if res.Status != authproto.StatusDenied || res.Reason != "conversation_failed" {
		t.Fatalf("status = %q reason = %q, want denied/conversation_failed", res.Status, res.Reason)
	}
}

// An authenticator that reaches no decision must not be read as success.
func TestEmptyOutcomeIsDenied(t *testing.T) {
	c := dial(t, silentAuthenticator{})

	mustWrite(t, c, start(knownUser))
	res := mustRead(t, c)

	if res.Status != authproto.StatusDenied || res.Reason != "no_decision" {
		t.Fatalf("status = %q reason = %q, want denied/no_decision", res.Status, res.Reason)
	}
}

// refusingAuthenticator fails the test if an attempt ever reaches a method.
type refusingAuthenticator struct{ t *testing.T }

func (a refusingAuthenticator) Authenticate(context.Context, Request, Conversation) Outcome {
	a.t.Error("authenticator ran for an attempt that should have failed earlier")
	return Deny("unreachable")
}

// silentAuthenticator returns the zero Outcome.
type silentAuthenticator struct{}

func (silentAuthenticator) Authenticate(context.Context, Request, Conversation) Outcome {
	return Outcome{}
}

// A method with no implementation must be refused, not silently handled by
// another one.
func TestUnimplementedMethodIsRefused(t *testing.T) {
	stub, err := newStubAuthenticator("approve")
	if err != nil {
		t.Fatal(err)
	}
	onlineOnly := &methodAuthenticator{
		log:     discardLog(),
		methods: map[Method]Authenticator{MethodOnline: stub},
	}
	c := dial(t, onlineOnly)

	mustWrite(t, c, start(knownUser))
	res := readUntilResult(t, c, map[string]string{"auth_method": "offline"})

	if res.Status != authproto.StatusDenied || res.Reason != "method_unavailable" {
		t.Fatalf("status = %q reason = %q, want denied/method_unavailable", res.Status, res.Reason)
	}
}
