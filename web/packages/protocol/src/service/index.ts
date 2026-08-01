import {
  HelixRequestRegistry,
  createRequestId,
  type HelixPacket,
  type RequestIdFactory,
} from '@helix/protocol';

export type Schema<TValue> = Readonly<{
  parse: (value: unknown) => TValue;
}>;

export type InferSchema<TSchema> = TSchema extends Schema<infer TValue> ? TValue : never;

export type HelixMessage<TPayload = unknown> = Readonly<{
  method: string;
  payload?: TPayload;
  service: string;
}>;

export type ServiceMethod<
  TInputSchema extends Schema<unknown>,
  TOutputSchema extends Schema<unknown>,
  TErrorSchema extends Schema<unknown> | undefined = Schema<unknown> | undefined,
> = Readonly<{
  error?: TErrorSchema;
  input: TInputSchema;
  name: string;
  output: TOutputSchema;
}>;

export type ServiceAsyncMessage<TPayloadSchema extends Schema<unknown>> = Readonly<{
  name: string;
  payload: TPayloadSchema;
}>;

export type ServiceContract = Readonly<{
  messages?: Readonly<Record<string, ServiceAsyncMessage<Schema<unknown>>>>;
  methods: Readonly<Record<string, ServiceMethod<Schema<unknown>, Schema<unknown>>>>;
  service: string;
}>;

export type MethodInput<TMethod> =
  TMethod extends ServiceMethod<infer TInput, Schema<unknown>, Schema<unknown> | undefined>
    ? InferSchema<TInput>
    : never;

export type MethodOutput<TMethod> =
  TMethod extends ServiceMethod<Schema<unknown>, infer TOutput, Schema<unknown> | undefined>
    ? InferSchema<TOutput>
    : never;

export type MethodError<TMethod> =
  TMethod extends ServiceMethod<Schema<unknown>, Schema<unknown>, infer TError>
    ? TError extends Schema<unknown>
      ? InferSchema<TError>
      : never
    : never;

export type AsyncMessagePayload<TMessage> =
  TMessage extends ServiceAsyncMessage<infer TPayload> ? InferSchema<TPayload> : never;

export type PacketSender = (packet: HelixPacket<HelixMessage>) => void | Promise<void>;

export type ServiceClientOptions = Readonly<{
  createId?: RequestIdFactory;
  send: PacketSender;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 120_000;

export const method = <
  const TInputSchema extends Schema<unknown>,
  const TOutputSchema extends Schema<unknown>,
  const TErrorSchema extends Schema<unknown> | undefined = undefined,
>(definition: {
  error?: TErrorSchema;
  input: TInputSchema;
  name: string;
  output: TOutputSchema;
}): ServiceMethod<TInputSchema, TOutputSchema, TErrorSchema> => definition;

export const message = <const TPayloadSchema extends Schema<unknown>>(definition: {
  name: string;
  payload: TPayloadSchema;
}): ServiceAsyncMessage<TPayloadSchema> => definition;

export const defineServiceContract = <const TContract extends ServiceContract>(
  contract: TContract,
): TContract => contract;

export const createServiceMessage = <TPayload>(
  service: string,
  methodName: string,
  payload?: TPayload,
): HelixMessage<TPayload> => ({
  method: methodName,
  ...(payload === undefined ? {} : { payload }),
  service,
});

export const createServicePacket = <TPayload>(
  service: string,
  methodName: string,
  payload?: TPayload,
): HelixPacket<HelixMessage<TPayload>> => ({
  message: createServiceMessage(service, methodName, payload),
});

const createRequestPacket = <TPayload>(
  service: string,
  methodName: string,
  payload: TPayload,
  requestId: string,
): HelixPacket<HelixMessage<TPayload>> => ({
  message: createServiceMessage(service, methodName, payload),
  requestId,
});

export const isServiceMessage = (value: unknown): value is HelixMessage => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<HelixMessage>;
  return typeof candidate.service === 'string' && typeof candidate.method === 'string';
};

export const packetMatches = (
  packet: HelixPacket<HelixMessage>,
  matcher: Readonly<{
    method?: string;
    service?: string;
  }>,
): boolean =>
  (matcher.service === undefined || packet.message.service === matcher.service) &&
  (matcher.method === undefined || packet.message.method === matcher.method);

const getContractMethod = <
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
>(
  contract: TContract,
  methodKey: TMethodKey,
): TContract['methods'][TMethodKey] => {
  const methodDefinition = contract.methods[methodKey];
  if (methodDefinition === undefined) {
    throw new Error(`Unknown Helix service method ${methodKey}`);
  }

  return methodDefinition as TContract['methods'][TMethodKey];
};

export class HelixServiceClient<TContract extends ServiceContract> {
  readonly #contract: TContract;
  readonly #createId: RequestIdFactory;
  readonly #registry = new HelixRequestRegistry<HelixMessage>();
  readonly #send: PacketSender;
  readonly #subscriptions = new Set<(packet: HelixPacket<HelixMessage>) => void>();
  readonly #timeoutMs: number;

  constructor(contract: TContract, options: ServiceClientOptions) {
    this.#contract = contract;
    this.#createId = options.createId ?? createRequestId;
    this.#send = options.send;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  receive(packet: HelixPacket<HelixMessage>): void {
    if (packet.requestId !== undefined) {
      this.#registry.resolve(packet.requestId, packet.message);
    }

    for (const subscription of this.#subscriptions) {
      subscription(packet);
    }
  }

  async request<const TMethodKey extends keyof TContract['methods'] & string>(
    methodKey: TMethodKey,
    input: MethodInput<TContract['methods'][TMethodKey]>,
  ): Promise<MethodOutput<TContract['methods'][TMethodKey]>> {
    const methodDefinition = getContractMethod(this.#contract, methodKey);
    const payload = methodDefinition.input.parse(input);
    const requestId = this.#createId();
    const response = this.#registry.create(requestId, this.#timeoutMs);

    await this.#send(
      createRequestPacket(this.#contract.service, methodDefinition.name, payload, requestId),
    );

    const responseMessage = await response;
    return methodDefinition.output.parse(responseMessage.payload) as MethodOutput<
      TContract['methods'][TMethodKey]
    >;
  }

  send<const TMessageKey extends keyof NonNullable<TContract['messages']> & string>(
    messageKey: TMessageKey,
    payload: AsyncMessagePayload<NonNullable<TContract['messages']>[TMessageKey]>,
  ): void | Promise<void> {
    const messageDefinition = this.#contract.messages?.[messageKey];
    if (messageDefinition === undefined) {
      throw new Error(`Unknown Helix service message ${messageKey}`);
    }

    return this.#send(
      createServicePacket(
        this.#contract.service,
        messageDefinition.name,
        messageDefinition.payload.parse(payload),
      ),
    );
  }

  subscribe(
    handler: (packet: HelixPacket<HelixMessage>) => void,
    matcher: Readonly<{
      method?: string;
      service?: string;
    }> = { service: this.#contract.service },
  ): () => void {
    const subscription = (packet: HelixPacket<HelixMessage>) => {
      if (packetMatches(packet, matcher)) {
        handler(packet);
      }
    };

    this.#subscriptions.add(subscription);
    return () => {
      this.#subscriptions.delete(subscription);
    };
  }
}
