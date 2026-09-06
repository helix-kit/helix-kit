import { beforeEach, describe, expect, it } from 'vitest';

import { AlreadyRevealedError, EnrollmentRelay, type EnrollmentRequest } from './enrollment-relay';

const CREDENTIAL = 'hlx1_D7K4P9QX_1tBc9hWz0jlyHNhQd6X9B3h7IyMdxk9BqCEgTlePgeQ';
const ALICE = 'user_alice';
const USER_CODE_LENGTH = 8;
const DURATION_HOURS = 24;
const TTL_MS = 1000;
const PAST_TTL_MS = 2000;
const BOB = 'user_bob';

const request = (): EnrollmentRequest => ({
  deviceId: 'D123',
  username: 'alice',
  linuxUid: 200001,
  credentialId: 'D7K4P9QX',
  credential: CREDENTIAL,
  durationHours: DURATION_HOURS,
});

describe('EnrollmentRelay', () => {
  let relay: EnrollmentRelay;

  beforeEach(() => {
    relay = new EnrollmentRelay();
  });

  it('takes an enrollment and issues a code to type', () => {
    const created = relay.create(request());

    expect(created.status).toBe('pending');
    expect(created.userCode).toHaveLength(USER_CODE_LENGTH);
    expect(created.userId).toBeNull();
  });

  it('shows the browser what it is about to approve', () => {
    const created = relay.create(request());

    expect(relay.summary(created.userCode)).toEqual({
      deviceId: 'D123',
      username: 'alice',
      durationHours: DURATION_HOURS,
      status: 'pending',
    });
  });

  it('runs the whole approve-then-reveal path', () => {
    const created = relay.create(request());

    const approved = relay.approve(created.userCode, ALICE, DURATION_HOURS);
    expect(approved?.status).toBe('approved');
    expect(approved?.userId).toBe(ALICE);

    expect(relay.reveal(created.userCode, ALICE)).toBe(CREDENTIAL);
    expect(relay.poll(created.id)?.status).toBe('revealed');
  });

  // The single most important property here: a credential that could be read
  // twice is a credential the cloud is storing.
  it('reveals exactly once and destroys its copy', () => {
    const created = relay.create(request());
    relay.approve(created.userCode, ALICE, DURATION_HOURS);

    expect(relay.reveal(created.userCode, ALICE)).toBe(CREDENTIAL);
    expect(() => relay.reveal(created.userCode, ALICE)).toThrow(AlreadyRevealedError);
  });

  it('will not reveal to anyone but the approver', () => {
    const created = relay.create(request());
    relay.approve(created.userCode, ALICE, DURATION_HOURS);

    expect(() => relay.reveal(created.userCode, BOB)).toThrow();
    // And the credential survives that attempt for its rightful owner.
    expect(relay.reveal(created.userCode, ALICE)).toBe(CREDENTIAL);
  });

  it('will not reveal before approval', () => {
    const created = relay.create(request());

    expect(() => relay.reveal(created.userCode, ALICE)).toThrow();
  });

  it('destroys the credential when the user refuses', () => {
    const created = relay.create(request());

    expect(relay.deny(created.userCode)).toBe(true);
    expect(relay.poll(created.id)?.status).toBe('denied');
    expect(() => relay.reveal(created.userCode, ALICE)).toThrow();
  });

  it('cannot be approved twice, or approved after a refusal', () => {
    const created = relay.create(request());

    expect(relay.approve(created.userCode, ALICE, DURATION_HOURS)).not.toBeNull();
    expect(relay.approve(created.userCode, BOB, DURATION_HOURS)).toBeNull();

    const other = relay.create(request());
    relay.deny(other.userCode);
    expect(relay.approve(other.userCode, ALICE, DURATION_HOURS)).toBeNull();
  });

  // An enrollment nobody completed must not sit around waiting to be used.
  it('forgets an abandoned enrollment, plaintext and all', () => {
    let clock = 1_000_000;
    const expiring = new EnrollmentRelay({ ttlMs: TTL_MS, now: () => clock });

    const created = expiring.create(request());
    expect(expiring.poll(created.id)?.status).toBe('pending');

    clock += PAST_TTL_MS;

    expect(expiring.poll(created.id)).toBeNull();
    expect(expiring.summary(created.userCode)).toBeNull();
    expect(() => expiring.reveal(created.userCode, ALICE)).toThrow();
  });

  it('accepts a code typed in any case', () => {
    const created = relay.create(request());

    expect(relay.summary(created.userCode.toLowerCase())).not.toBeNull();
  });

  it('reports nothing for a code it has never seen', () => {
    expect(relay.summary('NOTACODE')).toBeNull();
    expect(relay.poll('nope')).toBeNull();
    expect(relay.approve('NOTACODE', ALICE, DURATION_HOURS)).toBeNull();
    expect(relay.deny('NOTACODE')).toBe(false);
  });

  it('drops an enrollment once the device is done with it', () => {
    const created = relay.create(request());

    relay.discard(created.id);

    expect(relay.poll(created.id)).toBeNull();
    expect(relay.summary(created.userCode)).toBeNull();
  });

  // Nothing the relay hands back may carry the secret except the one reveal.
  it('never exposes the credential through status', () => {
    const created = relay.create(request());
    relay.approve(created.userCode, ALICE, DURATION_HOURS);

    const serialized = JSON.stringify([relay.poll(created.id), relay.summary(created.userCode)]);
    expect(serialized).not.toContain(CREDENTIAL);
    expect(serialized).not.toContain('1tBc9hWz');
  });
});
