// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/authproto"
)

var credentialKey = []byte(strings.Repeat("c", 32))

// scriptedCloud stands in for the control plane, recording what it was asked.
type scriptedCloud struct {
	decision *Decision
	authErr  error

	enrollment    *EnrollmentState
	enrollErr     error
	pollState     *EnrollmentState
	pollErr       error
	relayed       string
	authorizeeIDs []string
}

func (c *scriptedCloud) StartDeviceAuth(context.Context) (*DeviceAuthRequest, error) {
	return nil, errors.New("not used")
}

func (c *scriptedCloud) PollDeviceAuth(context.Context, string) (*DeviceAuthResult, error) {
	return nil, errors.New("not used")
}

func (c *scriptedCloud) AuthorizeSession(context.Context, string) (*Decision, error) {
	return nil, errors.New("not used")
}

func (c *scriptedCloud) AuthorizeUser(_ context.Context, userID string) (*Decision, error) {
	c.authorizeeIDs = append(c.authorizeeIDs, userID)
	if c.authErr != nil {
		return nil, c.authErr
	}
	return c.decision, nil
}

func (c *scriptedCloud) CreateEnrollment(_ context.Context, req EnrollmentRequest) (*EnrollmentState, error) {
	c.relayed = req.Credential
	if c.enrollErr != nil {
		return nil, c.enrollErr
	}
	return c.enrollment, nil
}

func (c *scriptedCloud) PollEnrollment(context.Context, string) (*EnrollmentState, error) {
	if c.pollErr != nil {
		return nil, c.pollErr
	}
	return c.pollState, nil
}

func allowedDecision() *Decision {
	username, uid, userID := "alice", uint32(200001), testUserID
	return &Decision{
		Allowed: true, LinuxUID: &uid, PolicyVersion: 7,
		Scopes: []string{DeviceLoginScope, "app.foo.read"}, Username: &username, UserID: &userID,
	}
}

func approvedEnrollment() (*EnrollmentState, *EnrollmentState) {
	userID := testUserID
	hours := 24
	created := &EnrollmentState{
		ID: "enr-1", UserCode: "ABCD2345", Status: "pending",
		VerificationURI: "https://helix-kit.com/device/enroll",
	}
	approved := &EnrollmentState{
		ID: "enr-1", UserCode: "ABCD2345", Status: "approved",
		UserID: &userID, ApprovedDurationHours: &hours,
	}
	return created, approved
}

func persistentFor(t *testing.T, cloud *scriptedCloud) (*persistentAuthenticator, *Store) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	// Enrollment needs a platform identity, which only an online login supplies.
	if err := store.PutCachedUser(cachedAlice()); err != nil {
		t.Fatalf("PutCachedUser: %v", err)
	}

	return &persistentAuthenticator{
		cloud: cloud, store: store, log: discardLog(),
		deviceKey: credentialKey, enrollTimeout: 30 * time.Second,
	}, store
}

// enrolAlice runs a full enrollment and returns the credential she now holds.
func enrolAlice(t *testing.T, auth *persistentAuthenticator, cloud *scriptedCloud) string {
	t.Helper()
	created, approved := approvedEnrollment()
	cloud.enrollment, cloud.pollState = created, approved
	cloud.decision = allowedDecision()

	// The credential is only knowable by intercepting what the device relays, the
	// same way the browser learns it.
	conv := &replayConversation{answers: []string{"24", ""}, cloud: cloud}
	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)
	if outcome.Status != authproto.StatusApproved {
		t.Fatalf("enrollment failed: %q %q", outcome.Status, outcome.Reason)
	}
	return cloud.relayed
}

// replayConversation answers the activation prompt with whatever the device
// relayed to the cloud, which is what the user would paste back.
type replayConversation struct {
	answers []string
	cloud   *scriptedCloud
	prompts []string
	warns   []string
}

func (c *replayConversation) Display(string) error { return nil }
func (c *replayConversation) Warn(text string) error {
	c.warns = append(c.warns, text)
	return nil
}

