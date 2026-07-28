import { AzureBlobStorageProvider } from './azure-provider';
import { FilesystemStorageProvider } from './filesystem-provider';
import { S3CompatibleStorageProvider } from './s3-compatible-provider';

import type { StorageProvider } from './interface';

export type StorageProviderEnv = {
  STORAGE_PROVIDER?: string | undefined;

  NEXT_PUBLIC_BASE_URL?: string | undefined;
  PUBLIC_APP_URL?: string | undefined;
  FS_STORAGE_PUBLIC_URL?: string | undefined;
  FS_STORAGE_ROOT?: string | undefined;
  FS_STORAGE_SIGNING_SECRET?: string | undefined;
  BETTER_AUTH_SECRET?: string | undefined;

  AZURE_STORAGE_ACCOUNT_KEY?: string | undefined;
  AZURE_STORAGE_ACCOUNT_NAME?: string | undefined;
  AZURE_STORAGE_CONTAINER_NAME?: string | undefined;

  MINIO_ACCESS_KEY?: string | undefined;
  MINIO_BUCKET_NAME?: string | undefined;
  MINIO_ENDPOINT?: string | undefined;
  MINIO_REGION?: string | undefined;
  MINIO_SECRET_KEY?: string | undefined;

  AWS_ACCESS_KEY_ID?: string | undefined;
  AWS_BUCKET_NAME?: string | undefined;
  AWS_REGION?: string | undefined;
  AWS_SECRET_ACCESS_KEY?: string | undefined;
  S3_BUCKET_NAME?: string | undefined;
  S3_ENDPOINT?: string | undefined;
};

const normalizeOptional = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
};

export const createStorageProviderFromEnv = (env: StorageProviderEnv): StorageProvider => {
  const provider = normalizeOptional(env.STORAGE_PROVIDER) ?? 'FS';

  switch (provider) {
    case 'AZURE': {
      const accountKey = normalizeOptional(env.AZURE_STORAGE_ACCOUNT_KEY);
      const accountName = normalizeOptional(env.AZURE_STORAGE_ACCOUNT_NAME);
      const containerName = normalizeOptional(env.AZURE_STORAGE_CONTAINER_NAME);

      if (accountKey === undefined) {
        throw new Error('AZURE_STORAGE_ACCOUNT_KEY is required when STORAGE_PROVIDER=AZURE.');
      }

      if (accountName === undefined) {
        throw new Error('AZURE_STORAGE_ACCOUNT_NAME is required when STORAGE_PROVIDER=AZURE.');
      }

      if (containerName === undefined) {
        throw new Error('AZURE_STORAGE_CONTAINER_NAME is required when STORAGE_PROVIDER=AZURE.');
      }

      return new AzureBlobStorageProvider({
        accountKey,
        accountName,
        containerName,
      });
    }

    case 'FS': {
      // The FS provider serves blobs over an HTTP route (helix-server's public
      // plane). Its signed URLs must point at whichever host serves that route,
      // which is not necessarily the app's own base URL — so FS_STORAGE_PUBLIC_URL
      // takes precedence, letting a consumer (e.g. the Next app on :3000) sign
      // download URLs that resolve against the file server (helix-server :4000).
      const publicBaseUrl =
        normalizeOptional(env.FS_STORAGE_PUBLIC_URL) ??
        normalizeOptional(env.NEXT_PUBLIC_BASE_URL) ??
        normalizeOptional(env.PUBLIC_APP_URL) ??
        '';

      const root = normalizeOptional(env.FS_STORAGE_ROOT) ?? '/var/lib/helix/storage';

      const signingSecret =
        normalizeOptional(env.FS_STORAGE_SIGNING_SECRET) ??
        normalizeOptional(env.BETTER_AUTH_SECRET);

      if (signingSecret === undefined) {
        throw new Error(
          'Either FS_STORAGE_SIGNING_SECRET or BETTER_AUTH_SECRET is required when STORAGE_PROVIDER=FS.',
        );
      }

      return new FilesystemStorageProvider({
        publicBaseUrl,
        root,
        signingSecret,
      });
    }

    case 'MINIO': {
      const accessKeyId = normalizeOptional(env.MINIO_ACCESS_KEY) ?? 'minioadmin';
      const bucketName = normalizeOptional(env.MINIO_BUCKET_NAME) ?? 'helix-local';
      const endpoint = normalizeOptional(env.MINIO_ENDPOINT);
      const region = normalizeOptional(env.MINIO_REGION) ?? 'us-east-1';
      const secretAccessKey = normalizeOptional(env.MINIO_SECRET_KEY) ?? 'minioadmin';

      return new S3CompatibleStorageProvider({
        accessKeyId,
        bucketName,
        endpoint,
        ensureBucketExists: true,
        forcePathStyle: true,
        providerName: 'MINIO',
        region,
        secretAccessKey,
      });
    }

    case 'S3': {
      const accessKeyId = normalizeOptional(env.AWS_ACCESS_KEY_ID);
      const bucketName =
        normalizeOptional(env.S3_BUCKET_NAME) ?? normalizeOptional(env.AWS_BUCKET_NAME);
      const endpoint = normalizeOptional(env.S3_ENDPOINT);
      const region = normalizeOptional(env.AWS_REGION);
      const secretAccessKey = normalizeOptional(env.AWS_SECRET_ACCESS_KEY);

      if (accessKeyId === undefined) {
        throw new Error('AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=S3.');
      }

      if (bucketName === undefined) {
        throw new Error(
          'Either S3_BUCKET_NAME or AWS_BUCKET_NAME is required when STORAGE_PROVIDER=S3.',
        );
      }

      if (region === undefined) {
        throw new Error('AWS_REGION is required when STORAGE_PROVIDER=S3.');
      }

      if (secretAccessKey === undefined) {
        throw new Error('AWS_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=S3.');
      }

      return new S3CompatibleStorageProvider({
        accessKeyId,
        bucketName,
        endpoint,
        providerName: 'S3',
        region,
        secretAccessKey,
      });
    }

    default:
      throw new Error(
        `STORAGE_PROVIDER must be one of AZURE, FS, MINIO, S3 (received "${provider}")`,
      );
  }
};
