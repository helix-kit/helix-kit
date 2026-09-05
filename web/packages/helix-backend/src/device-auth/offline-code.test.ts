import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { codesMatch, decodeCode, encodeCode, formatCode, offlineResponse } from './offline-code';

/**
 * The device implementation owns this file; both suites read it so the cloud and
 * the device can never disagree about what a valid response is. If this test
 * fails, one of the two implementations changed without the other.
 */
const VECTORS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../linux/device/go/internal/authd/testdata/offline-response-vectors.json',
);

type Vector = Readonly<{
  name: string;
  secretHex: string;
  deviceId: string;
  userId: string;
  linuxUid: number;
  challenge: string;
  response: string;
}>;

const vectors = (): readonly Vector[] => {
  const parsed: unknown = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));
  const { vectors: list } = parsed as { vectors?: unknown };
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`no vectors in ${VECTORS_PATH}`);
  }
  return list as readonly Vector[];
};

describe('offlineResponse', () => {
  it.each(vectors().map((vector) => [vector.name, vector] as const))(
    'agrees with the device implementation: %s',
    (_name, vector) => {
      const got = offlineResponse(Buffer.from(vector.secretHex, 'hex'), {
        deviceId: vector.deviceId,
        userId: vector.userId,
        linuxUid: vector.linuxUid,
        challenge: vector.challenge,
      });
      expect(got).toBe(vector.response);
    },
  );

  // The heart of the security model: the same challenge, answered by a different
  // user, must not produce a response that works for the first one.
  it('gives different users different responses to the same challenge', () => {
    const all = vectors();
    const alice = all.find((v) => v.userId === 'user_alice' && v.deviceId === 'D123');
    const bob = all.find((v) => v.userId === 'user_bob');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice?.challenge).toBe(bob?.challenge);
    expect(alice?.response).not.toBe(bob?.response);
  });

  it('rejects an empty secret and an unparseable challenge', () => {
    expect(() =>
      offlineResponse(Buffer.alloc(0), {
        deviceId: 'D123',
        userId: 'u',
        linuxUid: 1,
        challenge: 'K7MPQ29X',
      }),
    ).toThrow(RangeError);

    expect(() =>
      offlineResponse(Buffer.from('secret'), {
        deviceId: 'D123',
        userId: 'u',
        linuxUid: 1,
        challenge: 'nope',
      }),
    ).toThrow(RangeError);
  });
});

describe('code encoding', () => {
  const CODE_CHARS = 8;

  it('round-trips', () => {
    const raw = new Uint8Array(Buffer.from('0123456789', 'hex'));
    const code = encodeCode(raw);
    expect(code).toHaveLength(CODE_CHARS);
    expect([...decodeCode(code)]).toEqual([...raw]);
  });

  // People retype these by hand, so presentation has to be forgiven.
  it.each(['K7MPQ29X', 'k7mpq29x', 'K7MP-Q29X', ' k7mp-q29x ', 'K7MP Q29X'])(
    'accepts %s',
    (typed) => {
      expect(encodeCode(decodeCode(typed))).toBe('K7MPQ29X');
    },
  );

  // I, L, O, 0 and 1 are deliberately absent from the alphabet.
  it.each(['', 'K7MPQ29', 'K7MPQ29XY', 'K7MPQ29I', 'K7MPQ290', 'K7MPQ29!'])('rejects %s', (bad) => {
    expect(() => decodeCode(bad)).toThrow(RangeError);
  });

  it('formats for reading aloud', () => {
    expect(formatCode('K7MPQ29X')).toBe('K7MP-Q29X');
    expect(formatCode('k7mp-q29x')).toBe('K7MP-Q29X');
  });
});

describe('codesMatch', () => {
  it('ignores case and separators', () => {
    expect(codesMatch('K7MPQ29X', 'k7mp-q29x')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(codesMatch('K7MPQ29X', 'K7MPQ29Y')).toBe(false);
    expect(codesMatch('K7MPQ29X', '')).toBe(false);
    expect(codesMatch('', '')).toBe(false);
  });
});