func (c *replayConversation) Prompt(id, text string) (string, error) {
	c.prompts = append(c.prompts, text)
	index := len(c.prompts) - 1
	if index < len(c.answers) && c.answers[index] != "" {
		return c.answers[index], nil
	}
	if id == "persistent_activation" {
		return c.cloud.relayed, nil
	}
	return "", nil
}

func (c *replayConversation) PromptSecret(id, text string) (string, error) {
	return c.Prompt(id, text)
}

// fixedConversation answers each prompt from a fixed script.
type fixedConversation struct {
	answers []string
	prompts []string
	warns   []string
}

func (c *fixedConversation) Display(string) error { return nil }
func (c *fixedConversation) Warn(text string) error {
	c.warns = append(c.warns, text)
	return nil
}

func (c *fixedConversation) Prompt(_, text string) (string, error) {
	c.prompts = append(c.prompts, text)
	if len(c.prompts) > len(c.answers) {
		return "", nil
	}
	return c.answers[len(c.prompts)-1], nil
}

func (c *fixedConversation) PromptSecret(id, text string) (string, error) {
	return c.Prompt(id, text)
}

func TestPersistentEnrollmentActivatesOnPasteBack(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, store := persistentFor(t, cloud)

	credential := enrolAlice(t, auth, cloud)

	parsed, err := ParseCredential(credential)
	if err != nil {
		t.Fatalf("the device relayed something unparseable: %v", err)
	}
	stored, err := store.Credential(parsed.ID)
	if err != nil {
		t.Fatalf("Credential: %v", err)
	}
	if stored.State != CredentialActive {
		t.Fatalf("state = %q, want ACTIVE", stored.State)
	}

	// The lifetime starts at activation, not at approval.
	if stored.ActivatedAt == nil || stored.ExpiresAt == nil {
		t.Fatal("an activated credential has no lifetime")
	}
	if got := stored.ExpiresAt.Sub(*stored.ActivatedAt); got != 24*time.Hour {
		t.Errorf("lifetime = %s, want 24h", got)
	}

	// The device keeps a verifier, never the secret.
	if strings.Contains(stored.Verifier, string(parsed.Secret)) {
		t.Error("the stored verifier contains the secret")
	}
}

// Cloud approval alone is not enough; the paste is the second proof.
func TestPersistentEnrollmentNeedsTheRightPaste(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, store := persistentFor(t, cloud)
	created, approved := approvedEnrollment()
	cloud.enrollment, cloud.pollState, cloud.decision = created, approved, allowedDecision()

	// A different, well-formed credential: right shape, wrong secret.
	other, err := NewPersistentCredential(nil)
	if err != nil {
		t.Fatalf("NewPersistentCredential: %v", err)
	}
	conv := &fixedConversation{answers: []string{"24", other.String()}}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusInvalidCredential {
		t.Fatalf("status = %q reason = %q, want invalid_credential", outcome.Status, outcome.Reason)
	}
	// The enrollment stays pending, so nothing usable was left behind.
	relayed, err := ParseCredential(cloud.relayed)
	if err != nil {
		t.Fatalf("parse relayed: %v", err)
	}
	stored, err := store.Credential(relayed.ID)
	if err != nil {
		t.Fatalf("Credential: %v", err)
	}
	if stored.State != CredentialPending {
		t.Fatalf("state = %q, want it to remain PENDING", stored.State)
	}
}

func TestPersistentEnrollmentNeedsCloudApproval(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	created, _ := approvedEnrollment()
	cloud.enrollment = created
	cloud.pollState = &EnrollmentState{ID: "enr-1", Status: "denied"}
	cloud.decision = allowedDecision()

	outcome := auth.Authenticate(context.Background(), aliceRequest(),
		&replayConversation{answers: []string{"24", ""}, cloud: cloud})

	if outcome.Status != authproto.StatusDenied || outcome.Reason != "authorization_denied" {
		t.Fatalf("status = %q reason = %q, want denied/authorization_denied", outcome.Status, outcome.Reason)
	}
}

