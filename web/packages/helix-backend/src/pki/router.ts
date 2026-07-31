import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { issueDeviceCertificate, type StepCaSettings } from './step-ca';

import type { DatabaseClient } from '../db';

import { deviceCertificate } from '../db/schema';
import { verifyDeviceIdToken } from '../lib/device';
import { prefixedId } from '../releases/ids';
import { createRouterFactory } from '../trpc';

const csrInputSchema = z
  .string()
  .trim()
  .min(1, 'csr is required')
  .refine(
    (value) =>
      value.includes('-----BEGIN CERTIFICATE REQUEST-----') ||
      value.includes('-----BEGIN NEW CERTIFICATE REQUEST-----'),
    'csr must be a PEM certificate signing request',
  );

const BEARER_PREFIX = 'Bearer ';

const readBearerToken = (headers: Headers): string | null => {
  const headerValue = headers.get('authorization') ?? '';
  const matchedToken = headerValue.startsWith(BEARER_PREFIX)
    ? headerValue.slice(BEARER_PREFIX.length).trim()
    : '';
  return matchedToken === '' ? null : matchedToken;
};

type StepCaContext = Readonly<{
  db: DatabaseClient;
  headers: Headers;
  stepCaSettings: StepCaSettings;
}>;

export const pkiRouter = createRouterFactory<StepCaContext>()((t) =>
  t.router({
    issueDeviceCertificate: t.procedure
      .meta({
        openapi: {
          method: 'POST',
          path: '/api/certificates/device',
        },
      })
      .input(
        z.object({
          csr: csrInputSchema,
          deviceId: z.string().trim().min(1, 'deviceId is required'),
        }),
      )
      .output(
        z.object({
          ca: z.string(),
          certificate: z.string(),
          deviceId: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { deviceId } = input;
        const accessToken = readBearerToken(ctx.headers);
        if (accessToken === null) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Device access token is missing or invalid.',
          });
        }
        const isValidDeviceToken = await verifyDeviceIdToken(deviceId, accessToken, ctx.db);
        if (!isValidDeviceToken) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Device access token is invalid.',
          });
        }
        const certificateBundle = await issueDeviceCertificate(
          deviceId,
          input.csr,
          ctx.stepCaSettings,
        );
        const { metadata } = certificateBundle;
        await ctx.db
          .insert(deviceCertificate)
          .values({
            id: prefixedId('cert'),
            deviceId,
            serialNumber: metadata.serialNumber,
            fingerprintSha256: metadata.fingerprintSha256,
            subjectCommonName: metadata.subjectCommonName,
            notBefore: metadata.notBefore,
            notAfter: metadata.notAfter,
          })
          .onConflictDoNothing({ target: deviceCertificate.serialNumber });
        return {
          ca: certificateBundle.rootCAPem,
          certificate: certificateBundle.certificatePem,
          deviceId: deviceId,
        };
      }),
  }),
);

export type PkiRouter = typeof pkiRouter;
