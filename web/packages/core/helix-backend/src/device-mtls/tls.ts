import { readFile } from 'node:fs/promises';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { Socket } from 'node:net';
import { type PeerCertificate, type TLSSocket } from 'node:tls';

import { eq } from 'drizzle-orm';

import type { DatabaseClient } from '../db';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { deviceCertificate } from '../db/schema';

// The mTLS material a device-facing listener terminates with: the step-ca CA
// that signs device certs, and this server's cert/key. Every device-facing
// endpoint (file transfer, the data plane) uses the SAME material so a device
// presents one identity everywhere.
//
// NB: the CRL is deliberately NOT part of the TLS secure context. On Node 24 /
// OpenSSL 3.5 a `crl` in the secure context corrupts the connection the moment
// anything reads the peer certificate (`getPeerCertificate()`) — the handshake
// still completes but the very next HTTP request/WS upgrade closes with
// "unexpected EOF". Since we must read the peer cert (it carries the device id),
// revocation is enforced at the app layer via `isDeviceCertRevoked` instead —
// `device_certificate.revoked_at` is set in lockstep with the step-ca CRL, so
// the check is equivalent. (MQTT revocation is still enforced natively by
// mosquitto's crlfile, which has no such interaction.)
export type DeviceMtlsMaterial = { ca: Buffer; cert: Buffer; key: Buffer };

export type DeviceMtlsPaths = {
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
};

// Read CA/cert/key once so multiple device-facing listeners can share one copy.
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

// The presented client cert, or null when the socket isn't a TLS socket with a
// peer cert. getPeerCertificate() returns `{}` when there is no peer cert.
const peerCertificate = (socket: unknown): PeerCertificate | null => {
  if (socket === null || !(socket instanceof Socket) || !('getPeerCertificate' in socket)) {
    return null;
  }
  const cert = (socket as TLSSocket).getPeerCertificate();
  // getPeerCertificate() returns `{}` (never null) when there is no peer cert.
  return Object.keys(cert).length > 0 ? cert : null;
};

// The device id is the CN of the client cert step-ca issued. Works on any
// TLS-terminated socket — an mTLS request's `response.socket` or a WS upgrade
// request's `request.socket`.
export const deviceIdFromSocket = (socket: unknown): string | null => {
  const commonName = peerCertificate(socket)?.subject.CN;
  return typeof commonName === 'string' && commonName.trim() !== '' ? commonName.trim() : null;
};

// The client cert serial (uppercase hex), matching how `device_certificate.
// serial_number` is stored (X509Certificate.serialNumber). Used for the
// app-layer revocation check.
export const certSerialFromSocket = (socket: unknown): string | null => {
  const serial = peerCertificate(socket)?.serialNumber;
  return typeof serial === 'string' && serial.trim() !== '' ? serial.trim().toUpperCase() : null;
};

// Whether the presented device cert has been revoked. An unknown serial (a
// CA-signed cert not recorded at issue time) is treated as NOT revoked — the
// same as the old TLS-layer CRL, which only rejected explicitly-revoked serials.
export const isDeviceCertRevoked = async (db: DatabaseClient, serial: string): Promise<boolean> => {
  const rows = await db
    .select({ revokedAt: deviceCertificate.revokedAt })
    .from(deviceCertificate)
    .where(eq(deviceCertificate.serialNumber, serial))
    .limit(1);
  return rows[0]?.revokedAt != null;
};

// A device-facing HTTPS listener that REQUIRES and verifies a step-ca client
// cert against the CA. rejectUnauthorized means the handshake fails before any
// request/upgrade if the cert is missing or untrusted; revocation is enforced
// per-request by the handler (see isDeviceCertRevoked).
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