func TestPersistentLoginNeedsNoBrowser(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)

	// A second login: choose "use", paste the credential.
	conv := &fixedConversation{answers: []string{"use", credential}}
	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusApproved {
		t.Fatalf("status = %q reason = %q, want approved", outcome.Status, outcome.Reason)
	}
	// Nothing in that flow mentioned a browser.
	for _, prompt := range conv.prompts {
		if strings.Contains(prompt, "http") {
			t.Errorf("a later login sent the user to a browser: %s", prompt)
		}
	}
}

// Possession is authentication; it is never authorization. The cloud is asked
// every single time.
func TestPersistentLoginAlwaysAsksTheCloud(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)

	before := len(cloud.authorizeeIDs)
	auth.Authenticate(context.Background(), aliceRequest(),
		&fixedConversation{answers: []string{"use", credential}})

	if len(cloud.authorizeeIDs) != before+1 {
		t.Fatalf("the cloud was consulted %d times, want one more", len(cloud.authorizeeIDs)-before)
	}
}

func TestPersistentLoginLosesToACurrentDenial(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)

	// Access is withdrawn after the credential was issued.
	denied := allowedDecision()
	cloud.decision = &Decision{
		Allowed: false, LinuxUID: denied.LinuxUID, PolicyVersion: 8,
		Scopes: []string{}, Username: denied.Username, UserID: denied.UserID,
	}

	outcome := auth.Authenticate(context.Background(), aliceRequest(),
		&fixedConversation{answers: []string{"use", credential}})

	if outcome.Status != authproto.StatusDenied || outcome.Reason != "authorization_denied" {
		t.Fatalf("status = %q reason = %q, want denied/authorization_denied", outcome.Status, outcome.Reason)
	}
}

// An unreachable cloud is not a licence to fall back on what the device already
// knew, nor to quietly switch the user to another method.
func TestPersistentLoginWithNoCloudIsUnavailable(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)

	cloud.authErr = ErrCloudUnavailable
	conv := &fixedConversation{answers: []string{"use", credential}}

	outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

	if outcome.Status != authproto.StatusUnavailable {
		t.Fatalf("status = %q reason = %q, want unavailable", outcome.Status, outcome.Reason)
	}
	if len(conv.warns) == 0 || !strings.Contains(conv.warns[len(conv.warns)-1], "offline") {
		t.Errorf("the user was not pointed at the offline method: %v", conv.warns)
	}
}

func TestPersistentLoginRejectsBadCredentials(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, store := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)
	parsed, err := ParseCredential(credential)
	if err != nil {
		t.Fatalf("ParseCredential: %v", err)
	}

	unknown, err := NewPersistentCredential(nil)
	if err != nil {
		t.Fatalf("NewPersistentCredential: %v", err)
	}

	cases := []struct {
		name       string
		credential string
		arrange    func()
		wantStatus authproto.Status
	}{
		{"malformed", "not-a-credential", nil, authproto.StatusInvalidCredential},
		{"wrong prefix", "hlx9_" + parsed.ID + "_x", nil, authproto.StatusInvalidCredential},
		{"unknown id", unknown.String(), nil, authproto.StatusInvalidCredential},
		{
			name: "revoked", credential: credential,
			arrange:    func() { _ = store.RevokeCredential(parsed.ID) },
			wantStatus: authproto.StatusInvalidCredential,
		},
		{
			name: "expired", credential: credential,
			arrange:    func() { _ = store.ExpireCredential(parsed.ID) },
			wantStatus: authproto.StatusInvalidCredential,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.arrange != nil {
				tc.arrange()
			}
			// A revoked or expired credential is no longer "active", so the flow
			// offers enrollment rather than use; answer the duration prompt with
			// something invalid to stop there and read the login refusal instead.
			conv := &fixedConversation{answers: []string{"use", tc.credential}}
			outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)

			if outcome.Status == authproto.StatusApproved {
				t.Fatalf("%s credential was accepted", tc.name)
			}
		})
	}
}

