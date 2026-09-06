// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
)

const (
	defaultMinDurationHours = 1
	defaultMaxDurationHours = 168
	hoursPerDay             = 24

	persistentUnavailableText = "Persistent authentication unavailable. Use offline authentication instead."
)

// persistentAuthenticator implements Method 3: a reusable credential for the
// cases where opening a browser every time is the wrong answer -- repeated
// debugging, long sessions, scripts, agents.
//
// It is not an offline credential. Holding it proves who you are; it never
// proves you are still allowed in, so every use asks the cloud. A credential
// that is cryptographically perfect still loses to a current denial.
type persistentAuthenticator struct {
	cloud Cloud
	store *Store
	log   *slog.Logger

	// deviceKey turns a secret into the verifier the device keeps. Without it a
	// stolen state database yields nothing worth attacking.
	deviceKey []byte

	minDurationHours int
	maxDurationHours int
	// enrollTimeout bounds the whole browser round trip.
	enrollTimeout time.Duration

	now         func() time.Time
	randomBytes func([]byte) error
}

func (a *persistentAuthenticator) clock() time.Time {
	if a.now != nil {
		return a.now()
	}
	return time.Now()
}

func (a *persistentAuthenticator) Authenticate(ctx context.Context, req Request, conv Conversation) Outcome {
	ctx, cancel := context.WithTimeout(ctx, a.timeout())
	defer cancel()

	existing, err := a.activeCredential(req)
	if err != nil {
		return Unavailable("state_unavailable")
	}

	if existing == nil {
		return a.enroll(ctx, req, conv)
	}

	choice, err := conv.Prompt("persistent_action", a.existingCredentialPrompt(existing))
	if err != nil {
		return Deny("conversation_failed")
	}

	switch strings.ToLower(strings.TrimSpace(choice)) {
	case "", "use":
		return a.login(ctx, req, conv)
	case "rotate":
		// Revoked before the replacement exists, so an abandoned rotation leaves
		// no credential rather than leaving the one the user meant to replace.
		if err := a.store.RevokeCredential(existing.ID); err != nil {
			a.log.Error("could not revoke the old credential", "request_id", req.RequestID, "error", err)
			return Unavailable("state_unavailable")
		}
		a.log.Info("persistent credential revoked for rotation",
			"request_id", req.RequestID, "username", req.Username, "credential_id", existing.ID)
		return a.enroll(ctx, req, conv)
	case "back":
		return Deny("cancelled")
	default:
		_ = conv.Warn("Unknown choice.")
		return Deny("unknown_choice")
	}
}

// activeCredential returns the user's usable credential, expiring it in passing
// if its time has run out.
func (a *persistentAuthenticator) activeCredential(req Request) (*StoredCredential, error) {
	cred, err := a.store.ActiveCredential(req.Username)
	if errors.Is(err, ErrNoCredential) {
		return nil, nil
	}
	if err != nil {
		a.log.Error("could not read credentials", "request_id", req.RequestID, "error", err)
		return nil, err
	}
	if cred.Expired(a.clock()) {
		if err := a.store.ExpireCredential(cred.ID); err != nil {
			a.log.Warn("could not mark a credential expired", "request_id", req.RequestID, "error", err)
		}
		return nil, nil
	}
	return cred, nil
}

// login verifies a credential the user already holds, then asks the cloud.
func (a *persistentAuthenticator) login(ctx context.Context, req Request, conv Conversation) Outcome {
	pasted, err := conv.PromptSecret("persistent_credential", "Persistent credential: ")
	if err != nil {
		return Deny("conversation_failed")
	}

	cred, outcome, ok := a.verifyLocally(req, pasted)
	if !ok {
		return outcome
	}

	// Local verification is authentication. Authorization is always the cloud's,
	// and is asked for on every single use.
	decision, err := a.cloud.AuthorizeUser(ctx, cred.UserID)
	if err != nil {
		a.log.Warn("could not reauthorize a persistent login", "request_id", req.RequestID, "error", err)
		// Deliberately not falling back to the cached authorization, and not
		// switching to the offline method: the user chooses that, not the device.
		_ = conv.Warn(persistentUnavailableText)
		return Unavailable("cloud_unavailable")
	}

	return a.admit(req, decision, conv)
}

