import { defineServiceContract, method, message } from '@helix/protocol-service';
import { z } from 'zod';

export const setGpioRequestSchema = z.object({
  pin: z.number().int().min(0).max(39), // eslint-disable-line no-magic-numbers
  high: z.boolean(),
});

export const readGpioRequestSchema = z.object({
  pin: z.number().int().min(0).max(39).optional(), // eslint-disable-line no-magic-numbers
});

export const gpioPinStateSchema = z.object({
  pin: z.number().int(),
  level: z.number().int().min(0).max(1),
});

export const gpioStatePayloadSchema = z.object({
  pins: z.array(gpioPinStateSchema),
});

export const errorPayloadSchema = z.object({
  error: z.string(),
});

export const gpioControlContract = defineServiceContract({
  service: 'gpio-control',
  methods: {
    setGpio: method({
      name: 'set-gpio',
      input: setGpioRequestSchema,
      output: gpioStatePayloadSchema,
      error: errorPayloadSchema,
    }),
    readGpio: method({
      name: 'read-gpio',
      input: readGpioRequestSchema,
      output: gpioStatePayloadSchema,
      error: errorPayloadSchema,
    }),
  },
  messages: {
    state: message({
      name: 'gpio-control-state',
      payload: gpioStatePayloadSchema,
    }),
    error: message({
      name: 'gpio-control-error',
      payload: errorPayloadSchema,
    }),
  },
});
