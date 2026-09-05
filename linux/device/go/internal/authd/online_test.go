// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/authproto"
)

const (
	testDeviceID    = "D123"
	testDeviceToken = "device-access-token"
	testUserID      = "user_alice"
)

// fakeCloud is an HTTP server speaking the bodies captured from the live Better
// Auth and gateway run, so the client is tested against the real wire shapes
// rather than an idealised version of them.
type fakeCloud struct {
	mu sync.Mutex

	// pollsBeforeApproval is how many times the device is told to wait.
	pollsBeforeApproval int
	polls               int
	// tokenError, when set, is returned instead of approving.
	tokenError string
	// decision is what the authorize endpoint answers.
	decision map[string]any
	// authorizeStatus overrides the authorize response status.
	authorizeStatus int
	// seenBearer records the credential the device presented.
	seenBearer string
	// seenSessionToken records what the device asked about.
	seenSessionToken string
}

func (f *fakeCloud) lock() func() { f.mu.Lock(); return f.mu.Unlock }

func newFakeCloud() *fakeCloud {
	return &fakeCloud{
		decision: map[string]any{
			"allowed":       true,
			"linuxUid":      200001,
			"policyVersion": 7,
			"scopes":        []string{DeviceLoginScope, "app.foo.read"},
			"username":      "alice",
			"userId":        testUserID,
		},
		authorizeStatus: http.StatusOK,
	}
}

