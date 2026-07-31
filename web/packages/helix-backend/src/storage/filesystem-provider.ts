import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { FS_STORAGE_ROUTE, resolveFsObjectPath, signFsRequest } from './filesystem-shared';

import type {
  DownloadOptions,
  SignedUrlOptions,
  StorageObjectSummary,
  StorageProvider,
  StorageProviderName,
  StorageSignedRequest,
  UploadOptions,
} from './interface';
import type { Dirent } from 'node:fs';

type FilesystemConfig = Readonly<{
  publicBaseUrl: string;
  root: string;
  signingSecret: string;
}>;

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;
const MILLISECONDS_IN_SECOND = 1000;
const TMP_SUFFIX_BYTES = 6;

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

export class FilesystemStorageProvider implements StorageProvider {
  constructor(private readonly config: FilesystemConfig) {}

  getProviderName(): StorageProviderName {
    return 'FS';
  }

  async upload(options: UploadOptions): Promise<void> {
    const data = typeof options.data === 'string' ? Buffer.from(options.data) : options.data;
    await this.atomicWrite(this.resolve(options.key), data);
  }

  async download(options: DownloadOptions): Promise<string> {
    try {
      return await fs.readFile(this.resolve(options.key), 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new Error(`Object not found: ${options.key}`, { cause: error });
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.resolve(key)).catch((error: unknown) => {
      if (!isErrno(error, 'ENOENT')) {
        throw error;
      }
    });
  }

  async deleteMultiple(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  async list(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    return (await this.listObjects(prefix, maxKeys)).map((object) => object.key);
  }

  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<StorageObjectSummary[]> {
    const base = path.resolve(this.config.root);
    const results: StorageObjectSummary[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxKeys) {
        return;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isErrno(error, 'ENOENT')) {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        if (results.length >= maxKeys) {
          return;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const key = path.relative(base, fullPath).split(path.sep).join('/');
        if (key.endsWith('.lock') || key.includes('.tmp-')) {
          continue;
        }
        if (prefix !== undefined && prefix !== '' && !key.startsWith(prefix)) {
          continue;
        }
        const stat = await fs.stat(fullPath);
        results.push({ key, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
      }
    };

    await walk(base);
    return results.slice(0, maxKeys);
  }

  async getSignedUrlForUpload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    return this.createSignedRequest('PUT', options);
  }

  async getSignedUrlForDownload(options: SignedUrlOptions): Promise<StorageSignedRequest> {
    return this.createSignedRequest('GET', options);
  }

  private resolve(key: string): string {
    return resolveFsObjectPath(this.config.root, key);
  }

  private async atomicWrite(full: string, data: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${randomBytes(TMP_SUFFIX_BYTES).toString('hex')}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full);
  }

  private createSignedRequest(
    method: 'GET' | 'PUT',
    options: SignedUrlOptions,
  ): StorageSignedRequest {
    const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
    const exp = Math.floor(
      (Date.now() + expiresIn * MILLISECONDS_IN_SECOND) / MILLISECONDS_IN_SECOND,
    );
    const search = new URLSearchParams({
      exp: String(exp),
      key: options.key,
      sig: signFsRequest(this.config.signingSecret, method, options.key, exp),
    });
    const route = `${FS_STORAGE_ROUTE}?${search.toString()}`;
    return {
      expiresAt: new Date(exp * MILLISECONDS_IN_SECOND).toISOString(),
      headers: {},
      method,
      objectKey: options.key,
      provider: 'FS',
      url: this.config.publicBaseUrl === '' ? route : `${this.config.publicBaseUrl}${route}`,
    };
  }
}
