import { randomBytes, timingSafeEqual } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { sha256Hex } from './adapters/types';

import { type DatabaseClient } from '../db';
import { build, ciToken } from '../db/release-schema';

const CI_TOKEN_PREFIX_LEN = 12;
const TOKEN_SECRET_BYTES = 24;

export const hashToken = (secret: string): string => sha256Hex(secret);

const constantTimeEquals = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

export type CiTokenScopes = Readonly<{
  typeKeys?: readonly string[];
  names?: readonly string[];
  canPublish?: boolean;
}>;

const scopeAllows = (allowed: readonly string[] | undefined, value: string): boolean =>
  allowed === undefined || allowed.includes('*') || allowed.includes(value);

// Mint a CI token: the secret is returned once; only its hash + prefix persist.
export const generateCiToken = (): { secret: string; prefix: string; hash: string } => {
  const secret = `cit_${randomBytes(TOKEN_SECRET_BYTES).toString('hex')}`;
  return { secret, prefix: secret.slice(0, CI_TOKEN_PREFIX_LEN), hash: hashToken(secret) };
};

// Verify a CI bearer against ci_token, enforcing scope for the target action.
export const verifyCiToken = async (
  db: DatabaseClient,
  secret: string | null,
  requirement: Readonly<{ typeKey?: string; name?: string; publish?: boolean }>,
): Promise<{ id: string; scopes: CiTokenScopes }> => {
  if (secret === null || secret.trim() === '') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'CI token is missing.' });
  }
  const prefix = secret.slice(0, CI_TOKEN_PREFIX_LEN);
  const rows = await db.select().from(ciToken).where(eq(ciToken.tokenPrefix, prefix));
  const presentedHash = hashToken(secret);
  const now = new Date();
  const matched = rows.find(
    (row) =>
      constantTimeEquals(row.tokenHash, presentedHash) &&
      row.revokedAt === null &&
      (row.expiresAt === null || row.expiresAt > now),
  );
  if (matched === undefined) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'CI token is invalid.' });
  }
  const scopes = (matched.scopes ?? {}) as CiTokenScopes;
  if (requirement.typeKey !== undefined && !scopeAllows(scopes.typeKeys, requirement.typeKey)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CI token not scoped for this type.' });
  }
  if (requirement.name !== undefined && !scopeAllows(scopes.names, requirement.name)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CI token not scoped for this release.' });
  }
  if (requirement.publish === true && scopes.canPublish === false) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CI token cannot publish.' });
  }
  await db.update(ciToken).set({ lastUsedAt: now }).where(eq(ciToken.id, matched.id));
  return { id: matched.id, scopes };
};

export const generateBuildCallbackToken = (): { secret: string; hash: string } => {
  const secret = `bcb_${randomBytes(TOKEN_SECRET_BYTES).toString('hex')}`;
  return { secret, hash: hashToken(secret) };
};

// Verify a per-build callback bearer scoped strictly to its buildId.
export const verifyBuildCallback = async (
  db: DatabaseClient,
  buildId: string,
  secret: string | null,
): Promise<{ ownerUserId: string | null; typeKey: string }> => {
  if (secret === null || secret.trim() === '') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Build callback token is missing.' });
  }
  const [row] = await db.select().from(build).where(eq(build.id, buildId)).limit(1);
  const now = new Date();
  if (row === undefined) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Build callback token is invalid.' });
  }
  if (
    row.callbackTokenHash === null ||
    !constantTimeEquals(row.callbackTokenHash, hashToken(secret)) ||
    (row.callbackExpiresAt !== null && row.callbackExpiresAt <= now)
  ) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Build callback token is invalid.' });
  }
  return { ownerUserId: row.ownerUserId, typeKey: row.typeKey };
};
