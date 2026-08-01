import { boolean, index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const device = pgTable('device', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  accessToken: text('access_token').notNull().unique('device_access_token_unique'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const deviceCertificate = pgTable(
  'device_certificate',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    serialNumber: text('serial_number').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    subjectCommonName: text('subject_common_name'),
    notBefore: timestamp('not_before').notNull(),
    notAfter: timestamp('not_after').notNull(),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    status: text('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at'),
    revocationReason: text('revocation_reason'),
    revokedByUserId: text('revoked_by_user_id'),
  },
  (table) => ({
    serialUnique: unique('device_certificate_serial_number_unique').on(table.serialNumber),
    deviceIdx: index('device_certificate_device_id_idx').on(table.deviceId),
  }),
);

export const deviceEvent = pgTable(
  'device_event',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    eventType: text('event_type').notNull(),
    eventPayload: jsonb('event_payload').notNull(),
    messageId: text('message_id').notNull(),
    eventTimestamp: timestamp('event_timestamp'),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => ({
    payloadGin: index('device_event_payload_gin_idx').using(
      'gin',
      table.eventPayload.op('jsonb_path_ops'),
    ),
    deviceMessageUnique: unique('device_event_device_id_message_id_unique').on(
      table.deviceId,
      table.messageId,
    ),
  }),
);
