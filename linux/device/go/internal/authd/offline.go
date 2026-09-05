// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"time"
)

const (
	defaultChallengeTTL     = 5 * time.Minute
	defaultOfflineMaxAge    = 12 * time.Hour
	defaultOfflineAttempts  = 3
	offlineUnavailableText  = "Offline authentication unavailable."
	offlineStaleCacheText   = "Offline authentication unavailable: authorization cache is stale."
	offlineWrongCodeMessage = "That response is not correct."
)

// offlineAuthenticator implements Method 2: the device cannot reach the cloud,
// but the person at it has a phone that can.
//
// The device shows a challenge, the user gets a response from the cloud on their
// phone, and the device recomputes the same digest locally. Nothing here touches
// the network — that is the entire point.
//
// The response proves only that the cloud authorized this user, for this device,
// for this challenge. It carries no scopes, so the device falls back on the
// snapshot it cached while online, which is why a user it has never seen cannot
// get in this way at all.
type offlineAuthenticator struct {
	secret []byte
	store  *Store
	log    *slog.Logger

	// maxScopeAge is how long a cached authorization may still be acted on once
	// the device is offline.
	maxScopeAge  time.Duration
	challengeTTL time.Duration
	maxAttempts  int
	// verificationURI is where the user goes on their phone.
	verificationURI string

	// now and randomBytes are injectable so expiry and challenge generation can
	// be tested without sleeping or guessing.
	now         func() time.Time
	randomBytes func([]byte) error
}

func (a *offlineAuthenticator) clock() time.Time {
	if a.now != nil {
		return a.now()
	}
	return time.Now()
}

func (a *offlineAuthenticator) readRandom(buf []byte) error {
	if a.randomBytes != nil {
		return a.randomBytes(buf)
	}
	_, err := rand.Read(buf)
	return err
}

func (a *offlineAuthenticator) attempts() int {
	if a.maxAttempts > 0 {
		return a.maxAttempts
	}
	return defaultOfflineAttempts
}

func (a *offlineAuthenticator) Authenticate(ctx context.Context, req Request, conv Conversation) Outcome {
	cached, outcome, ok := a.eligible(req, conv)
	if !ok {
		return outcome
	}

	challenge, err := a.newChallenge()
	if err != nil {
		a.log.Error("could not generate a challenge", "request_id", req.RequestID, "error", err)
		return Unavailable("challenge_unavailable")
	}

	expected, err := OfflineResponse(a.secret, OfflineBinding{
		DeviceID:  req.DeviceID,
		UserID:    cached.UserID,
		LinuxUID:  cached.LinuxUID,
		Challenge: challenge,
	})
	if err != nil {
		a.log.Error("could not compute the expected response", "request_id", req.RequestID, "error", err)
		return Unavailable("challenge_unavailable")
	}

	ttl := a.challengeTTL
	if ttl <= 0 {
		ttl = defaultChallengeTTL
	}
	deadline := a.clock().Add(ttl)
	prompt := a.challengePrompt(req, challenge)

	for attempt := 1; attempt <= a.attempts(); attempt++ {
		if err := ctx.Err(); err != nil {
			return Deny("timeout")
		}

		answer, err := conv.Prompt("offline_response", prompt)
		if err != nil {
			return Deny("conversation_failed")
		}

		// Checked after the answer arrives so a slow typist is told why, rather
		// than being silently refused.
		if a.clock().After(deadline) {
			a.log.Info("offline challenge expired", "request_id", req.RequestID)
			_ = conv.Warn("That challenge has expired. Try again.")
			return Expired("challenge_expired")
		}

		if subtle.ConstantTimeCompare([]byte(normalizeCode(answer)), []byte(expected)) == 1 {
			a.log.Info("offline authentication approved", "request_id", req.RequestID,
				"username", req.Username, "uid", req.UID,
				"policy_version", cached.PolicyVersion,
				"cache_age_seconds", int(a.clock().Sub(cached.RefreshedAt).Seconds()))
			return Approve()
		}

		a.log.Warn("offline response rejected", "request_id", req.RequestID,
			"username", req.Username, "attempt", attempt)
		// The prompt is only repeated while attempts remain.
		if attempt < a.attempts() {
			_ = conv.Warn(offlineWrongCodeMessage)
			prompt = "Response: "
		}
	}

	// The challenge dies with this attempt; the next SSH connection generates a
	// fresh one, so a captured response is never worth replaying.
	a.log.Warn("offline challenge exhausted", "request_id", req.RequestID, "username", req.Username)
	return Deny("challenge_exhausted")
}

// eligible enforces the preconditions for offering an offline challenge at all.
func (a *offlineAuthenticator) eligible(req Request, conv Conversation) (*CachedUser, Outcome, bool) {
	cached, err := a.store.CachedUser(req.Username)
	if err != nil {
		// A user this device has never successfully authorized online cannot
		// bootstrap themselves offline. This is the rule the whole method rests on.
		a.log.Info("offline authentication refused: no cached authorization",
			"request_id", req.RequestID, "username", req.Username)
		_ = conv.Warn(offlineUnavailableText)
		return nil, Deny("no_cached_user"), false
	}

	// The cache is keyed by username, so a uid that no longer matches means the
	// identity underneath has changed since it was written.
	if cached.LinuxUID != req.UID {
		a.log.Warn("cached uid no longer matches NSS", "request_id", req.RequestID,
			"cached_uid", cached.LinuxUID, "nss_uid", req.UID)
		_ = conv.Warn(offlineUnavailableText)
		return nil, Deny("identity_mismatch"), false
	}

	if !cached.HasScope(DeviceLoginScope) {
		a.log.Info("offline authentication refused: no cached login scope",
			"request_id", req.RequestID, "username", req.Username)
		_ = conv.Warn(offlineUnavailableText)
		return nil, Deny("authorization_denied"), false
	}

	if age := a.clock().Sub(cached.RefreshedAt); age > a.maxAge() {
		a.log.Info("offline authentication refused: stale authorization cache",
			"request_id", req.RequestID, "username", req.Username,
			"age_seconds", int(age.Seconds()))
		_ = conv.Warn(offlineStaleCacheText)
		return nil, Deny("cache_stale"), false
	}

	return cached, Outcome{}, true
}

func (a *offlineAuthenticator) maxAge() time.Duration {
	if a.maxScopeAge > 0 {
		return a.maxScopeAge
	}
	return defaultOfflineMaxAge
}

// newChallenge returns a fresh challenge. A new one per attempt is what makes a
// response worthless once used.
func (a *offlineAuthenticator) newChallenge() (string, error) {
	raw := make([]byte, codeRawBytes)
	if err := a.readRandom(raw); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return encodeCode(raw)
}

func (a *offlineAuthenticator) challengePrompt(req Request, challenge string) string {
	return fmt.Sprintf(
		"Offline Helix authentication\n\nDevice: %s\nOpen: %s\nChallenge: %s\n\nResponse: ",
		req.DeviceID, a.verificationURI, formatCode(challenge))
}
