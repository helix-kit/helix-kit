import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { getAdminUser } from '@/server/require-admin';
import { storage } from '@/server/storage';

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

  const key = `blog/${randomUUID()}.${extensionFor(file.type)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await storage.upload({ key, data: buffer, contentType: file.type });
  const signed = await storage.getSignedUrlForDownload({ key });

  return NextResponse.json({ url: signed.url, key });
};
