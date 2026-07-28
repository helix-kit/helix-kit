export type StorageProviderName = 'AZURE' | 'FS' | 'MINIO' | 'S3';

export type SignedUrlOptions = Readonly<{
  contentType?: string;
  expiresIn?: number;
  key: string;
}>;

export type UploadOptions = Readonly<{
  contentType?: string;
  data: Buffer | string;
  key: string;
  metadata?: Record<string, string>;
}>;

export type DownloadOptions = Readonly<{
  key: string;
}>;

export type StorageObjectSummary = Readonly<{
  key: string;
  sizeBytes?: number;
  updatedAt?: string;
}>;

export type StorageSignedRequest = Readonly<{
  bucket?: string;
  expiresAt?: string;
  headers: Record<string, string>;
  method: 'GET' | 'PUT';
  objectKey?: string;
  provider: StorageProviderName;
  url: string;
}>;

export interface StorageProvider {
  delete(key: string): Promise<void>;
  deleteMultiple(keys: readonly string[]): Promise<void>;
  download(options: DownloadOptions): Promise<string>;
  exists(key: string): Promise<boolean>;
  getProviderName(): StorageProviderName;
  getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest>;
  getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest>;
  list(prefix?: string, maxKeys?: number): Promise<string[]>;
  listObjects(prefix?: string, maxKeys?: number): Promise<StorageObjectSummary[]>;
  upload(options: UploadOptions): Promise<void>;
}
