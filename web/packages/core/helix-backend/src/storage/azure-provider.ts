import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

import type {
  DownloadOptions,
  SignedUrlOptions,
  StorageObjectSummary,
  StorageProvider,
  StorageProviderName,
  StorageSignedRequest,
  UploadOptions,
} from './interface';

type AzureConfig = Readonly<{
  accountKey: string;
  accountName: string;
  containerName: string;
}>;

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;

export class AzureBlobStorageProvider implements StorageProvider {
  readonly #containerClient;
  readonly #containerName: string;
  readonly #sharedKeyCredential: StorageSharedKeyCredential;

  constructor(config: AzureConfig) {
    this.#containerName = config.containerName;
    this.#sharedKeyCredential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    const blobServiceClient = new BlobServiceClient(
      `https://${config.accountName}.blob.core.windows.net`,
      this.#sharedKeyCredential,
    );
    this.#containerClient = blobServiceClient.getContainerClient(config.containerName);
  }

  getProviderName(): StorageProviderName {
    return 'AZURE';
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresOn = this.createExpiry(options);
    const blobClient = this.#containerClient.getBlobClient(options.key);
    const sasToken = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.#containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('cw'),
      },
      this.#sharedKeyCredential,
    ).toString();

    return {
      bucket: this.#containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {},
      method: 'PUT',
      objectKey: options.key,
      provider: 'AZURE',
      url: `${blobClient.url}?${sasToken}`,
    };
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    const expiresOn = this.createExpiry(options);
    const blobClient = this.#containerClient.getBlobClient(options.key);
    const sasToken = generateBlobSASQueryParameters(
      {
        blobName: options.key,
        containerName: this.#containerName,
        expiresOn,
        permissions: BlobSASPermissions.parse('r'),
      },
      this.#sharedKeyCredential,
    ).toString();

    return {
      bucket: this.#containerName,
      expiresAt: expiresOn.toISOString(),
      headers: {},
      method: 'GET',
      objectKey: options.key,
      provider: 'AZURE',
      url: `${blobClient.url}?${sasToken}`,
    };
  }

  async upload(options: UploadOptions): Promise<void> {
    const blockBlobClient = this.#containerClient.getBlockBlobClient(options.key);
    const body = typeof options.data === 'string' ? Buffer.from(options.data) : options.data;
    await blockBlobClient.upload(body, body.length, {
      blobHTTPHeaders: {
        blobContentType: options.contentType ?? 'application/octet-stream',
      },
      metadata: options.metadata,
    });
  }

  async download(options: DownloadOptions): Promise<string> {
    const blobClient = this.#containerClient.getBlobClient(options.key);
    const response = await blobClient.download();
    if (response.readableStreamBody === undefined) {
      throw new Error(`Blob body is empty for key: ${options.key}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async exists(key: string): Promise<boolean> {
    return this.#containerClient.getBlobClient(key).exists();
  }

  async delete(key: string): Promise<void> {
    await this.#containerClient.getBlobClient(key).deleteIfExists();
  }

  async deleteMultiple(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    return (await this.listObjects(prefix, maxKeys)).map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    const objects: StorageObjectSummary[] = [];
    for await (const blob of this.#containerClient.listBlobsFlat({ prefix })) {
      if (objects.length >= maxKeys) {
        break;
      }
      objects.push({
        key: blob.name,
        sizeBytes: blob.properties.contentLength,
        updatedAt: blob.properties.lastModified.toISOString(),
      });
    }
    return objects;
  }

  private createExpiry(options: SignedUrlOptions): Date {
    const expiresOn = new Date();
    expiresOn.setSeconds(
      expiresOn.getSeconds() + (options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS),
    );
    return expiresOn;
  }
}
