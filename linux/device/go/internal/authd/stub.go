// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"fmt"
	"strings"
)

// Method is one of the three Helix authentication methods.
type Method string

const (
	MethodOnline     Method = "online"
	MethodOffline    Method = "offline"
	MethodPersistent Method = "persistent"
)

// methodPrompt is the stock-OpenSSH textual form of the method chooser. The
// helix-ssh client renders the same choice as a menu and sends the same value,
// so the server side has exactly one representation to reason about.
const methodPrompt = "Helix authentication method [online/offline/persistent]: "

// parseMethod accepts only the three canonical values.
func parseMethod(s string) (Method, bool) {
	switch Method(strings.ToLower(strings.TrimSpace(s))) {
	case MethodOnline:
		return MethodOnline, true
	case MethodOffline:
		return MethodOffline, true
	case MethodPersistent:
		return MethodPersistent, true
	default:
		return "", false
	}
}

// stubAuthenticator stands in for the real methods while the PAM boundary is
// being proven. It performs no authentication whatsoever: it selects a method
// and returns a preconfigured verdict.
//
// It exists so the socket, the PAM module, the sshd stack and the Unix identity
// can be tested on their own, and is replaced method by method in later phases.
type stubAuthenticator struct {
	approve bool
}

func newStubAuthenticator(decision string) (*stubAuthenticator, error) {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "", "deny":
		// Defaulting to deny keeps an unconfigured daemon fail-closed.
		return &stubAuthenticator{approve: false}, nil
	case "approve":
		return &stubAuthenticator{approve: true}, nil
	default:
		return nil, fmt.Errorf("stubDecision must be \"approve\" or \"deny\", got %q", decision)
	}
}

func (a *stubAuthenticator) Authenticate(_ context.Context, req Request, conv Conversation) Outcome {
	if err := conv.Display(fmt.Sprintf("Helix device %s", req.DeviceID)); err != nil {
		return Deny("conversation_failed")
	}

	answer, err := conv.Prompt("auth_method", methodPrompt)
	if err != nil {
		return Deny("conversation_failed")
	}

	method, ok := parseMethod(answer)
	if !ok {
		_ = conv.Warn("Unknown authentication method.")
		return Deny("unknown_method")
	}

	if !a.approve {
		return Deny("stub_denied")
	}
	_ = conv.Display(fmt.Sprintf("Stub authenticator approved %s for %s.", method, req.Username))
	return Approve()
}
