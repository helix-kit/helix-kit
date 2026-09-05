// SPDX-License-Identifier: AGPL-3.0-only

package authproto

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
)

// pipe is an in-memory ReadWriteCloser for driving a Conn in tests.
type pipe struct {
	in  *bytes.Reader
	out *bytes.Buffer
}

func (p *pipe) Read(b []byte) (int, error)  { return p.in.Read(b) }
func (p *pipe) Write(b []byte) (int, error) { return p.out.Write(b) }
func (p *pipe) Close() error                { return nil }

func connWith(input string) (*Conn, *bytes.Buffer) {
	p := &pipe{in: bytes.NewReader([]byte(input)), out: &bytes.Buffer{}}
	return NewConn(p), p.out
}

func TestRoundTrip(t *testing.T) {
	c, out := connWith("")

	if err := c.Write(Prompt("auth_method", "Helix authentication method:", false)); err != nil {
		t.Fatalf("write: %v", err)
	}

	back, _ := connWith(out.String())
	m, err := back.Read()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if m.Type != TypePrompt || m.PromptID != "auth_method" || m.Secret {
		t.Fatalf("round-tripped %+v", m)
	}
	if m.Version != Version {
		t.Errorf("version = %d, want %d", m.Version, Version)
	}
}

func TestWriteAlwaysStampsVersion(t *testing.T) {
	c, out := connWith("")
	if err := c.Write(&Message{Type: TypeResult, Status: StatusApproved}); err != nil {
		t.Fatalf("write: %v", err)
	}
	if !strings.Contains(out.String(), `"version":1`) {
		t.Fatalf("frame carries no version: %s", out.String())
	}
}

func TestReadRejectsBadFrames(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  error
	}{
		{"unsupported version", `{"version":2,"type":"start","username":"alice"}` + "\n", ErrBadVersion},
		{"version zero", `{"type":"start","username":"alice"}` + "\n", ErrBadVersion},
		{"not json", "this is not json\n", ErrMalformed},
		{"truncated json", `{"version":1,"type":"start"` + "\n", ErrMalformed},
		{"unknown type", `{"version":1,"type":"elevate"}` + "\n", ErrMalformed},
		{"start without username", `{"version":1,"type":"start"}` + "\n", ErrMalformed},
		{"response without prompt id", `{"version":1,"type":"prompt_response","value":"online"}` + "\n", ErrMalformed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := connWith(tc.input)
			if _, err := c.Read(); !errors.Is(err, tc.want) {
				t.Fatalf("read error = %v, want %v", err, tc.want)
			}
		})
	}
}

// A peer must not be able to exhaust memory, and an oversized frame must not be
// silently split and parsed as two smaller ones.
func TestReadRejectsOversizedFrame(t *testing.T) {
	huge := `{"version":1,"type":"prompt_response","prompt_id":"x","value":"` +
		strings.Repeat("A", MaxMessageBytes) + `"}` + "\n"

	c, _ := connWith(huge)
	if _, err := c.Read(); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("read error = %v, want ErrTooLarge", err)
	}
}

func TestWriteRefusesOversizedFrame(t *testing.T) {
	c, out := connWith("")
	err := c.Write(Display(LevelInfo, strings.Repeat("A", MaxMessageBytes)))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("write error = %v, want ErrTooLarge", err)
	}
	if out.Len() != 0 {
		t.Fatalf("refused frame was still written (%d bytes)", out.Len())
	}
}

func TestReadEOF(t *testing.T) {
	c, _ := connWith("")
	if _, err := c.Read(); !errors.Is(err, io.EOF) {
		t.Fatalf("read error = %v, want io.EOF", err)
	}
}

// A pasted persistent credential or an offline response must never reach a log.
func TestLogValueRedactsPromptResponses(t *testing.T) {
	m := &Message{
		Version:  Version,
		Type:     TypePromptResponse,
		PromptID: "persistent_credential",
		Value:    "hlx1_D7K4P9QX_supersecretvalue",
	}

	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("prompt response", "msg", m)

	logged := buf.String()
	if strings.Contains(logged, "supersecretvalue") {
		t.Fatalf("secret leaked into the log: %s", logged)
	}
	if !strings.Contains(logged, "[redacted]") {
		t.Fatalf("value was not redacted: %s", logged)
	}
	if !strings.Contains(logged, "persistent_credential") {
		t.Fatalf("prompt_id should still be logged: %s", logged)
	}
}

func TestConstructors(t *testing.T) {
	if m := Display(LevelError, "nope"); m.Type != TypeDisplay || m.Level != LevelError {
		t.Errorf("Display built %+v", m)
	}
	if m := Prompt("p", "text", true); !m.Secret || m.PromptID != "p" {
		t.Errorf("Prompt built %+v", m)
	}
	if m := Result(StatusDenied, "authorization_denied"); m.Status != StatusDenied || m.Reason != "authorization_denied" {
		t.Errorf("Result built %+v", m)
	}
}
