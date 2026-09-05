/**
 * The two questions a device asks the cloud on every login, kept apart because
 * they will be answered by different systems.
 *
 * Helix has no user-to-device authorization model today: authorization is Better
 * Auth roles plus device *feature* flags, which gate what a device can do rather
 * than who may log into it. OpenFGA is the intended home for this once it is
 * mature enough, so the shape below is an interface with a fixture-backed
 * implementation behind it, not a schema.
 */

/** The Unix identity a Helix user maps to on a device. */
export type UnixIdentity = Readonly<{
  username: string;
  linuxUid: number;
}>;

/** Whether a user may log in right now, and what they may do once in. */
export type LoginAuthorization = Readonly<{
  allowed: boolean;
  scopes: readonly string[];
  /**
   * Bumped whenever authorization changes anywhere. Devices cache it alongside
   * scopes so a stale cache is detectable.
   */
  policyVersion: number;
}>;

/** The scope that grants interactive login. Absent means no login, full stop. */
export const DEVICE_LOGIN_SCOPE = 'device.login';

/**
 * Resolves a Helix user id to the Unix identity the device knows them by.
 *
 * Today the mapping lives in the LDAP experiment's own table; eventually it
 * belongs on the Helix user record itself.
 */
export interface UnixIdentityDirectory {
  lookup(userId: string): Promise<UnixIdentity | null>;
}

/** Answers the current authorization for one user on one device. */
export interface DeviceAuthorizationProvider {
  authorize(deviceId: string, userId: string): Promise<LoginAuthorization>;
}

/**
 * Supplies the per-device secret the offline challenge/response is keyed on.
 *
 * A single fleet-wide secret is explicitly not a product design; per-device
 * provisioning and hardware protection are deferred, so this is an interface with
 * a fixture behind it rather than anything durable.
 */
export interface DeviceSecretStore {
  secretFor(deviceId: string): Promise<Buffer | null>;
}
