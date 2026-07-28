import { defineServiceContract, method } from '@helix/protocol-service';
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

export const SessionOutputSchema = z.object({
  sessionId: z.string(),
  offer: z.string().optional(),
});

export const ListInputSchema = z.object({
  path: z.string().optional(),
});

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int(),
  isDir: z.boolean(),
  modifiedAt: z.number().int(),
});

export const ListOutputSchema = z.object({
  path: z.string(),
  parent: z.string().optional(),
  entries: z.array(FileEntrySchema),
});

export const RootsInputSchema = z.object({});

export const RootsOutputSchema = z.object({
  roots: z.array(z.string()),
});

export const TransferMetaSchema = z.object({
  op: z.string(),
  path: z.string(),
  size: z.number().int().optional(),
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

export const filesContract = defineServiceContract({
  service: 'files',
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
      output: ListOutputSchema,
      error: ErrorSchema,
    }),
    roots: method({
      name: 'roots',
      input: RootsInputSchema,
      output: RootsOutputSchema,
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
