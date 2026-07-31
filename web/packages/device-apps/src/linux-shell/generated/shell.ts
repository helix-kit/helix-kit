import { defineServiceContract, method } from '@helix/protocol/service';
import { z } from 'zod';

export const IceServerSchema = z.object({
  urls: z.array(z.string()),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const OpenInputSchema = z.object({
  sessionId: z.string(),
  dataUrl: z.string().optional(),
  token: z.string().optional(),
  transport: z.string().optional(),
  iceServers: z.array(IceServerSchema).optional(),
  iceTransportPolicy: z.string().optional(),
});

export const CloseInputSchema = z.object({
  sessionId: z.string(),
});

export const ListInputSchema = z.object({});

export const SessionOutputSchema = z.object({
  sessionId: z.string(),
  offer: z.string().optional(),
});

export const SessionInfoSchema = z.object({
  sessionId: z.string(),
  createdAt: z.number().int(),
  terminals: z.number().int(),
});

export const SessionListOutputSchema = z.object({
  sessions: z.array(SessionInfoSchema),
});

export const ErrorSchema = z.object({
  error: z.string(),
});

export const SignalInputSchema = z.object({
  sessionId: z.string(),
  answer: z.string().optional(),
  candidate: z.string().optional(),
});

export const SignalOutputSchema = z.object({
  sessionId: z.string(),
});

export const PeerCandidateSchema = z.object({
  sessionId: z.string(),
  candidate: z.string(),
});

export const shellContract = defineServiceContract({
  service: 'shell',
  methods: {
    open: method({
      name: 'open',
      input: OpenInputSchema,
      output: SessionOutputSchema,
      error: ErrorSchema,
    }),
    close: method({
      name: 'close',
      input: CloseInputSchema,
      output: SessionOutputSchema,
      error: ErrorSchema,
    }),
    list: method({
      name: 'list',
      input: ListInputSchema,
      output: SessionListOutputSchema,
      error: ErrorSchema,
    }),
    signal: method({
      name: 'signal',
      input: SignalInputSchema,
      output: SignalOutputSchema,
      error: ErrorSchema,
    }),
  },
});