// verifyLocally checks a pasted credential against what the device stored.
func (a *persistentAuthenticator) verifyLocally(req Request, pasted string) (*StoredCredential, Outcome, bool) {
	parsed, err := ParseCredential(pasted)
	if err != nil {
		a.log.Warn("malformed persistent credential", "request_id", req.RequestID, "error", err)
		return nil, Outcome{Status: invalidCredential, Reason: "malformed_credential"}, false
	}

	cred, err := a.store.Credential(parsed.ID)
	if errors.Is(err, ErrNoCredential) {
		a.log.Warn("unknown persistent credential", "request_id", req.RequestID)
		return nil, Outcome{Status: invalidCredential, Reason: "unknown_credential"}, false
	}
	if err != nil {
		return nil, Unavailable("state_unavailable"), false
	}

	if cred.State != CredentialActive {
		a.log.Warn("persistent credential is not active", "request_id", req.RequestID,
			"credential_id", cred.ID, "state", string(cred.State))
		return nil, Outcome{Status: invalidCredential, Reason: "credential_" + strings.ToLower(string(cred.State))}, false
	}
	if cred.Expired(a.clock()) {
		if expireErr := a.store.ExpireCredential(cred.ID); expireErr != nil {
			a.log.Warn("could not mark a credential expired", "request_id", req.RequestID, "error", expireErr)
		}
		return nil, Expired("credential_expired"), false
	}

	// A credential belongs to one Unix user on one device. Presenting somebody
	// else's is not an authentication failure to be retried; it is a refusal.
	if cred.Username != req.Username || cred.LinuxUID != req.UID {
		a.log.Warn("persistent credential belongs to another user", "request_id", req.RequestID,
			"credential_user", cred.Username, "requested_user", req.Username)
		return nil, Deny("identity_mismatch"), false
	}

	verifier, err := CredentialVerifier(a.deviceKey, parsed.Secret)
	if err != nil {
		return nil, Unavailable("state_unavailable"), false
	}
	if !VerifierMatches(cred.Verifier, verifier) {
		a.log.Warn("persistent credential did not verify", "request_id", req.RequestID,
			"credential_id", cred.ID)
		return nil, Outcome{Status: invalidCredential, Reason: "verifier_mismatch"}, false
	}
	return cred, Outcome{}, true
}

// enroll mints a credential, has the cloud show it to its owner once, and
// activates it only when the owner pastes it back here.
func (a *persistentAuthenticator) enroll(ctx context.Context, req Request, conv Conversation) Outcome {
	hours, outcome, ok := a.askDuration(conv)
	if !ok {
		return outcome
	}

	credential, err := NewPersistentCredential(a.randomBytes)
	if err != nil {
		a.log.Error("could not mint a credential", "request_id", req.RequestID, "error", err)
		return Unavailable("credential_unavailable")
	}
	verifier, err := CredentialVerifier(a.deviceKey, credential.Secret)
	if err != nil {
		a.log.Error("could not compute a verifier", "request_id", req.RequestID, "error", err)
		return Unavailable("credential_unavailable")
	}

	cached, err := a.store.CachedUser(req.Username)
	if err != nil {
		// Enrollment records which platform user the credential belongs to, and
		// only a previous cloud-connected login can tell the device that.
		a.log.Info("cannot enrol without a known platform identity",
			"request_id", req.RequestID, "username", req.Username)
		_ = conv.Warn("Sign in online once before creating a persistent credential.")
		return Deny("no_cached_user")
	}

	if storeErr := a.store.PutPendingCredential(StoredCredential{
		ID: credential.ID, Username: req.Username, UserID: cached.UserID,
		LinuxUID: req.UID, Verifier: verifier, DurationSec: hours * int(time.Hour/time.Second),
		CreatedAt: a.clock(),
	}); storeErr != nil {
		a.log.Error("could not record the enrollment", "request_id", req.RequestID, "error", storeErr)
		return Unavailable("state_unavailable")
	}

	enrollment, err := a.cloud.CreateEnrollment(ctx, EnrollmentRequest{
		Username: req.Username, LinuxUID: req.UID,
		CredentialID: credential.ID, Credential: credential.String(),
		DurationHours: hours,
	})
	if err != nil {
		a.log.Warn("could not start an enrollment", "request_id", req.RequestID, "error", err)
		_ = conv.Warn(persistentUnavailableText)
		return Unavailable("cloud_unavailable")
	}

	// The plaintext is gone from this process from here on: the cloud holds the
	// only copy until its owner takes it, and the device keeps the verifier.
	credential.Secret = nil

	pasted, err := conv.PromptSecret("persistent_activation", a.activationPrompt(enrollment, hours))
	if err != nil {
		return Deny("conversation_failed")
	}

	return a.activate(ctx, req, conv, enrollment, pasted)
}

