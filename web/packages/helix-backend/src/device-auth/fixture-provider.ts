/**
 * A fixture-backed stand-in for the authorization model Helix does not have yet.
 *
 * It is deliberately mutable: the authentication experiments need to revoke a
 * grant mid-test and watch a device notice, which is exactly what the real
 * system will have to support.
 */

import {
  DEVICE_LOGIN_SCOPE,
  type DeviceAuthorizationProvider,
  type LoginAuthorization,
  type UnixIdentity,
  type UnixIdentityDirectory,
} from './types';

/** One user's grant on one device. */
export type FixtureGrant = Readonly<{
  userId: string;
  deviceId: string;
  scopes: readonly string[];
}>;

/** The seed a fixture provider starts from. */
export type Fixture = Readonly<{
  identities: Readonly<Record<string, UnixIdentity>>;
  grants: readonly FixtureGrant[];
}>;

const DENIED: LoginAuthorization = { allowed: false, scopes: [], policyVersion: 0 };

const grantKey = (deviceId: string, userId: string): string => `${deviceId} ${userId}`;

/**
 * FixtureAuthorization implements both halves of the contract from an in-memory
 * seed. Swapping it for an OpenFGA-backed implementation is a construction-site
 * change: no caller touches this class directly.
 */
export class FixtureAuthorization implements DeviceAuthorizationProvider, UnixIdentityDirectory {
  readonly #identities: Map<string, UnixIdentity>;
  readonly #grants: Map<string, readonly string[]>;
  #policyVersion: number;

  constructor(fixture: Fixture) {
    this.#identities = new Map(Object.entries(fixture.identities));
    this.#grants = new Map(
      fixture.grants.map((grant) => [grantKey(grant.deviceId, grant.userId), [...grant.scopes]]),
    );
    this.#policyVersion = 1;
  }

  /** The current policy version, bumped by every mutation below. */
  get policyVersion(): number {
    return this.#policyVersion;
  }

  lookup(userId: string): Promise<UnixIdentity | null> {
    return Promise.resolve(this.#identities.get(userId) ?? null);
  }

  authorize(deviceId: string, userId: string): Promise<LoginAuthorization> {
    const scopes = this.#grants.get(grantKey(deviceId, userId));
    if (scopes === undefined) {
      return Promise.resolve(DENIED);
    }
    return Promise.resolve({
      // Holding a grant is not permission to log in: the login scope has to be
      // present, so it can be withdrawn without deleting the grant.
      allowed: scopes.includes(DEVICE_LOGIN_SCOPE),
      // A copy, because `readonly` is only a compile-time promise and a caller
      // must not be able to grant itself a scope by mutating what it was handed.
      scopes: [...scopes],
      policyVersion: this.#policyVersion,
    });
  }

  /** Replaces a user's scopes on a device and bumps the policy version. */
  setScopes(deviceId: string, userId: string, scopes: readonly string[]): void {
    this.#grants.set(grantKey(deviceId, userId), [...scopes]);
    this.#policyVersion += 1;
  }

  /** Withdraws login while leaving any other scopes intact. */
  revokeLogin(deviceId: string, userId: string): void {
    const scopes = this.#grants.get(grantKey(deviceId, userId)) ?? [];
    this.setScopes(
      deviceId,
      userId,
      scopes.filter((scope) => scope !== DEVICE_LOGIN_SCOPE),
    );
  }

  /** Removes the grant entirely. */
  revokeAll(deviceId: string, userId: string): void {
    this.#grants.delete(grantKey(deviceId, userId));
    this.#policyVersion += 1;
  }
}

/**
 * parseFixture reads a fixture from JSON, so a deployment can seed the mock
 * without a rebuild. Malformed input throws rather than silently authorizing
 * nobody, which would look like a working system that denies everything.
 */
export const parseFixture = (json: string): Fixture => {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('device auth fixture must be a JSON object');
  }
  // Destructured as unknown, not cast to Fixture: claiming the shape up front
  // would make the checks below dead code that only looks like validation.
  const { identities, grants } = parsed as { identities?: unknown; grants?: unknown };
  if (typeof identities !== 'object' || identities === null || Array.isArray(identities)) {
    throw new TypeError('device auth fixture needs an "identities" object');
  }
  if (!Array.isArray(grants)) {
    throw new TypeError('device auth fixture needs a "grants" array');
  }
  return {
    identities: identities as Fixture['identities'],
    grants: grants as Fixture['grants'],
  };
};
