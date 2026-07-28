import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { revokeDeviceCertificate, type StepCaSettings } from './step-ca';

import type { DatabaseClient } from '../db';

import { deviceCertificate } from '../db/schema';
import { createRouterFactory, TRPCError } from '../trpc';

// Admin surface for the device-certificate lifecycle: list every certificate
// issued to a device (with issuance / expiry timestamps + current state) and
// revoke one. Revocation is native — it calls step-ca's /1.0/revoke so the
// serial lands on the CRL that mosquitto and the mTLS gateway enforce — and
// records the revocation in the device_certificate row for the admin UI.
export type CertificatesAdminSessionUser = Readonly<{ id: string; role: string | null }>;

export type CertificatesAdminContext = Readonly<{
  db: DatabaseClient;
  user: CertificatesAdminSessionUser | null;
  adminRoles: readonly string[];
  // Absent when the app has no step-ca wiring (e.g. env unset). Listing still
  // works; revoke throws a clear PRECONDITION_FAILED.
  stepCaSettings: StepCaSettings | null;
}>;

const REVOCATION_REASON_MAX = 200;

type CertificateState = 'active' | 'revoked' | 'expired';

const effectiveState = (status: string, notAfter: Date, now: number): CertificateState => {
  if (status === 'revoked') {
    return 'revoked';
  }
  return notAfter.getTime() < now ? 'expired' : 'active';
};

export const deviceCertificatesAdminRouter = createRouterFactory<CertificatesAdminContext>()((
  t,
) => {
  const adminProcedure = t.procedure.use(({ ctx, next }) => {
    if (ctx.user === null || !ctx.adminRoles.includes(ctx.user.role ?? '')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sysadmin access required' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  return t.router({
    // Every certificate issued to a device, newest first. `state` folds the
    // stored status together with expiry so the UI needs no clock logic.
    list: adminProcedure
      .input(z.object({ deviceId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({
            id: deviceCertificate.id,
            serialNumber: deviceCertificate.serialNumber,
            fingerprintSha256: deviceCertificate.fingerprintSha256,
            subjectCommonName: deviceCertificate.subjectCommonName,
            notBefore: deviceCertificate.notBefore,
            notAfter: deviceCertificate.notAfter,
            issuedAt: deviceCertificate.issuedAt,
            status: deviceCertificate.status,
            revokedAt: deviceCertificate.revokedAt,
            revocationReason: deviceCertificate.revocationReason,
          })
          .from(deviceCertificate)
          .where(eq(deviceCertificate.deviceId, input.deviceId))
          .orderBy(desc(deviceCertificate.issuedAt));

        const now = Date.now();
        return rows.map((row) => ({
          ...row,
          state: effectiveState(row.status, row.notAfter, now),
        }));
      }),

    // Revoke a certificate: mark the row revoked, then tell step-ca to add the
    // serial to the CRL. step-ca is authoritative for the CRL, so we call it
    // even for an already-expired cert to keep the two stores consistent.
    revoke: adminProcedure
      .input(
        z.object({
          certificateId: z.string().min(1),
          reason: z.string().max(REVOCATION_REASON_MAX).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({
            id: deviceCertificate.id,
            serialNumber: deviceCertificate.serialNumber,
            status: deviceCertificate.status,
          })
          .from(deviceCertificate)
          .where(eq(deviceCertificate.id, input.certificateId))
          .limit(1);
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });
        }
        if (row.status === 'revoked') {
          return { ok: true, alreadyRevoked: true };
        }
        if (ctx.stepCaSettings === null) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'step-ca is not configured; cannot revoke certificates.',
          });
        }

        const reason = input.reason ?? null;
        await revokeDeviceCertificate(row.serialNumber, reason, ctx.stepCaSettings);

        await ctx.db
          .update(deviceCertificate)
          .set({
            status: 'revoked',
            revokedAt: new Date(),
            revocationReason: reason,
            revokedByUserId: ctx.user.id,
          })
          .where(eq(deviceCertificate.id, input.certificateId));

        return { ok: true, alreadyRevoked: false };
      }),
  });
});

export type DeviceCertificatesAdminRouter = typeof deviceCertificatesAdminRouter;