func (f *fakeCloud) start(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/device/code", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"device_code":               "SikbNvoEiUuB3GgrWVGCtiaqXVNAmG7GMxetncca",
			"user_code":                 "PLZ9X3AV",
			"verification_uri":          "https://helix-kit.com/device",
			"verification_uri_complete": "https://helix-kit.com/device?user_code=PLZ9X3AV",
			"expires_in":                600,
			// Poll fast so the tests do not sleep for seconds at a time.
			"interval": 0,
		})
	})

	mux.HandleFunc("/api/auth/device/token", func(w http.ResponseWriter, _ *http.Request) {
		defer f.lock()()
		if f.tokenError != "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":             f.tokenError,
				"error_description": f.tokenError,
			})
			return
		}
		f.polls++
		if f.polls <= f.pollsBeforeApproval {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":             "authorization_pending",
				"error_description": "Authorization pending",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"access_token": "2Jm8hMFe6wzkulnWOyXjd8dkhmjmyOj0",
			"token_type":   "Bearer",
			"expires_in":   604799,
		})
	})

	mux.HandleFunc("/api/device-auth/authorize-session", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SessionToken string `json:"sessionToken"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		defer f.lock()()
		f.seenBearer = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		f.seenSessionToken = body.SessionToken
		writeJSON(w, f.authorizeStatus, f.decision)
	})

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// onlineFor wires the authenticator against a fake cloud and a real store.
func onlineFor(t *testing.T, fake *fakeCloud) (*onlineAuthenticator, *Store) {
	t.Helper()
	server := fake.start(t)

	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	return &onlineAuthenticator{
		cloud: NewCloud(CloudConfig{
			AuthBaseURL:    server.URL,
			GatewayBaseURL: server.URL,
			DeviceID:       testDeviceID,
			AccessToken:    testDeviceToken,
			Timeout:        5 * time.Second,
		}),
		store:          store,
		log:            discardLog(),
		browserTimeout: 10 * time.Second,
		pollInterval:   10 * time.Millisecond,
	}, store
}

// scriptedConversation answers prompts without a human.
type scriptedConversation struct {
	prompts []string
	warns   []string
}

func (c *scriptedConversation) Display(string) error { return nil }
func (c *scriptedConversation) Warn(text string) error {
	c.warns = append(c.warns, text)
	return nil
}

func (c *scriptedConversation) Prompt(_, text string) (string, error) {
	c.prompts = append(c.prompts, text)
	return "", nil
}
func (c *scriptedConversation) PromptSecret(id, text string) (string, error) {
	return c.Prompt(id, text)
}

func aliceRequest() Request {
	return Request{RequestID: "req-1", Username: "alice", UID: 200001, GID: 200001, DeviceID: testDeviceID}
}

func TestOnlineAuthenticationApproves(t *testing.T) {
	fake := newFakeCloud()
	fake.pollsBeforeApproval = 2
	auth, store := onlineFor(t, fake)
	conv := &scriptedConversation{}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusApproved {
		t.Fatalf("status = %q reason = %q, want approved", outcome.Status, outcome.Reason)
	}

	// The user must be told where to go and what to type.
	if len(conv.prompts) != 1 {
		t.Fatalf("got %d prompts, want 1", len(conv.prompts))
	}
	for _, want := range []string{"https://helix-kit.com/device", "PLZ9X3AV"} {
		if !strings.Contains(conv.prompts[0], want) {
			t.Errorf("prompt does not mention %q: %s", want, conv.prompts[0])
		}
	}

	// The device authenticates as itself and asks about the session it holds.
	if fake.seenBearer != testDeviceToken {
		t.Errorf("device presented %q, want its access token", fake.seenBearer)
	}
	if fake.seenSessionToken != "2Jm8hMFe6wzkulnWOyXjd8dkhmjmyOj0" {
		t.Errorf("asked about session %q", fake.seenSessionToken)
	}

	cached, err := store.CachedUser("alice")
	if err != nil {
		t.Fatalf("alice was not cached: %v", err)
	}
	if cached.UserID != testUserID || cached.LinuxUID != 200001 || cached.PolicyVersion != 7 {
		t.Errorf("cached %+v", cached)
	}
	if !cached.HasScope(DeviceLoginScope) {
		t.Errorf("cached scopes %v lack the login scope", cached.Scopes)
	}
}

func TestOnlineAuthenticationFailures(t *testing.T) {
	cases := []struct {
		name       string
		arrange    func(f *fakeCloud)
		wantStatus authproto.Status
		wantReason string
	}{
		{
			name:       "the user denies it in the browser",
			arrange:    func(f *fakeCloud) { f.tokenError = "access_denied" },
			wantStatus: authproto.StatusDenied,
			wantReason: "authorization_denied",
		},
		{
			name:       "the code expires before anyone approves",
			arrange:    func(f *fakeCloud) { f.tokenError = "expired_token" },
			wantStatus: authproto.StatusExpired,
			wantReason: "code_expired",
		},
		{
			// Signing in as somebody else must not log in the requested user.
			name: "a different account approves it",
			arrange: func(f *fakeCloud) {
				f.decision["username"] = "bob"
				f.decision["linuxUid"] = 200002
				f.decision["userId"] = "user_bob"
			},
			wantStatus: authproto.StatusDenied,
			wantReason: "identity_mismatch",
		},
		{
			// The session would otherwise run as a different Unix user.
			name:       "the cloud's uid disagrees with NSS",
			arrange:    func(f *fakeCloud) { f.decision["linuxUid"] = 999999 },
			wantStatus: authproto.StatusDenied,
			wantReason: "identity_mismatch",
		},
		{
			name:       "the user has no login scope",
			arrange:    func(f *fakeCloud) { f.decision["scopes"] = []string{"app.foo.read"} },
			wantStatus: authproto.StatusDenied,
			wantReason: "authorization_denied",
		},
		{
			name:       "authorization is refused outright",
			arrange:    func(f *fakeCloud) { f.decision["allowed"] = false },
			wantStatus: authproto.StatusDenied,
			wantReason: "authorization_denied",
		},
		{
			name:       "the cloud has no identity for them",
			arrange:    func(f *fakeCloud) { f.decision["username"] = nil; f.decision["linuxUid"] = nil },
			wantStatus: authproto.StatusDenied,
			wantReason: "identity_unknown",
		},
		{
			// A rejected device token must not read as a refusal of the user.
			name:       "the gateway rejects the device",
			arrange:    func(f *fakeCloud) { f.authorizeStatus = http.StatusUnauthorized },
			wantStatus: authproto.StatusUnavailable,
			wantReason: "cloud_unavailable",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeCloud()
			tc.arrange(fake)
			auth, store := onlineFor(t, fake)

			outcome := auth.Authenticate(context.Background(), aliceRequest(), &scriptedConversation{})

			if outcome.Status != tc.wantStatus || outcome.Reason != tc.wantReason {
				t.Fatalf("status = %q reason = %q, want %q/%q",
					outcome.Status, outcome.Reason, tc.wantStatus, tc.wantReason)
			}

			// Nothing that failed may leave a cached authorization behind, or a
			// rejected user could later log in offline.
			if _, err := store.CachedUser("alice"); !errors.Is(err, ErrNoCachedUser) {
				t.Fatalf("a failed attempt cached the user: %v", err)
			}
		})
	}
}

// Not being able to ask is not a denial, and must never become an approval.
func TestOnlineAuthenticationWithNoCloud(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	auth := &onlineAuthenticator{
		// A port nothing is listening on.
		cloud: NewCloud(CloudConfig{
			AuthBaseURL:    "http://127.0.0.1:1",
			GatewayBaseURL: "http://127.0.0.1:1",
			DeviceID:       testDeviceID,
			AccessToken:    testDeviceToken,
			Timeout:        time.Second,
		}),
		store:          store,
		log:            discardLog(),
		browserTimeout: 5 * time.Second,
		pollInterval:   10 * time.Millisecond,
	}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), &scriptedConversation{})

	if outcome.Status != authproto.StatusUnavailable {
		t.Fatalf("status = %q, want unavailable", outcome.Status)
	}
}

// A client that hangs up must not leave the daemon polling a dead login.
func TestOnlineAuthenticationStopsWhenTheClientLeaves(t *testing.T) {
	fake := newFakeCloud()
	fake.tokenError = "authorization_pending"
	auth, _ := onlineFor(t, fake)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan Outcome, 1)
	go func() { done <- auth.Authenticate(ctx, aliceRequest(), &scriptedConversation{}) }()

	cancel()

	select {
	case outcome := <-done:
		if outcome.Status == authproto.StatusApproved {
			t.Fatalf("an abandoned attempt was approved")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the attempt kept polling after the client left")
	}
}
