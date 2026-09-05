import { beforeEach, describe, expect, it } from 'vitest';

import { FixtureAuthorization } from './fixture-provider';
import { offlineResponse } from './offline-code';
import { offlineAuthRouter } from './offline-router';
import { DEVICE_LOGIN_SCOPE } from './types';

import { createRootRouter } from '../trpc';

const DEVICE_ID = 'D123';
const ALICE = 'user_alice';
const BOB = 'user_bob';
const CHALLENGE = 'K7MPQ29X';
const SECRET_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const fixture = () =>
  new FixtureAuthorization({
    identities: {
      [ALICE]: { username: 'alice', linuxUid: 200001 },
      [BOB]: { username: 'bob', linuxUid: 200002 },
    },
    grants: [
      { userId: ALICE, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE] },
      { userId: BOB, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE] },
    ],
    deviceSecrets: { [DEVICE_ID]: SECRET_HEX },
  });

const callerFor = (auth: FixtureAuthorization, userId: string | null) => {
  const { router } = createRootRouter({ offlineAuth: offlineAuthRouter });
  return router.createCaller({
    user: userId === null ? null : { id: userId },
    authorization: auth,
    directory: auth,
    secrets: auth,
  });
};

describe('offlineAuthRouter.respond', () => {
  let auth: FixtureAuthorization;

  beforeEach(() => {
    auth = fixture();
  });

  it('issues the response the device will accept', async () => {
    const result = await callerFor(auth, ALICE).offlineAuth.respond({
      deviceId: DEVICE_ID,
      challenge: CHALLENGE,
    });

    expect(result.response).toBe(
      offlineResponse(Buffer.from(SECRET_HEX, 'hex'), {
        deviceId: DEVICE_ID,
        userId: ALICE,
        linuxUid: 200001,
        challenge: CHALLENGE,
      }),
    );
  });

  // The request never says who the user is, so submitting a challenge read off
  // somebody else's screen yields a response bound to the submitter instead.
  it('binds the response to the signed-in user, not the challenge', async () => {
    const forAlice = await callerFor(auth, ALICE).offlineAuth.respond({
      deviceId: DEVICE_ID,
      challenge: CHALLENGE,
    });
    const forBob = await callerFor(auth, BOB).offlineAuth.respond({
      deviceId: DEVICE_ID,
      challenge: CHALLENGE,
    });

    expect(forBob.response).not.toBe(forAlice.response);
  });

  it('accepts a challenge typed the way it is displayed', async () => {
    const plain = await callerFor(auth, ALICE).offlineAuth.respond({
      deviceId: DEVICE_ID,
      challenge: CHALLENGE,
    });
    const hyphenated = await callerFor(auth, ALICE).offlineAuth.respond({
      deviceId: DEVICE_ID,
      challenge: 'k7mp-q29x',
    });

    expect(hyphenated.response).toBe(plain.response);
  });

  it('requires a signed-in session', async () => {
    await expect(
      callerFor(auth, null).offlineAuth.respond({ deviceId: DEVICE_ID, challenge: CHALLENGE }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // No response is computed at all for someone who may not log in, so this cannot
  // be used to mint a code now and use it after access is granted.
  it('refuses a user whose login scope was withdrawn', async () => {
    auth.revokeLogin(DEVICE_ID, ALICE);

    await expect(
      callerFor(auth, ALICE).offlineAuth.respond({ deviceId: DEVICE_ID, challenge: CHALLENGE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // The same refusal for every reason, so it cannot be used to discover which
  // devices exist or who can reach them.
  it.each([
    ['a device the user has no grant on', 'D999', ALICE],
    ['a user with no Unix identity', DEVICE_ID, 'user_ghost'],
  ])('refuses %s', async (_name, deviceId, userId) => {
    await expect(
      callerFor(auth, userId).offlineAuth.respond({ deviceId, challenge: CHALLENGE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a device with no offline secret', async () => {
    const noSecret = new FixtureAuthorization({
      identities: { [ALICE]: { username: 'alice', linuxUid: 200001 } },
      grants: [{ userId: ALICE, deviceId: DEVICE_ID, scopes: [DEVICE_LOGIN_SCOPE] }],
    });

    await expect(
      callerFor(noSecret, ALICE).offlineAuth.respond({ deviceId: DEVICE_ID, challenge: CHALLENGE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('tells the user when the challenge itself is mistyped', async () => {
    await expect(
      callerFor(auth, ALICE).offlineAuth.respond({ deviceId: DEVICE_ID, challenge: 'NOT-A-CODE' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
