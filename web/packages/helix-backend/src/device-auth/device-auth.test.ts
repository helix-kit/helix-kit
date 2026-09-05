import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { FixtureAuthorization, parseFixture } from './fixture-provider';
import { deviceAuthApiRouter } from './router';
import { DEVICE_LOGIN_SCOPE } from './types';

import type { DatabaseClient } from '../db';

import { createRootRouter } from '../trpc';

const DEVICE_ID = 'D123';
const DEVICE_TOKEN = 'device-access-token';
const ALICE = 'user_alice';
const BOB = 'user_bob';
const APP_SCOPE = 'app.foo.read';
const SESSION_TOKEN = 'session-token';

const fixture = () =>
  new FixtureAuthorization({
    identities: {
      [ALICE]: { username: 'alice', linuxUid: 200001 },
      [BOB]: { username: 'bob', linuxUid: 200002 },
    },
    grants: [
      { userId: ALICE, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE, APP_SCOPE] },
      { userId: BOB, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE] },
    ],
  });

describe('FixtureAuthorization', () => {
  let auth: FixtureAuthorization;

  beforeEach(() => {
    auth = fixture();
  });

  it('resolves the Unix identity a Helix user maps to', async () => {
    await expect(auth.lookup(ALICE)).resolves.toEqual({ username: 'alice', linuxUid: 200001 });
    await expect(auth.lookup('user_nobody')).resolves.toBeNull();
  });

  it('allows a user holding the login scope', async () => {
    const result = await auth.authorize(DEVICE_ID, ALICE);
    expect(result.allowed).toBe(true);
    expect(result.scopes).toContain(APP_SCOPE);
    expect(result.policyVersion).toBe(1);
  });

  it('denies a user with no grant on the device', async () => {
    await expect(auth.authorize('D999', ALICE)).resolves.toMatchObject({ allowed: false });
    await expect(auth.authorize(DEVICE_ID, 'user_nobody')).resolves.toMatchObject({
      allowed: false,
    });
  });

  // Withdrawing login must not require deleting everything else the user may do.
  it('denies login once the login scope is revoked, keeping other scopes', async () => {
    auth.revokeLogin(DEVICE_ID, ALICE);

    const result = await auth.authorize(DEVICE_ID, ALICE);
    expect(result.allowed).toBe(false);
    expect(result.scopes).toEqual([APP_SCOPE]);
  });

  it('denies everything once the grant is removed', async () => {
    auth.revokeAll(DEVICE_ID, ALICE);

    const result = await auth.authorize(DEVICE_ID, ALICE);
    expect(result.allowed).toBe(false);
    expect(result.scopes).toEqual([]);
  });

  // Devices cache scopes, so every change has to be detectable.
  it('bumps the policy version on every mutation', async () => {
    const seen = [auth.policyVersion];

    auth.setScopes(DEVICE_ID, ALICE, [DEVICE_LOGIN_SCOPE]);
    seen.push(auth.policyVersion);

    auth.revokeLogin(DEVICE_ID, ALICE);
    seen.push(auth.policyVersion);

    auth.revokeAll(DEVICE_ID, BOB);
    seen.push(auth.policyVersion);

    const strictlyIncreasing = seen.every((version, i) => {
      const previous = seen[i - 1];
      return previous === undefined || version > previous;
    });
    expect(strictlyIncreasing).toBe(true);

    await expect(auth.authorize(DEVICE_ID, ALICE)).resolves.toMatchObject({
      policyVersion: auth.policyVersion,
    });
  });

  it('does not let a caller mutate its scopes through the returned array', async () => {
    const before = await auth.authorize(DEVICE_ID, ALICE);
    (before.scopes as string[]).push('app.evil.write');

    await expect(auth.authorize(DEVICE_ID, ALICE)).resolves.toMatchObject({
      scopes: [DEVICE_LOGIN_SCOPE, APP_SCOPE],
    });
  });
});

describe('parseFixture', () => {
  it('reads a well-formed fixture', () => {
    const parsed = parseFixture(
      JSON.stringify({
        identities: { [ALICE]: { username: 'alice', linuxUid: 200001 } },
        grants: [{ userId: ALICE, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE] }],
      }),
    );
    expect(parsed.grants).toHaveLength(1);
  });

  // Silently accepting junk would look like a working system that denies everyone.
  it('throws rather than yielding an empty fixture', () => {
    expect(() => parseFixture('null')).toThrow(TypeError);
    expect(() => parseFixture('{"grants":[]}')).toThrow(TypeError);
    expect(() => parseFixture('{"identities":{}}')).toThrow(TypeError);
    expect(() => parseFixture('not json')).toThrow();
  });
});

/**
 * A database stub that serves one result set per query, in order. The router
 * makes the device-token lookup first, then any lookup the procedure itself
 * needs, so the queue mirrors what really happens.
 */
const dbServing = (resultSets: readonly (readonly unknown[])[]): DatabaseClient => {
  const queue = [...resultSets];
  const limit = () => Promise.resolve(queue.shift() ?? []);
  const where = () => ({ limit });
  const from = () => ({ where });
  return { select: () => ({ from }) } as unknown as DatabaseClient;
};

