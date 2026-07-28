import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getAdminUser } from '@/server/require-admin';
import { storage } from '@/server/storage';

// Public assets live under this prefix; the CDN (CloudFront OriginPath=/public)
// maps its root to it, so the prefix is stripped from the public URL.
const PUBLIC_PREFIX = 'public/';

const publicAssetUrl = async (key: string): Promise<string> => {
  const cdnBase = env.STORAGE_PUBLIC_ASSET_URL;
  if (cdnBase != null && cdnBase !== '') {
    const path = key.startsWith(PUBLIC_PREFIX) ? key.slice(PUBLIC_PREFIX.length) : key;
    return `${cdnBase.replace(/\/$/, '')}/${path}`;
  }
  // No CDN configured (dev / FS): fall back to a presigned URL.
  return (await storage.getSignedUrlForDownload({ key })).url;
};

const MAX_BYTES = 20_971_520;

const extensionFor = (type: string): string => {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
  };
  return map[type] ?? 'bin';
};

export const POST = async (request: Request) => {
  const admin = await getAdminUser(await headers());
  if (admin === null) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Only images are allowed' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
  }

  const key = `${PUBLIC_PREFIX}blog/${randomUUID()}.${extensionFor(file.type)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await storage.upload({ key, data: buffer, contentType: file.type });
  const url = await publicAssetUrl(key);

  return NextResponse.json({ url, key });
};
