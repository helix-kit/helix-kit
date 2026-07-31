import { readFile } from 'node:fs/promises';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { Socket } from 'node:net';
import { type PeerCertificate, type TLSSocket } from 'node:tls';

import { eq } from 'drizzle-orm';

import type { DatabaseClient } from '../db';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { deviceCertificate } from '../db/schema';

// The CRL is deliberately NOT part of the TLS secure context: on Node 24 / OpenSSL 3.5, a `crl` there corrupts the connection as soon as `getPeerCertificate()` is read (handshake completes, then the next request closes with "unexpected EOF"). Revocation is enforced at the app layer instead via `isDeviceCertRevoked`.
export type DeviceMtlsMaterial = { ca: Buffer; cert: Buffer; key: Buffer };

export type DeviceMtlsPaths = {
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
};

/** Read CA/cert/key once so multiple device-facing listeners can share one copy. */
export const readDeviceMtlsMaterial = async (
  paths: DeviceMtlsPaths,
): Promise<DeviceMtlsMaterial> => {
  const [ca, cert, key] = await Promise.all([
    readFile(paths.caCertPath),
    readFile(paths.serverCertPath),
    readFile(paths.serverKeyPath),
  ]);
  return { ca, cert, key };
};

// getPeerCertificate() returns `{}` (never null) when there is no peer cert.
const peerCertificate = (socket: unknown): PeerCertificate | null => {
  if (socket === null || !(socket instanceof Socket) || !('getPeerCertificate' in socket)) {
    return null;
  }
  const cert = (socket as TLSSocket).getPeerCertificate();
  return Object.keys(cert).length > 0 ? cert : null;
};

/** The device id: the CN of the client cert step-ca issued. */
export const deviceIdFromSocket = (socket: unknown): string | null => {
  const commonName = peerCertificate(socket)?.subject.CN;
  return typeof commonName === 'string' && commonName.trim() !== '' ? commonName.trim() : null;
};

/** The client cert serial (uppercase hex), matching `device_certificate.serial_number` storage. */
export const certSerialFromSocket = (socket: unknown): string | null => {
  const serial = peerCertificate(socket)?.serialNumber;
  return typeof serial === 'string' && serial.trim() !== '' ? serial.trim().toUpperCase() : null;
};

/** Whether the presented device cert has been revoked; an unrecorded serial is treated as NOT revoked. */
export const isDeviceCertRevoked = async (db: DatabaseClient, serial: string): Promise<boolean> => {
  const rows = await db
    .select({ revokedAt: deviceCertificate.revokedAt })
    .from(deviceCertificate)
    .where(eq(deviceCertificate.serialNumber, serial))
    .limit(1);
  return rows[0]?.revokedAt != null;
};

/** A device-facing HTTPS listener that REQUIRES and verifies a step-ca client cert against the CA. */
export const createDeviceMtlsServer = (
  material: DeviceMtlsMaterial,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): HttpsServer =>
  createHttpsServer(
    {
      ca: material.ca,
      cert: material.cert,
      key: material.key,
      rejectUnauthorized: true,
      requestCert: true,
    },
    handler,
  );
