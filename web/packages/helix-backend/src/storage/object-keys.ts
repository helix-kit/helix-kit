import path from 'node:path';

const DEVICE_STORAGE_PREFIX = 'devices';
const PACKAGE_STORAGE_PREFIX = 'device-packages';
const CAS_STORAGE_PREFIX = 'cas';

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Content-addressed key for a release artifact blob: cas/<sha256>, global so identical bytes dedupe across types.
export const joinCasKey = (sha256: string): string => {
  if (!SHA256_HEX.test(sha256)) {
    throw new StoragePathError('sha256');
  }
  return `${CAS_STORAGE_PREFIX}/${sha256}`;
};

export class StoragePathError extends Error {
  constructor(fieldName: string) {
    super(`${fieldName} must not contain empty, current-directory, or parent-directory segments.`);
  }
}

export const normalizeStoragePathSegments = (value: string, fieldName: string): string[] => {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (normalized === '') {
    throw new StoragePathError(fieldName);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new StoragePathError(fieldName);
  }

  return segments;
};

export const joinDeviceStorageKey = (deviceId: string, objectPath: string): string =>
  path.posix.join(
    DEVICE_STORAGE_PREFIX,
    ...normalizeStoragePathSegments(deviceId, 'deviceId'),
    ...normalizeStoragePathSegments(objectPath, 'path'),
  );

export const joinPackageStorageKey = (objectPath: string): string =>
  path.posix.join(PACKAGE_STORAGE_PREFIX, ...normalizeStoragePathSegments(objectPath, 'path'));
