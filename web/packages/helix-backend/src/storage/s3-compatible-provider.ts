import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  DownloadOptions,
  SignedUrlOptions,
  StorageObjectSummary,
  StorageProvider,
  StorageProviderName,
  StorageSignedRequest,
  UploadOptions,
} from './interface';

type S3CompatibleConfig = Readonly<{
  accessKeyId: string;
  bucketName: string;
  endpoint?: string;
  ensureBucketExists?: boolean;
  forcePathStyle?: boolean;
  providerName: Extract<StorageProviderName, 'MINIO' | 'S3'>;
  region: string;
  secretAccessKey: string;
}>;

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const MILLISECONDS_IN_SECOND = 1000;

export class S3CompatibleStorageProvider implements StorageProvider {
  readonly #bucketName: string;
  readonly #client: S3Client;
  readonly #ensureBucketExistsEnabled: boolean;
  readonly #providerName: Extract<StorageProviderName, 'MINIO' | 'S3'>;
  #ensureBucketExistsPromise: Promise<void> | null = null;

  constructor(config: S3CompatibleConfig) {
    this.#bucketName = config.bucketName;
    this.#ensureBucketExistsEnabled = config.ensureBucketExists ?? false;
    this.#providerName = config.providerName;
    this.#client = this.createClient(config);
  }

  getProviderName(): StorageProviderName {
    return this.#providerName;
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    await this.ensureBucketExists();
    const command = new PutObjectCommand({
      Bucket: this.#bucketName,
      ContentType: options.contentType,
      Key: options.key,
    });
    return this.createSignedRequest('PUT', options, command);
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    await this.ensureBucketExists();
    const command = new GetObjectCommand({
      Bucket: this.#bucketName,
      Key: options.key,
    });
    return this.createSignedRequest('GET', options, command);
  }

  async upload(options: UploadOptions): Promise<void> {
    await this.ensureBucketExists();

    await this.#client.send(
      new PutObjectCommand({
        Body: options.data,
        Bucket: this.#bucketName,
        ContentType: options.contentType ?? 'application/octet-stream',
        Key: options.key,
        Metadata: options.metadata,
      }),
    );
  }

  async download(options: DownloadOptions): Promise<string> {
    await this.ensureBucketExists();

    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: options.key,
      }),
    );

    if (response.Body === undefined) {
      throw new Error(`Object body is empty for key: ${options.key}`);
    }

    return response.Body.transformToString();
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureBucketExists();

    try {
      await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucketName,
          Key: key,
        }),
      );

      return true;
    } catch (error) {
      if (this.isStorageHttpError(error, HTTP_NOT_FOUND)) {
        return false;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucketExists();

    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: key,
      }),
    );
  }

  async deleteMultiple(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.ensureBucketExists();

    await this.#client.send(
      new DeleteObjectsCommand({
        Bucket: this.#bucketName,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
        },
      }),
    );
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    return (await this.listObjects(prefix, maxKeys)).map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    await this.ensureBucketExists();

    const response = await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#bucketName,
        MaxKeys: maxKeys,
        Prefix: prefix,
      }),
    );

    return (response.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => key !== undefined)
      .map((key, index) => {
        const source = response.Contents?.[index];
        return {
          key,
          sizeBytes: source?.Size,
          updatedAt: source?.LastModified?.toISOString(),
        };
      });
  }

  private createClient(config: S3CompatibleConfig): S3Client {
    return new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });
  }

  private async createSignedRequest(
    method: 'GET' | 'PUT',
    options: SignedUrlOptions,
    command: GetObjectCommand | PutObjectCommand,
  ): Promise<StorageSignedRequest> {
    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;

    const url = await getSignedUrl(this.#client, command, {
      expiresIn,
    });

    return {
      bucket: this.#bucketName,
      expiresAt: new Date(Date.now() + expiresIn * MILLISECONDS_IN_SECOND).toISOString(),
      headers: {},
      method,
      objectKey: options.key,
      provider: this.#providerName,
      url,
    };
  }

  private async ensureBucketExists(): Promise<void> {
    if (!this.#ensureBucketExistsEnabled) {
      return;
    }
    this.#ensureBucketExistsPromise ??= this.ensureBucketExistsOnce();
    await this.#ensureBucketExistsPromise;
  }

  private async ensureBucketExistsOnce(): Promise<void> {
    try {
      await this.#client.send(
        new HeadBucketCommand({
          Bucket: this.#bucketName,
        }),
      );
    } catch (error) {
      if (this.isStorageHttpError(error, HTTP_NOT_FOUND)) {
        await this.#client.send(
          new CreateBucketCommand({
            Bucket: this.#bucketName,
          }),
        );

        return;
      }
      if (this.isStorageHttpError(error, HTTP_FORBIDDEN)) {
        return;
      }
      throw error;
    }
  }

  private isStorageHttpError(error: unknown, statusCode: number): boolean {
    return (
      error instanceof Error &&
      (error as Error & Partial<{ $metadata: { httpStatusCode?: number } }>).$metadata
        ?.httpStatusCode === statusCode
    );
  }
}
