// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/authproto"
)

var offlineSecret = []byte(strings.Repeat("s", 32))

// answeringConversation replies to each prompt from a script, and records what it
// was shown so the tests can assert on what a person would actually see.
type answeringConversation struct {
	answers []string
	prompts []string
	warns   []string
}

func (c *answeringConversation) Display(string) error { return nil }
func (c *answeringConversation) Warn(text string) error {
	c.warns = append(c.warns, text)
	return nil
}

func (c *answeringConversation) Prompt(_, text string) (string, error) {
	c.prompts = append(c.prompts, text)
	if len(c.prompts) > len(c.answers) {
		return "", nil
	}
	return c.answers[len(c.prompts)-1], nil
}

func (c *answeringConversation) PromptSecret(id, text string) (string, error) {
	return c.Prompt(id, text)
}

// offlineFor builds the authenticator over a real store, with a fixed challenge
// so the expected response is computable in the test.
func offlineFor(t *testing.T, challengeRaw []byte, cached *CachedUser) (*offlineAuthenticator, *Store) {
	t.Helper()

	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if cached != nil {
		if err := store.PutCachedUser(*cached); err != nil {
			t.Fatalf("PutCachedUser: %v", err)
		}
	}

	return &offlineAuthenticator{
		secret:          offlineSecret,
		store:           store,
		log:             discardLog(),
		maxScopeAge:     time.Hour,
		challengeTTL:    5 * time.Minute,
		verificationURI: "https://helix-kit.com/device/offline",
		randomBytes: func(buf []byte) error {
			copy(buf, challengeRaw)
			return nil
		},
	}, store
}

func cachedAlice() CachedUser {
	return CachedUser{
		UserID:        testUserID,
		Username:      "alice",
		LinuxUID:      200001,
		Scopes:        []string{DeviceLoginScope, "app.foo.read"},
		PolicyVersion: 7,
		RefreshedAt:   time.Now().UTC(),
	}
}

// fixedChallenge is the raw challenge the injected randomness produces.
var fixedChallenge = []byte{0x01, 0x23, 0x45, 0x67, 0x89}

func expectedFor(t *testing.T, userID string, uid uint32) string {
	t.Helper()
	challenge, err := encodeCode(fixedChallenge)
	if err != nil {
		t.Fatalf("encodeCode: %v", err)
	}
	response, err := OfflineResponse(offlineSecret, OfflineBinding{
		DeviceID: testDeviceID, UserID: userID, LinuxUID: uid, Challenge: challenge,
	})
	if err != nil {
		t.Fatalf("OfflineResponse: %v", err)
	}
	return response
}

func TestOfflineAuthenticationApproves(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)
	conv := &answeringConversation{answers: []string{expectedFor(t, testUserID, 200001)}}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusApproved {
		t.Fatalf("status = %q reason = %q, want approved", outcome.Status, outcome.Reason)
	}

	// The user needs the device id and the challenge to get anywhere.
	challenge, _ := encodeCode(fixedChallenge)
	for _, want := range []string{testDeviceID, formatCode(challenge), "helix-kit.com"} {
		if !strings.Contains(conv.prompts[0], want) {
			t.Errorf("prompt does not mention %q:\n%s", want, conv.prompts[0])
		}
	}
	// The hyphenated form is for reading; the canonical one must not be shown raw.
	if !strings.Contains(conv.prompts[0], "-") {
		t.Errorf("challenge was not shown in its readable form:\n%s", conv.prompts[0])
	}
}

// People retype these, so the same forgiveness the parser has must reach here.
func TestOfflineAcceptsAReadableResponse(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)
	conv := &answeringConversation{answers: []string{formatCode(expectedFor(t, testUserID, 200001))}}

	if outcome := auth.Authenticate(context.Background(), aliceRequest(), conv); outcome.Status != authproto.StatusApproved {
		t.Fatalf("a hyphenated response was refused: %q", outcome.Reason)
	}
}

// The security test the spec asks for by name: Bob signs in on his phone, enters
// the challenge Alice's terminal is showing, and types back what the cloud gives
// him. The cloud bound it to Bob, the device expects Alice, so it must fail.
func TestOfflineRejectsAnotherUsersResponse(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)

	bobsResponse := expectedFor(t, "user_bob", 200002)
	conv := &answeringConversation{answers: []string{bobsResponse, bobsResponse, bobsResponse}}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusDenied || outcome.Reason != "challenge_exhausted" {
		t.Fatalf("status = %q reason = %q, want denied/challenge_exhausted", outcome.Status, outcome.Reason)
	}
}

func TestOfflineAllowsThreeAttempts(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)

	// Two typos, then the right one.
	conv := &answeringConversation{answers: []string{
		"AAAAAAAA", "BBBBBBBB", expectedFor(t, testUserID, 200001),
	}}

	if outcome := auth.Authenticate(context.Background(), aliceRequest(), conv); outcome.Status != authproto.StatusApproved {
		t.Fatalf("status = %q reason = %q, want approved", outcome.Status, outcome.Reason)
	}
	if len(conv.prompts) != 3 {
		t.Fatalf("got %d prompts, want 3", len(conv.prompts))
	}
	if len(conv.warns) != 2 {
		t.Fatalf("got %d warnings, want one per failed attempt", len(conv.warns))
	}
}

