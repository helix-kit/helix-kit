// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"fmt"
	"log/slog"
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

// stubAuthenticator stands in for a real method while the PAM boundary is being
// exercised on its own. It performs no authentication whatsoever: it returns a
// preconfigured verdict, and exists so the socket, the PAM module, the sshd stack
// and the resulting Unix identity can be tested without a cloud.
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

func (a *stubAuthenticator) Authenticate(_ context.Context, _ Request, _ Conversation) Outcome {
	if !a.approve {
		return Deny("stub_denied")
	}
	return Approve()
}

// methodAuthenticator asks which method the user wants and hands the attempt to
// it. Owning the choice in one place keeps every method free of the question, and
// means an unimplemented one is refused rather than silently skipped.
type methodAuthenticator struct {
	methods map[Method]Authenticator
	log     *slog.Logger
}

func (a *methodAuthenticator) Authenticate(ctx context.Context, req Request, conv Conversation) Outcome {
	answer, err := conv.Prompt("auth_method", methodPrompt)
	if err != nil {
		return Deny("conversation_failed")
	}

	method, ok := parseMethod(answer)
	if !ok {
		_ = conv.Warn("Unknown authentication method.")
		return Deny("unknown_method")
	}

	impl, ok := a.methods[method]
	if !ok {
		a.log.Warn("method not available", "request_id", req.RequestID, "method", string(method))
		_ = conv.Warn(fmt.Sprintf("%s authentication is not available on this device.", method))
		return Deny("method_unavailable")
	}

	a.log.Info("method selected", "request_id", req.RequestID, "method", string(method))
	return impl.Authenticate(ctx, req, conv)
}
