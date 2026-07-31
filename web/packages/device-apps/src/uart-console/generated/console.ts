import { defineServiceContract, method, message } from '@helix/protocol/service';
import { z } from 'zod';

export const openSessionRequestSchema = z.object({
  sessionId: z.string(),
  transport: z.string().optional(),
  dataUrl: z.string().optional(),
  token: z.string().optional(),
});

export const closeRequestSchema = z.object({
  sessionId: z.string(),
});

export const configureRequestSchema = z.object({
  uart: z.number().int().min(0).max(2).optional(),
  baud: z.number().int().min(300).max(4000000).optional(), // eslint-disable-line no-magic-numbers
  txPin: z.number().int().min(0).max(39).optional(), // eslint-disable-line no-magic-numbers
  rxPin: z.number().int().min(0).max(39).optional(), // eslint-disable-line no-magic-numbers
});

export const sessionPayloadSchema = z.object({
  sessionId: z.string(),
  offer: z.string().optional(),
});

export const sessionInfoSchema = z.object({
  sessionId: z.string(),
  createdAt: z.number().int(),
  terminals: z.number().int(),
});

export const sessionsPayloadSchema = z.object({
  sessions: z.array(sessionInfoSchema),
});

export const configPayloadSchema = z.object({
  ok: z.boolean(),
  uart: z.number().int(),
  baud: z.number().int(),
  txPin: z.number().int(),
  rxPin: z.number().int(),
});

export const errorPayloadSchema = z.object({
  error: z.string(),
});

export const consoleContract = defineServiceContract({
  service: 'console',
  methods: {
    open: method({
      name: 'open',
      input: openSessionRequestSchema,
      output: sessionPayloadSchema,
      error: errorPayloadSchema,
    }),
    close: method({
      name: 'close',
      input: closeRequestSchema,
      output: sessionPayloadSchema,
      error: errorPayloadSchema,
    }),
    list: method({
      name: 'list',
      input: z.unknown(),
      output: sessionsPayloadSchema,
      error: errorPayloadSchema,
    }),
    configure: method({
      name: 'configure',
      input: configureRequestSchema,
      output: configPayloadSchema,
      error: errorPayloadSchema,
    }),
  },
  messages: {
    opened: message({
      name: 'opened',
      payload: sessionPayloadSchema,
    }),
    closed: message({
      name: 'closed',
      payload: sessionPayloadSchema,
    }),
    sessions: message({
      name: 'sessions',
      payload: sessionsPayloadSchema,
    }),
    configured: message({
      name: 'configured',
      payload: configPayloadSchema,
    }),
    error: message({
      name: 'console-error',
      payload: errorPayloadSchema,
    }),
  },
});