func TestOfflineExhaustsAfterThreeWrongAnswers(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)
	conv := &answeringConversation{answers: []string{"AAAAAAAA", "BBBBBBBB", "CCCCCCCC", expectedFor(t, testUserID, 200001)}}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusDenied || outcome.Reason != "challenge_exhausted" {
		t.Fatalf("status = %q reason = %q, want denied/challenge_exhausted", outcome.Status, outcome.Reason)
	}
	// A fourth answer must never be asked for, even a correct one.
	if len(conv.prompts) != 3 {
		t.Fatalf("got %d prompts, want exactly 3", len(conv.prompts))
	}
}

// Every attempt gets a fresh challenge, so a response captured from one login is
// worthless against the next.
func TestOfflineChallengeChangesEveryAttempt(t *testing.T) {
	alice := cachedAlice()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer func() { _ = store.Close() }()
	if err := store.PutCachedUser(alice); err != nil {
		t.Fatalf("PutCachedUser: %v", err)
	}

	auth := &offlineAuthenticator{
		secret: offlineSecret, store: store, log: discardLog(),
		maxScopeAge: time.Hour, challengeTTL: time.Minute,
		verificationURI: "https://helix-kit.com/device/offline",
	}

	first := &answeringConversation{answers: []string{"AAAAAAAA", "AAAAAAAA", "AAAAAAAA"}}
	auth.Authenticate(context.Background(), aliceRequest(), first)
	second := &answeringConversation{answers: []string{"AAAAAAAA", "AAAAAAAA", "AAAAAAAA"}}
	auth.Authenticate(context.Background(), aliceRequest(), second)

	if first.prompts[0] == second.prompts[0] {
		t.Fatal("two attempts were offered the same challenge")
	}
}

func TestOfflineRefusesIneligibleUsers(t *testing.T) {
	staleAlice := cachedAlice()
	staleAlice.RefreshedAt = time.Now().UTC().Add(-2 * time.Hour)

	noLoginAlice := cachedAlice()
	noLoginAlice.Scopes = []string{"app.foo.read"}

	movedAlice := cachedAlice()
	movedAlice.LinuxUID = 999999

	cases := []struct {
		name       string
		cached     *CachedUser
		wantReason string
		wantWarn   string
	}{
		{
			// The rule the method rests on: no offline bootstrap for a stranger.
			name:   "a user the device has never authorized",
			cached: nil, wantReason: "no_cached_user", wantWarn: offlineUnavailableText,
		},
		{
			name:   "a snapshot older than the offline window",
			cached: &staleAlice, wantReason: "cache_stale", wantWarn: offlineStaleCacheText,
		},
		{
			name:   "a user whose cached login scope was withdrawn",
			cached: &noLoginAlice, wantReason: "authorization_denied", wantWarn: offlineUnavailableText,
		},
		{
			name:   "a cached uid that no longer matches NSS",
			cached: &movedAlice, wantReason: "identity_mismatch", wantWarn: offlineUnavailableText,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			auth, _ := offlineFor(t, fixedChallenge, tc.cached)
			conv := &answeringConversation{answers: []string{expectedFor(t, testUserID, 200001)}}

			outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

			if outcome.Status != authproto.StatusDenied || outcome.Reason != tc.wantReason {
				t.Fatalf("status = %q reason = %q, want denied/%s",
					outcome.Status, outcome.Reason, tc.wantReason)
			}
			// No challenge may be offered at all: there is nothing to answer.
			if len(conv.prompts) != 0 {
				t.Fatalf("a challenge was offered anyway: %v", conv.prompts)
			}
			if len(conv.warns) == 0 || conv.warns[0] != tc.wantWarn {
				t.Fatalf("warnings = %v, want %q", conv.warns, tc.wantWarn)
			}
		})
	}
}

// A challenge that outlives its window is refused even if answered correctly.
func TestOfflineChallengeExpires(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)
	auth.challengeTTL = time.Minute

	now := time.Now().UTC()
	calls := 0
	auth.now = func() time.Time {
		calls++
		// Eligibility and the deadline are read first; the answer arrives late.
		if calls > 2 {
			return now.Add(2 * time.Minute)
		}
		return now
	}

	conv := &answeringConversation{answers: []string{expectedFor(t, testUserID, 200001)}}
	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusExpired || outcome.Reason != "challenge_expired" {
		t.Fatalf("status = %q reason = %q, want expired/challenge_expired", outcome.Status, outcome.Reason)
	}
}

// The method's whole purpose is working without the network, so nothing in it may
// consult a Cloud at all.
func TestOfflineNeverCallsTheCloud(t *testing.T) {
	alice := cachedAlice()
	auth, _ := offlineFor(t, fixedChallenge, &alice)

	if auth.secret == nil {
		t.Fatal("the authenticator has no device secret")
	}
	// The struct has no Cloud field; this test exists so that adding one, and
	// reaching for it here, is a deliberate act rather than an accident.
	conv := &answeringConversation{answers: []string{expectedFor(t, testUserID, 200001)}}
	if outcome := auth.Authenticate(context.Background(), aliceRequest(), conv); outcome.Status != authproto.StatusApproved {
		t.Fatalf("offline authentication needed something it should not: %q", outcome.Reason)
	}
}
