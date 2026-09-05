// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DeviceLoginScope is the scope without which no interactive login is allowed.
const DeviceLoginScope = "device.login"

// maxCloudResponseBytes bounds how much of a reply is read.
const maxCloudResponseBytes = 1 << 20

// Cloud is everything helix-authd needs from the Helix control plane.
//
// The cloud stays the only authority on whether a login is currently allowed:
// possession of any credential is authentication, never permission.
type Cloud interface {
	// StartDeviceAuth opens a browser sign-in transaction.
	StartDeviceAuth(ctx context.Context) (*DeviceAuthRequest, error)
	// PollDeviceAuth reports the state of one transaction.
	PollDeviceAuth(ctx context.Context, deviceCode string) (*DeviceAuthResult, error)
	// AuthorizeSession asks who a browser sign-in belongs to and what they may do.
	AuthorizeSession(ctx context.Context, sessionToken string) (*Decision, error)
	// AuthorizeUser asks whether an already-identified user may still log in.
	AuthorizeUser(ctx context.Context, userID string) (*Decision, error)
}

// DeviceAuthRequest is a pending browser sign-in.
type DeviceAuthRequest struct {
	DeviceCode              string
	UserCode                string
	VerificationURI         string
	VerificationURIComplete string
	ExpiresIn               time.Duration
	Interval                time.Duration
}

// DeviceAuthState is where a transaction has got to.
type DeviceAuthState string

const (
	DeviceAuthPending  DeviceAuthState = "pending"
	DeviceAuthApproved DeviceAuthState = "approved"
	DeviceAuthDenied   DeviceAuthState = "denied"
	DeviceAuthExpired  DeviceAuthState = "expired"
)

// DeviceAuthResult is one poll of a transaction.
type DeviceAuthResult struct {
	State DeviceAuthState
	// SessionToken is set only once State is approved.
	SessionToken string
}

// Decision is the cloud's answer about one user on this device.
type Decision struct {
	Allowed       bool     `json:"allowed"`
	LinuxUID      *uint32  `json:"linuxUid"`
	PolicyVersion int      `json:"policyVersion"`
	Scopes        []string `json:"scopes"`
	Username      *string  `json:"username"`
	UserID        *string  `json:"userId"`
}

// HasScope reports whether the decision carries a scope.
func (d *Decision) HasScope(scope string) bool {
	for _, held := range d.Scopes {
		if held == scope {
			return true
		}
	}
	return false
}

// ErrCloudUnavailable means the control plane could not be reached or answered
// unusably. It is distinct from a denial: the device must not treat "cannot ask"
// as "allowed", nor as a permanent refusal.
var ErrCloudUnavailable = errors.New("cloud unavailable")

// CloudConfig points the client at the two surfaces it uses.
type CloudConfig struct {
	// AuthBaseURL serves Better Auth, i.e. the browser sign-in endpoints.
	AuthBaseURL string
	// GatewayBaseURL serves the device-facing API.
	GatewayBaseURL string
	// DeviceID identifies this device to the gateway.
	DeviceID string
	// AccessToken is the device's own credential, sent as a bearer token exactly
	// as certificate enrollment does.
	AccessToken string
	// ClientID names this client in the device-authorization request.
	ClientID string
	// Timeout bounds a single HTTP call, not the whole browser transaction.
	Timeout time.Duration
}

type httpCloud struct {
	cfg CloudConfig
	hc  *http.Client
}

// NewCloud builds the HTTP client for the Helix control plane.
func NewCloud(cfg CloudConfig) Cloud {
	if cfg.ClientID == "" {
		cfg.ClientID = ServiceName
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &httpCloud{cfg: cfg, hc: &http.Client{Timeout: cfg.Timeout}}
}

// deviceCodeResponse mirrors the RFC 8628 body Better Auth returns.
type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
	Error                   string `json:"error"`
	ErrorDescription        string `json:"error_description"`
}

