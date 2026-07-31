import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { URL } from 'node:url';

import { SignJWT, importJWK, type JWK } from 'jose';

const SECONDS_PER_MINUTE = 60;
const DEFAULT_OTT_TTL_MINUTES = 5;
const DEFAULT_OTT_TTL_SECONDS = DEFAULT_OTT_TTL_MINUTES * SECONDS_PER_MINUTE;
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
const DECIMAL_RADIX = 10;

export type StepCaSettings = Readonly<{
  caRootCertPath: string;
  caUrl: string;
  deviceProvisionerJwkPath: string;
  deviceProvisionerName: string;
}>;

const toEpochSeconds = (timestampMs: number): number =>
  Math.floor(timestampMs / MILLISECONDS_PER_SECOND);

const normalizePem = (value: string): string => `${value.trim()}\n`;

const bundleCertificateChain = (leafCertPem: string, issuedChainPem: string | null): string => {
  const segments = [normalizePem(leafCertPem)];
  if (issuedChainPem !== null) {
    segments.push(normalizePem(issuedChainPem));
  }
  return segments.join('');
};

const postJson = async <TResponse>(url: URL, body: string, rootCAPem: string): Promise<TResponse> =>
  new Promise<TResponse>((resolve, reject) => {
    const req = request(
      url,
      {
        ca: rootCAPem,
        headers: {
          'content-length': Buffer.byteLength(body).toString(),
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if ((res.statusCode ?? HTTP_STATUS_INTERNAL_SERVER_ERROR) >= HTTP_STATUS_BAD_REQUEST) {
            reject(new Error(`step-ca request failed with ${res.statusCode}: ${responseBody}`));
            return;
          }

          try {
            resolve(JSON.parse(responseBody) as TResponse);
          } catch (error) {
            reject(new Error(`invalid step-ca response: ${String(error)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });

const createOneTimeToken = async ({
  audience,
  subject,
  provisionerJwk,
  provisionerName,
}: Readonly<{
  audience: string;
  subject: string;
  provisionerJwk: JWK;
  provisionerName: string;
}>): Promise<string> => {
  const privateKey = await importJWK(provisionerJwk, 'ES256');
  const nowMs = Date.now();
  const issuedAt = toEpochSeconds(nowMs);
  const expiresAt = toEpochSeconds(nowMs + DEFAULT_OTT_TTL_SECONDS * MILLISECONDS_PER_SECOND);

  return new SignJWT({})
    .setProtectedHeader({
      alg: 'ES256',
      kid: typeof provisionerJwk.kid === 'string' ? provisionerJwk.kid : undefined,
      typ: 'JWT',
    })
    .setAudience(audience)
    .setExpirationTime(expiresAt)
    .setIssuedAt(issuedAt)
    .setIssuer(provisionerName)
    .setJti(`${subject}:${issuedAt}`)
    .setNotBefore(issuedAt)
    .setSubject(subject)
    .sign(privateKey);
};

export type CertificateMetadata = Readonly<{
  serialNumber: string;
  fingerprintSha256: string;
  subjectCommonName: string | null;
  notBefore: Date;
  notAfter: Date;
}>;

const parseCommonName = (subject: string): string | null => {
  for (const line of subject.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CN=')) {
      const value = trimmed.slice('CN='.length).trim();
      return value === '' ? null : value;
    }
  }
  return null;
};

export const parseCertificateMetadata = (leafCertPem: string): CertificateMetadata => {
  const certificate = new X509Certificate(leafCertPem);
  return {
    serialNumber: certificate.serialNumber,
    fingerprintSha256: certificate.fingerprint256,
    subjectCommonName: parseCommonName(certificate.subject),
    notBefore: new Date(certificate.validFrom),
    notAfter: new Date(certificate.validTo),
  };
};

export type IssuedDeviceCertificate = Readonly<{
  certificatePem: string;
  rootCAPem: string;
  metadata: CertificateMetadata;
}>;

export const issueDeviceCertificate = async (
  deviceId: string,
  csrPem: string,
  stepCaSettings: StepCaSettings,
): Promise<IssuedDeviceCertificate> => {
  const [rootCAPem, provisionerJwkRaw] = await Promise.all([
    readFile(stepCaSettings.caRootCertPath, 'utf8'),
    readFile(stepCaSettings.deviceProvisionerJwkPath, 'utf8'),
  ]);

  const signUrl = new URL('/1.0/sign', stepCaSettings.caUrl);
  const provisionerJwk = JSON.parse(provisionerJwkRaw) as JWK;
  const oneTimeToken = await createOneTimeToken({
    audience: signUrl.toString(),
    subject: deviceId,
    provisionerJwk,
    provisionerName: stepCaSettings.deviceProvisionerName,
  });

  const signResponse = await postJson<
    Readonly<{
      ca?: string;
      crt?: string;
    }>
  >(
    signUrl,
    JSON.stringify({
      csr: normalizePem(csrPem),
      ott: oneTimeToken,
    }),
    rootCAPem,
  );

  const certificatePem = typeof signResponse.crt === 'string' ? signResponse.crt.trim() : '';
  if (certificatePem === '') {
    throw new Error('step-ca did not return a device certificate.');
  }

  const issuedChainPem =
    typeof signResponse.ca === 'string' && signResponse.ca.trim() !== '' ? signResponse.ca : null;

  return {
    certificatePem: bundleCertificateChain(certificatePem, issuedChainPem),
    rootCAPem: normalizePem(rootCAPem),
    metadata: parseCertificateMetadata(certificatePem),
  };
};

const hexSerialToDecimal = (hexSerial: string): string =>
  BigInt(`0x${hexSerial.replace(/[^0-9a-fA-F]/gu, '')}`).toString(DECIMAL_RADIX);

export const revokeDeviceCertificate = async (
  serialNumber: string,
  reason: string | null,
  stepCaSettings: StepCaSettings,
): Promise<void> => {
  const [rootCAPem, provisionerJwkRaw] = await Promise.all([
    readFile(stepCaSettings.caRootCertPath, 'utf8'),
    readFile(stepCaSettings.deviceProvisionerJwkPath, 'utf8'),
  ]);

  const revokeUrl = new URL('/1.0/revoke', stepCaSettings.caUrl);
  const decimalSerial = hexSerialToDecimal(serialNumber);
  const provisionerJwk = JSON.parse(provisionerJwkRaw) as JWK;
  const oneTimeToken = await createOneTimeToken({
    audience: revokeUrl.toString(),
    subject: decimalSerial,
    provisionerJwk,
    provisionerName: stepCaSettings.deviceProvisionerName,
  });

  await postJson<Readonly<{ status?: string }>>(
    revokeUrl,
    JSON.stringify({
      ott: oneTimeToken,
      passive: true,
      reason: reason ?? undefined,
      serial: decimalSerial,
    }),
    rootCAPem,
  );
};