// activate completes an enrollment: the paste proves possession, the cloud
// confirms approval, and only both together make the credential usable.
func (a *persistentAuthenticator) activate(
	ctx context.Context,
	req Request,
	conv Conversation,
	enrollment *EnrollmentState,
	pasted string,
) Outcome {
	parsed, err := ParseCredential(pasted)
	if err != nil {
		return Outcome{Status: invalidCredential, Reason: "malformed_credential"}
	}

	pending, err := a.store.Credential(parsed.ID)
	if err != nil {
		return Outcome{Status: invalidCredential, Reason: "unknown_credential"}
	}
	if pending.State != CredentialPending || pending.Username != req.Username {
		return Outcome{Status: invalidCredential, Reason: "not_pending"}
	}

	verifier, err := CredentialVerifier(a.deviceKey, parsed.Secret)
	if err != nil {
		return Unavailable("state_unavailable")
	}
	if !VerifierMatches(pending.Verifier, verifier) {
		a.log.Warn("the pasted credential did not match the enrollment", "request_id", req.RequestID)
		return Outcome{Status: invalidCredential, Reason: "verifier_mismatch"}
	}

	// Possession is proved. Now confirm the cloud actually approved it, and on
	// what terms -- approval and possession are separate proofs by design.
	state, err := a.cloud.PollEnrollment(ctx, enrollment.ID)
	if err != nil {
		_ = conv.Warn(persistentUnavailableText)
		return Unavailable("cloud_unavailable")
	}
	if !state.Approved() || state.UserID == nil {
		a.log.Info("enrollment was not approved", "request_id", req.RequestID, "status", state.Status)
		_ = conv.Warn("That credential was not approved.")
		return Deny("authorization_denied")
	}
	if *state.UserID != pending.UserID {
		a.log.Warn("enrollment approved by a different user", "request_id", req.RequestID)
		return Deny("identity_mismatch")
	}

	// The clock starts now, at activation -- not when the browser approved it.
	hours := pending.DurationSec / int(time.Hour/time.Second)
	if state.ApprovedDurationHours != nil {
		hours = *state.ApprovedDurationHours
	}
	activated, err := a.store.ActivateCredential(pending.ID, a.clock(), time.Duration(hours)*time.Hour)
	if err != nil {
		a.log.Error("could not activate the credential", "request_id", req.RequestID, "error", err)
		return Unavailable("state_unavailable")
	}

	decision, err := a.cloud.AuthorizeUser(ctx, activated.UserID)
	if err != nil {
		_ = conv.Warn(persistentUnavailableText)
		return Unavailable("cloud_unavailable")
	}

	a.log.Info("persistent credential activated", "request_id", req.RequestID,
		"username", req.Username, "credential_id", activated.ID, "hours", hours)
	return a.admit(req, decision, conv)
}

