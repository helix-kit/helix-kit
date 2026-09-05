import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The cloud half of the offline challenge/response.
 *
 * A device that cannot reach the cloud shows a challenge; the user, on a phone
 * that can, signs in and submits it; this produces the response they type back.
 * The response proves only that the cloud authorized *this* user for *this*
 * device and *this* challenge — it carries no scopes, so it cannot grant
 * anything the device did not already know about the user.
 *
 * The device recomputes the same digest locally. Both implementations are pinned
 * by `linux/device/go/internal/authd/testdata/offline-response-vectors.json`, and
 * a change here that is not mirrored in Go will fail that suite.
 */

/** Omits I, L, O, 0 and 1: these codes are read aloud and retyped by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RAW_BYTES = 5;
const CODE_CHARS = 8;
const CODE_GROUP = 4;
/** A uid is written as an unsigned 64-bit big-endian integer. */
const UID_BYTES = 8;

/** Separates these digests from any other use of the same device secret. */
const OFFLINE_DOMAIN = 'HXOFF1';

const BITS_PER_CHAR = 5n;
const BITS_PER_BYTE = 8n;
const CHAR_MASK = 0x1fn;
const BYTE_MASK = 0xffn;

/** Everything a response is bound to. Change any field and the response changes. */
export type OfflineBinding = Readonly<{
  deviceId: string;
  userId: string;
  linuxUid: number;
  challenge: string;
}>;

/** Canonical form: upper case, no separators. Internal: the exported helpers all
 * normalize their own input, so callers never need to. */
const normalizeCode = (code: string): string =>
  code.trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

/** Display form, hyphenated for reading aloud. */
export const formatCode = (code: string): string => {
  const normalized = normalizeCode(code);
  if (normalized.length !== CODE_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, CODE_GROUP)}-${normalized.slice(CODE_GROUP)}`;
};

/** Renders five bytes as an eight-character code. */
export const encodeCode = (raw: Uint8Array): string => {
  if (raw.length !== CODE_RAW_BYTES) {
    throw new RangeError(`offline code needs ${CODE_RAW_BYTES} bytes, got ${raw.length}`);
  }
  let packed = 0n;
  for (const byte of raw) {
    packed = (packed << BITS_PER_BYTE) | BigInt(byte);
  }

  let out = '';
  for (let i = 0; i < CODE_CHARS; i++) {
    const shift = BITS_PER_CHAR * BigInt(CODE_CHARS - 1 - i);
    out += CODE_ALPHABET[Number((packed >> shift) & CHAR_MASK)];
  }
  return out;
};

/** Parses a code back to its bytes, accepting any case and the display hyphen. */
export const decodeCode = (code: string): Uint8Array => {
  const normalized = normalizeCode(code);
  if (normalized.length !== CODE_CHARS) {
    throw new RangeError(`offline code must be ${CODE_CHARS} characters, got ${normalized.length}`);
  }

  let packed = 0n;
  for (const char of normalized) {
    const index = CODE_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new RangeError(`offline code contains ${char}, which is not in the alphabet`);
    }
    packed = (packed << BITS_PER_CHAR) | BigInt(index);
  }

  const out = new Uint8Array(CODE_RAW_BYTES);
  for (let i = CODE_RAW_BYTES - 1; i >= 0; i--) {
    out[i] = Number(packed & BYTE_MASK);
    packed >>= BITS_PER_BYTE;
  }
  return out;
};

/** A 16-bit big-endian length followed by the bytes, so adjacent fields in the
 * digest can never run together. */
const lengthPrefixed = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
};

/** Computes the response a user should type back into the device. */
export const offlineResponse = (secret: Buffer, binding: OfflineBinding): string => {
  if (secret.length === 0) {
    throw new RangeError('offline device secret is empty');
  }
  const challenge = decodeCode(binding.challenge);

  const uid = Buffer.alloc(UID_BYTES);
  uid.writeBigUInt64BE(BigInt(binding.linuxUid));

  const digest = createHmac('sha256', secret)
    .update(Buffer.from(OFFLINE_DOMAIN, 'utf8'))
    .update(lengthPrefixed(binding.deviceId))
    // The device's user id is text, so it is length-prefixed like the device id.
    .update(lengthPrefixed(binding.userId))
    .update(uid)
    .update(challenge)
    .digest();

  return encodeCode(new Uint8Array(digest.subarray(0, CODE_RAW_BYTES)));
};

/** Compares two codes without leaking where they differ. */
export const codesMatch = (expected: string, given: string): boolean => {
  const a = Buffer.from(normalizeCode(expected), 'utf8');
  const b = Buffer.from(normalizeCode(given), 'utf8');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
};
