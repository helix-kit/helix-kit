import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import {
  FS_STORAGE_ROUTE,
  resolveFsObjectPath,
  verifyFsRequest,
  type FsSignedMethod,
} from './filesystem-shared';

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_NO_CONTENT = 204;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const BYTES_PER_KIB = 1024;

// The signed URL's HMAC signature is the authorization, not the request origin —
// so a browser on any origin (e.g. the app on :3000 fetching a blob from the
// file server on :4000) may read it. Allow cross-origin reads.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};
const MAX_UPLOAD_MIB = 64;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MIB * BYTES_PER_KIB * BYTES_PER_KIB;

export type FsStorageHttpOptions = Readonly<{
  root: string;
  signingSecret: string;
}>;

export const isFsStorageRequest = (pathname: string): boolean => pathname === FS_STORAGE_ROUTE;

const sendText = (response: ServerResponse, status: number, body: string): void => {
  response.writeHead(status, { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
};

const readUploadBody = async (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    request.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        reject(new Error('Upload body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });

const authorize = (
  request: IncomingMessage,
  method: FsSignedMethod,
  options: FsStorageHttpOptions,
): { key: string; root: string } | null => {
  const url = new URL(request.url ?? '/', 'https://localhost');
  const key = url.searchParams.get('key');
  const signature = url.searchParams.get('sig');
  const exp = Number(url.searchParams.get('exp'));
  if (
    key === null ||
    signature === null ||
    !verifyFsRequest(options.signingSecret, method, key, exp, signature)
  ) {
    return null;
  }
  return { key, root: options.root };
};

export const handleFsStorageRequest = async (
  options: FsStorageHttpOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> => {
  const { pathname } = new URL(request.url ?? '/', 'https://localhost');
  if (!isFsStorageRequest(pathname)) {
    return false;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(HTTP_NO_CONTENT, CORS_HEADERS);
    response.end();
    return true;
  }

  if (request.method === 'GET') {
    const authorized = authorize(request, 'GET', options);
    if (authorized === null) {
      sendText(response, HTTP_FORBIDDEN, 'Forbidden');
      return true;
    }
    try {
      const data = await readFile(resolveFsObjectPath(authorized.root, authorized.key));
      response.writeHead(HTTP_OK, { ...CORS_HEADERS, 'content-type': 'application/octet-stream' });
      response.end(data);
    } catch {
      sendText(response, HTTP_NOT_FOUND, 'Not found');
    }
    return true;
  }

  if (request.method === 'PUT') {
    const authorized = authorize(request, 'PUT', options);
    if (authorized === null) {
      sendText(response, HTTP_FORBIDDEN, 'Forbidden');
      return true;
    }
    try {
      const full = resolveFsObjectPath(authorized.root, authorized.key);
      await mkdir(path.dirname(full), { recursive: true });
      const buffer = await readUploadBody(request);
      const tmp = `${full}.tmp-upload`;
      await writeFile(tmp, buffer);
      await rename(tmp, full);
      response.writeHead(HTTP_OK);
      response.end();
    } catch (error) {
      sendText(
        response,
        HTTP_SERVER_ERROR,
        error instanceof Error ? error.message : 'Upload failed',
      );
    }
    return true;
  }

  sendText(response, HTTP_FORBIDDEN, 'Forbidden');
  return true;
};