// admit applies the same identity and authorization checks every method ends on.
func (a *persistentAuthenticator) admit(req Request, decision *Decision, conv Conversation) Outcome {
	if decision.Username == nil || decision.LinuxUID == nil || decision.UserID == nil {
		return Deny("identity_unknown")
	}
	if *decision.Username != req.Username || *decision.LinuxUID != req.UID {
		a.log.Warn("cloud identity disagrees with the session", "request_id", req.RequestID)
		return Deny("identity_mismatch")
	}
	if !decision.Allowed || !decision.HasScope(DeviceLoginScope) {
		a.log.Info("persistent login denied by current authorization",
			"request_id", req.RequestID, "username", req.Username)
		_ = conv.Warn("You are not authorized to log in to this device.")
		return Deny("authorization_denied")
	}

	if err := a.store.PutCachedUser(CachedUser{
		UserID: *decision.UserID, Username: *decision.Username, LinuxUID: *decision.LinuxUID,
		Scopes: decision.Scopes, PolicyVersion: decision.PolicyVersion, RefreshedAt: a.clock(),
	}); err != nil {
		a.log.Warn("could not cache the authorization", "request_id", req.RequestID, "error", err)
	}

	a.log.Info("persistent authentication approved", "request_id", req.RequestID,
		"username", req.Username, "policy_version", decision.PolicyVersion)
	return Approve()
}

// askDuration reads how long the credential should live.
func (a *persistentAuthenticator) askDuration(conv Conversation) (int, Outcome, bool) {
	minHours, maxHours := a.durationBounds()

	answer, err := conv.Prompt("persistent_duration",
		fmt.Sprintf("Credential duration in hours (%d-%d): ", minHours, maxHours))
	if err != nil {
		return 0, Deny("conversation_failed"), false
	}

	hours, err := strconv.Atoi(strings.TrimSpace(answer))
	if err != nil || hours < minHours || hours > maxHours {
		_ = conv.Warn(fmt.Sprintf("Enter a whole number of hours between %d and %d.", minHours, maxHours))
		return 0, Deny("invalid_duration"), false
	}
	return hours, Outcome{}, true
}

func (a *persistentAuthenticator) durationBounds() (int, int) {
	minHours, maxHours := a.minDurationHours, a.maxDurationHours
	if minHours <= 0 {
		minHours = defaultMinDurationHours
	}
	if maxHours <= 0 {
		maxHours = defaultMaxDurationHours
	}
	return minHours, maxHours
}

func (a *persistentAuthenticator) timeout() time.Duration {
	if a.enrollTimeout > 0 {
		return a.enrollTimeout
	}
	return 5 * time.Minute
}

func (a *persistentAuthenticator) existingCredentialPrompt(cred *StoredCredential) string {
	remaining := "unknown"
	if cred.ExpiresAt != nil {
		remaining = humanDuration(cred.ExpiresAt.Sub(a.clock()))
	}
	return fmt.Sprintf(
		"Persistent credential active\n\nExpires in: %s\n\nAction [use/rotate/back]: ", remaining)
}

func (a *persistentAuthenticator) activationPrompt(enrollment *EnrollmentState, hours int) string {
	return fmt.Sprintf(
		"Persistent credential enrollment\n\nOpen: %s\nCode: %s\nDuration: %d hours\n\n"+
			"Approve it, then paste the credential here to activate it: ",
		enrollment.VerificationURI, enrollment.UserCode, hours)
}

// humanDuration renders a remaining lifetime the way a person reads a clock.
func humanDuration(d time.Duration) string {
	if d <= 0 {
		return "0m"
	}
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60
	if hours >= hoursPerDay {
		return fmt.Sprintf("%dd %dh", hours/hoursPerDay, hours%hoursPerDay)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}
