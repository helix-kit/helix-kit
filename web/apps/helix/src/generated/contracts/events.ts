import { defineServiceContract, method, message } from '@helix/protocol/service';
import { z } from 'zod';

export const emptyRequestSchema = z.object({});

export const errorPayloadSchema = z.object({
  error: z.string(),
});

export const statsPayloadSchema = z.object({
  pending: z.number().int(),
  sent: z.number().int(),
  expired: z.number().int(),
  total: z.number().int(),
});

export const eventSummarySchema = z.object({
  id: z.number().int(),
  msgId: z.string(),
  service: z.string(),
  eventType: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  createdTs: z.number().int(),
  expiryTs: z.number().int(),
  sentTs: z.number().int(),
});

export const eventDetailSchema = z.object({
  id: z.number().int(),
  msgId: z.string(),
  service: z.string(),
  eventType: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  createdTs: z.number().int(),
  expiryTs: z.number().int(),
  sentTs: z.number().int(),
  envelope: z.string(),
});

export const listRequestSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});

export const listResponseSchema = z.object({
  count: z.number().int(),
  events: z.array(eventSummarySchema),
});

export const getRequestSchema = z.object({
  id: z.number().int(),
});

export const emitRequestSchema = z.object({
  service: z.string(),
  eventType: z.string(),
  payload: z.unknown().optional(),
  ttlSec: z.number().int().optional(),
});

export const emitResponseSchema = z.object({
  id: z.number().int(),
  msgId: z.string(),
});

export const sweepResponseSchema = z.object({
  retried: z.number().int(),
  expired: z.number().int(),
  cleaned: z.number().int(),
  pending: z.number().int(),
});

export const eventsContract = defineServiceContract({
  service: 'events',
  methods: {
    stats: method({
      name: 'stats',
      input: emptyRequestSchema,
      output: statsPayloadSchema,
      error: errorPayloadSchema,
    }),
    list: method({
      name: 'list',
      input: listRequestSchema,
      output: listResponseSchema,
      error: errorPayloadSchema,
    }),
    get: method({
      name: 'get',
      input: getRequestSchema,
      output: eventDetailSchema,
      error: errorPayloadSchema,
    }),
    emit: method({
      name: 'emit',
      input: emitRequestSchema,
      output: emitResponseSchema,
      error: errorPayloadSchema,
    }),
    sweep: method({
      name: 'sweep',
      input: emptyRequestSchema,
      output: sweepResponseSchema,
      error: errorPayloadSchema,
    }),
  },
  messages: {
    changed: message({
      name: 'events-changed',
      payload: statsPayloadSchema,
    }),
  },
});