const callerWith = ({
  auth,
  headers,
  results = [[{ id: DEVICE_ID }]],
}: {
  auth: FixtureAuthorization;
  headers: Headers;
  results?: readonly (readonly unknown[])[];
}) => {
  const { router } = createRootRouter({ deviceAuth: deviceAuthApiRouter });
  return router.createCaller({
    db: dbServing(results),
    headers,
    authorization: auth,
    directory: auth,
  });
};

/** The device token check passes, then the named session rows are returned. */
const withSession = (sessionRows: readonly unknown[]) => [[{ id: DEVICE_ID }], sessionRows];

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

describe('deviceAuthApiRouter.authorizeLogin', () => {
  let auth: FixtureAuthorization;

  beforeEach(() => {
    auth = fixture();
  });

  it('returns the identity and scopes for an authorized user', async () => {
    const caller = callerWith({ auth, headers: bearer(DEVICE_TOKEN) });

    await expect(
      caller.deviceAuth.authorizeLogin({ deviceId: DEVICE_ID, userId: ALICE }),
    ).resolves.toEqual({
      allowed: true,
      linuxUid: 200001,
      policyVersion: 1,
      scopes: [DEVICE_LOGIN_SCOPE, APP_SCOPE],
      username: 'alice',
      userId: ALICE,
    });
  });

  it('reports the current denial rather than failing', async () => {
    auth.revokeLogin(DEVICE_ID, ALICE);
    const caller = callerWith({ auth, headers: bearer(DEVICE_TOKEN) });

    const result = await caller.deviceAuth.authorizeLogin({ deviceId: DEVICE_ID, userId: ALICE });
    expect(result.allowed).toBe(false);
    expect(result.username).toBe('alice');
  });

  // Scopes without a Unix identity would authorize a login as nobody.
  it('denies a user with no Unix identity even when scopes allow it', async () => {
    auth.setScopes(DEVICE_ID, 'user_ghost', [DEVICE_LOGIN_SCOPE]);
    const caller = callerWith({ auth, headers: bearer(DEVICE_TOKEN) });

    const result = await caller.deviceAuth.authorizeLogin({
      deviceId: DEVICE_ID,
      userId: 'user_ghost',
    });
    expect(result).toMatchObject({ allowed: false, username: null, linuxUid: null });
  });

  it('refuses a request with no bearer token', async () => {
    const caller = callerWith({ auth, headers: new Headers() });

    await expect(
      caller.deviceAuth.authorizeLogin({ deviceId: DEVICE_ID, userId: ALICE }),
    ).rejects.toThrow(TRPCError);
  });

  it('refuses a token that matches no active device', async () => {
    const caller = callerWith({ auth, headers: bearer('wrong-token'), results: [[]] });

    await expect(
      caller.deviceAuth.authorizeLogin({ deviceId: DEVICE_ID, userId: ALICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // The device authenticates as itself; it cannot ask about another device.
  it('checks the token against the device named in the request', async () => {
    const caller = callerWith({ auth, headers: bearer(DEVICE_TOKEN), results: [[]] });

    await expect(
      caller.deviceAuth.authorizeLogin({ deviceId: 'D999', userId: ALICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('deviceAuthApiRouter.authorizeSession', () => {
  let auth: FixtureAuthorization;

  beforeEach(() => {
    auth = fixture();
  });

  // The device holds a session token and no opinion about whose it is.
  it('resolves the session to its user and authorizes them', async () => {
    const caller = callerWith({
      auth,
      headers: bearer(DEVICE_TOKEN),
      results: withSession([{ userId: ALICE }]),
    });

    await expect(
      caller.deviceAuth.authorizeSession({ deviceId: DEVICE_ID, sessionToken: SESSION_TOKEN }),
    ).resolves.toEqual({
      allowed: true,
      linuxUid: 200001,
      policyVersion: 1,
      scopes: [DEVICE_LOGIN_SCOPE, APP_SCOPE],
      username: 'alice',
      userId: ALICE,
    });
  });

  // An unknown or expired session is nobody, and nobody may log in.
  it('denies an unknown or expired session without naming anyone', async () => {
    const caller = callerWith({
      auth,
      headers: bearer(DEVICE_TOKEN),
      results: withSession([]),
    });

    await expect(
      caller.deviceAuth.authorizeSession({ deviceId: DEVICE_ID, sessionToken: 'stale' }),
    ).resolves.toMatchObject({ allowed: false, userId: null, username: null, scopes: [] });
  });

  it('denies a resolved user whose login scope was withdrawn', async () => {
    auth.revokeLogin(DEVICE_ID, ALICE);
    const caller = callerWith({
      auth,
      headers: bearer(DEVICE_TOKEN),
      results: withSession([{ userId: ALICE }]),
    });

    const result = await caller.deviceAuth.authorizeSession({
      deviceId: DEVICE_ID,
      sessionToken: SESSION_TOKEN,
    });
    expect(result.allowed).toBe(false);
    expect(result.username).toBe('alice');
  });

  it('still requires the device to authenticate as itself', async () => {
    const caller = callerWith({ auth, headers: new Headers(), results: withSession([]) });

    await expect(
      caller.deviceAuth.authorizeSession({ deviceId: DEVICE_ID, sessionToken: SESSION_TOKEN }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
