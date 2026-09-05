// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// defaultPollInterval is used when the cloud does not state one.
const defaultPollInterval = 5 * time.Second

// onlineAuthenticator implements Method 1: the user signs in through a browser
// on some other machine, and the device learns who they are from the cloud.
//
// The device never asserts an identity here. It holds a transaction, and the
// cloud says who approved it, which is what makes approving somebody else's code
// useless for logging in as them.
type onlineAuthenticator struct {
	cloud Cloud
	store *Store
	log   *slog.Logger
	// browserTimeout bounds the whole transaction, so an abandoned login does not
	// hold an sshd session open until the login grace period expires.
	browserTimeout time.Duration
	// pollInterval is used when the cloud states none of its own.
	pollInterval time.Duration
}

func (a *onlineAuthenticator) Authenticate(ctx context.Context, req Request, conv Conversation) Outcome {
	ctx, cancel := context.WithTimeout(ctx, a.browserTimeout)
	defer cancel()

	transaction, err := a.cloud.StartDeviceAuth(ctx)
	if err != nil {
		a.log.Warn("could not start browser authentication", "request_id", req.RequestID, "error", err)
		return Unavailable("cloud_unavailable")
	}

	// The prompt carries the instructions rather than a separate display frame:
	// OpenSSH will not deliver a PAM round that has no prompt in it, and waiting
	// for the user here means the poll starts once they have actually gone.
	if _, promptErr := conv.Prompt("online_browser", browserInstructions(transaction)); promptErr != nil {
		a.log.Warn("conversation failed", "request_id", req.RequestID, "error", promptErr)
		return Deny("conversation_failed")
	}

	sessionToken, outcome := a.waitForApproval(ctx, req, transaction)
	if sessionToken == "" {
		return outcome
	}

	decision, err := a.cloud.AuthorizeSession(ctx, sessionToken)
	if err != nil {
		a.log.Warn("could not authorize session", "request_id", req.RequestID, "error", err)
		return Unavailable("cloud_unavailable")
	}

	return a.admit(req, decision, conv)
}

// waitForApproval polls until the transaction resolves. It returns a session
// token, or the outcome that ends the attempt.
func (a *onlineAuthenticator) waitForApproval(
	ctx context.Context,
	req Request,
	transaction *DeviceAuthRequest,
) (string, Outcome) {
	interval := transaction.Interval
	if interval <= 0 {
		interval = a.pollInterval
	}
	if interval <= 0 {
		interval = defaultPollInterval
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// The user has just told us they approved it, so ask once before waiting.
	for first := true; ; first = false {
		if !first {
			select {
			case <-ctx.Done():
				// Either the user gave up and sshd dropped the connection, or the
				// transaction outlived its window. Both end the attempt here rather
				// than leaving a goroutine polling a dead login.
				a.log.Info("browser authentication abandoned", "request_id", req.RequestID)
				return "", Deny("timeout")
			case <-ticker.C:
			}
		}

		result, err := a.cloud.PollDeviceAuth(ctx, transaction.DeviceCode)
		if err != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(ctx.Err(), context.Canceled) {
				return "", Deny("timeout")
			}
			a.log.Warn("polling failed", "request_id", req.RequestID, "error", err)
			return "", Unavailable("cloud_unavailable")
		}

		switch result.State {
		case DeviceAuthPending:
			continue
		case DeviceAuthApproved:
			return result.SessionToken, Outcome{}
		case DeviceAuthDenied:
			return "", Deny("authorization_denied")
		case DeviceAuthExpired:
			return "", Expired("code_expired")
		default:
			return "", Deny("unknown_state")
		}
	}
}

// admit applies the checks that stand between a successful sign-in and a shell.
func (a *onlineAuthenticator) admit(req Request, decision *Decision, conv Conversation) Outcome {
	if decision.Username == nil || decision.LinuxUID == nil || decision.UserID == nil {
		a.log.Warn("cloud returned an incomplete identity", "request_id", req.RequestID)
		return Deny("identity_unknown")
	}

	// Whoever signed in must be the account this session asked for. Without this,
	// approving from any Helix account would log you in as the requested user.
	if *decision.Username != req.Username {
		a.log.Warn("username mismatch", "request_id", req.RequestID,
			"requested", req.Username, "authenticated", *decision.Username)
		_ = conv.Warn(fmt.Sprintf("Signed in as %s, but this session is for %s.",
			*decision.Username, req.Username))
		return Deny("identity_mismatch")
	}

	// And the cloud's idea of their uid must be the one NSS resolved, or the
	// session would run as a different Unix user than the one authorized.
	if *decision.LinuxUID != req.UID {
		a.log.Warn("uid mismatch", "request_id", req.RequestID,
			"nss_uid", req.UID, "cloud_uid", *decision.LinuxUID)
		return Deny("identity_mismatch")
	}

	if !decision.Allowed || !decision.HasScope(DeviceLoginScope) {
		a.log.Info("authorization denied", "request_id", req.RequestID, "username", req.Username)
		_ = conv.Warn("You are not authorized to log in to this device.")
		return Deny("authorization_denied")
	}

	// Only a cloud-confirmed success updates the cache, which is what stops an
	// unknown user bootstrapping themselves into offline access later.
	cached := CachedUser{
		UserID:        *decision.UserID,
		Username:      *decision.Username,
		LinuxUID:      *decision.LinuxUID,
		Scopes:        decision.Scopes,
		PolicyVersion: decision.PolicyVersion,
		RefreshedAt:   time.Now().UTC(),
	}
	if err := a.store.PutCachedUser(cached); err != nil {
		// The login itself was legitimate; failing to remember it only costs the
		// user offline access later, so it is logged rather than fatal.
		a.log.Warn("could not cache the authorization", "request_id", req.RequestID, "error", err)
	}

	a.log.Info("online authentication approved", "request_id", req.RequestID,
		"username", req.Username, "uid", req.UID, "policy_version", decision.PolicyVersion)
	return Approve()
}

// browserInstructions is what a stock OpenSSH client shows the user.
func browserInstructions(transaction *DeviceAuthRequest) string {
	uri := transaction.VerificationURI
	if transaction.VerificationURIComplete != "" {
		uri = transaction.VerificationURIComplete
	}
	return fmt.Sprintf(
		"Helix online authentication\n\nOpen: %s\nCode: %s\n\nPress Enter once you have approved it: ",
		uri, transaction.UserCode)
}