// A credential belongs to one Unix user on one device.
func TestPersistentCredentialIsBoundToItsUser(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)

	bob := Request{RequestID: "req-2", Username: "bob", UID: 200002, DeviceID: testDeviceID}
	// Bob has no credential, so he is offered enrollment; refuse the duration to
	// reach the point where his own credential would be checked.
	conv := &fixedConversation{answers: []string{"0"}}
	if outcome := auth.Authenticate(context.Background(), bob, conv); outcome.Status == authproto.StatusApproved {
		t.Fatal("bob was approved with no credential of his own")
	}

	// And Alice's credential does not work for him either.
	aliceCred := &fixedConversation{answers: []string{"use", credential}}
	if outcome := auth.Authenticate(context.Background(), bob, aliceCred); outcome.Status == authproto.StatusApproved {
		t.Fatal("alice's credential authenticated bob")
	}
}

// Rotation revokes before the replacement exists, so abandoning it leaves the
// user with nothing rather than with the credential they meant to replace.
func TestPersistentRotationRevokesImmediately(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, store := persistentFor(t, cloud)
	credential := enrolAlice(t, auth, cloud)
	parsed, err := ParseCredential(credential)
	if err != nil {
		t.Fatalf("ParseCredential: %v", err)
	}

	// Choose rotate, then abandon the new enrollment with an invalid duration.
	conv := &fixedConversation{answers: []string{"rotate", "0"}}
	auth.Authenticate(context.Background(), aliceRequest(), conv)

	old, err := store.Credential(parsed.ID)
	if err != nil {
		t.Fatalf("Credential: %v", err)
	}
	if old.State != CredentialRevoked {
		t.Fatalf("state = %q, want REVOKED", old.State)
	}
	if _, err := store.ActiveCredential("alice"); !errors.Is(err, ErrNoCredential) {
		t.Fatal("an abandoned rotation left an active credential behind")
	}
}

func TestPersistentDurationMustBeInRange(t *testing.T) {
	cloud := &scriptedCloud{}
	auth, _ := persistentFor(t, cloud)
	created, approved := approvedEnrollment()
	cloud.enrollment, cloud.pollState, cloud.decision = created, approved, allowedDecision()

	for _, answer := range []string{"0", "-1", "999", "soon", ""} {
		conv := &fixedConversation{answers: []string{answer}}
		outcome := auth.Authenticate(context.Background(), aliceRequest(), conv)
		if outcome.Status != authproto.StatusDenied || outcome.Reason != "invalid_duration" {
			t.Errorf("duration %q gave %q/%q, want denied/invalid_duration",
				answer, outcome.Status, outcome.Reason)
		}
	}
}

func TestPersistentEnrollmentNeedsAKnownPlatformIdentity(t *testing.T) {
	cloud := &scriptedCloud{}
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer func() { _ = store.Close() }()

	// No cached user: the device has never been told who alice is upstream.
	auth := &persistentAuthenticator{
		cloud: cloud, store: store, log: discardLog(),
		deviceKey: credentialKey, enrollTimeout: 30 * time.Second,
	}

	outcome := auth.Authenticate(context.Background(), aliceRequest(),
		&fixedConversation{answers: []string{"24"}})

	if outcome.Status != authproto.StatusDenied || outcome.Reason != "no_cached_user" {
		t.Fatalf("status = %q reason = %q, want denied/no_cached_user", outcome.Status, outcome.Reason)
	}
}

func TestHumanDuration(t *testing.T) {
	cases := map[time.Duration]string{
		0:                             "0m",
		30 * time.Minute:              "30m",
		90 * time.Minute:              "1h 30m",
		(24 + 3) * time.Hour:          "1d 3h",
		-time.Minute:                  "0m",
		17*time.Hour + 42*time.Minute: "17h 42m",
	}
	for in, want := range cases {
		if got := humanDuration(in); got != want {
			t.Errorf("humanDuration(%s) = %q, want %q", in, got, want)
		}
	}
}
