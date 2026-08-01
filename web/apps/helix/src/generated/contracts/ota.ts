import { defineServiceContract, method, message } from '@helix/protocol/service';
import { z } from 'zod';

export const otaUpdateRequestSchema = z.object({
  firmwareUrl: z.string().optional(),
  devicePath: z.string().optional(),
  packagePath: z.string().optional(),
  version: z.string().optional(),
  sha256: z.string().optional(),
});

export const otaStatusPayloadSchema = z.object({
  state: z.string(),
  firmwareVersion: z.string().optional(),
  targetVersion: z.string().optional(),
  sha256: z.string().optional(),
  message: z.string().optional(),
});

export const errorPayloadSchema = z.object({
  error: z.string(),
});

export const otaContract = defineServiceContract({
  service: 'ota',
  methods: {
    otaUpdate: method({
      name: 'ota-update',
      input: otaUpdateRequestSchema,
      output: otaStatusPayloadSchema,
      error: errorPayloadSchema,
    }),
  },
  messages: {
    status: message({
      name: 'ota-status',
      payload: otaStatusPayloadSchema,
    }),
    error: message({
      name: 'ota-error',
      payload: errorPayloadSchema,
    }),
  },
});