type tokenResponse struct {
	AccessToken      string `json:"access_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func (c *httpCloud) StartDeviceAuth(ctx context.Context) (*DeviceAuthRequest, error) {
	var out deviceCodeResponse
	_, err := c.postJSON(ctx, c.authURL("/api/auth/device/code"), "", map[string]string{
		"client_id": c.cfg.ClientID,
	}, &out)
	if err != nil {
		return nil, err
	}
	if out.Error != "" || out.DeviceCode == "" || out.UserCode == "" {
		return nil, fmt.Errorf("%w: device authorization refused: %s", ErrCloudUnavailable, out.Error)
	}

	return &DeviceAuthRequest{
		DeviceCode:              out.DeviceCode,
		UserCode:                out.UserCode,
		VerificationURI:         out.VerificationURI,
		VerificationURIComplete: out.VerificationURIComplete,
		ExpiresIn:               time.Duration(out.ExpiresIn) * time.Second,
		Interval:                time.Duration(out.Interval) * time.Second,
	}, nil
}

func (c *httpCloud) PollDeviceAuth(ctx context.Context, deviceCode string) (*DeviceAuthResult, error) {
	var out tokenResponse
	_, err := c.postJSON(ctx, c.authURL("/api/auth/device/token"), "", map[string]string{
		"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
		"device_code": deviceCode,
		"client_id":   c.cfg.ClientID,
	}, &out)
	if err != nil {
		return nil, err
	}

	// A pending or refused transaction is reported in the body with a non-2xx
	// status, so the error field is the answer rather than a transport failure.
	switch out.Error {
	case "":
		if out.AccessToken == "" {
			return nil, fmt.Errorf("%w: approved with no token", ErrCloudUnavailable)
		}
		return &DeviceAuthResult{State: DeviceAuthApproved, SessionToken: out.AccessToken}, nil
	case "authorization_pending", "slow_down":
		return &DeviceAuthResult{State: DeviceAuthPending}, nil
	case "access_denied":
		return &DeviceAuthResult{State: DeviceAuthDenied}, nil
	case "expired_token":
		return &DeviceAuthResult{State: DeviceAuthExpired}, nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrCloudUnavailable, out.Error)
	}
}

func (c *httpCloud) AuthorizeSession(ctx context.Context, sessionToken string) (*Decision, error) {
	return c.authorize(ctx, "/api/device-auth/authorize-session",
		map[string]string{"deviceId": c.cfg.DeviceID, "sessionToken": sessionToken})
}

func (c *httpCloud) AuthorizeUser(ctx context.Context, userID string) (*Decision, error) {
	return c.authorize(ctx, "/api/device-auth/authorize",
		map[string]string{"deviceId": c.cfg.DeviceID, "userId": userID})
}

// authorize calls the device-facing API and insists on a clean 200. Anything else
// -- a rejected device token, a gateway error -- is unavailability, not a denial:
// a zero-valued Decision would otherwise read as a legitimate refusal.
func (c *httpCloud) authorize(ctx context.Context, path string, body map[string]string) (*Decision, error) {
	var out Decision
	status, err := c.postJSON(ctx, c.gatewayURL(path), c.cfg.AccessToken, body, &out)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%w: authorization endpoint returned %d", ErrCloudUnavailable, status)
	}
	return &out, nil
}

func (c *httpCloud) authURL(path string) string {
	return strings.TrimRight(c.cfg.AuthBaseURL, "/") + path
}

func (c *httpCloud) gatewayURL(path string) string {
	return strings.TrimRight(c.cfg.GatewayBaseURL, "/") + path
}

// postJSON sends a JSON body and decodes a JSON reply. Every transport failure
// becomes ErrCloudUnavailable so callers cannot mistake one for a denial.
func (c *httpCloud) postJSON(ctx context.Context, url, bearer string, body any, out any) (int, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, fmt.Errorf("encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(encoded))
	if err != nil {
		return 0, fmt.Errorf("%w: %s", ErrCloudUnavailable, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, fmt.Errorf("%w: %s", ErrCloudUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Bounded read: a control plane answering with something enormous is a fault,
	// not a reason to allocate.
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxCloudResponseBytes))
	if err != nil {
		return resp.StatusCode, fmt.Errorf("%w: %s", ErrCloudUnavailable, err)
	}

	if err := json.Unmarshal(payload, out); err != nil {
		return resp.StatusCode, fmt.Errorf("%w: %s returned %s with an unreadable body",
			ErrCloudUnavailable, url, resp.Status)
	}
	return resp.StatusCode, nil
}
