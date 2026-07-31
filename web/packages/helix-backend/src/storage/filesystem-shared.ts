import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const FS_STORAGE_ROUTE = '/api/internal/fs-storage';

const MILLISECONDS_IN_SECOND = 1000;

export type FsSignedMethod = 'GET' | 'PUT';

export const resolveFsObjectPath = (root: string, key: string): string => {
  const cleaned = key.replace(/^[/\\]+/, '');
  const base = path.resolve(root);
  const full = path.resolve(base, cleaned);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Storage key escapes the FS root: ${key}`);
  }
  return full;
};

export const signFsRequest = (
  secret: string,
  method: FsSignedMethod,
  key: string,
  exp: number,
): string => createHmac('sha256', secret).update(`${method}:${key}:${exp}`).digest('hex');

export const verifyFsRequest = (
  secret: string,
  method: FsSignedMethod,
  key: string,
  exp: number,
  signature: string,
): boolean => {
  if (!Number.isFinite(exp) || exp * MILLISECONDS_IN_SECOND < Date.now()) {
    return false;
  }
  const expected = Buffer.from(signFsRequest(secret, method, key, exp));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};
