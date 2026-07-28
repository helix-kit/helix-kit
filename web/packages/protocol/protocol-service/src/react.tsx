'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

import {
  HelixServiceClient,
  type AsyncMessagePayload,
  type HelixMessage,
  type MethodInput,
  type MethodOutput,
  type ServiceContract,
} from '.';

import type { HelixTransport } from '@helix/protocol-core';

export type HelixTransportContextValue = Readonly<{
  isConnected: boolean;
  transport: HelixTransport<HelixMessage>;
  transportName?: string;
}>;

export type HelixTransportProviderProps = HelixTransportContextValue &
  Readonly<{
    children: ReactNode;
  }>;

export type TypedDeviceServiceRequestOptions = Readonly<{
  timeoutMs?: number;
}>;

export type TypedDeviceServiceClient<TContract extends ServiceContract> = Readonly<{
  contract: TContract;
  invalidateQueries: <TMethodKey extends keyof TContract['methods'] & string>(
    methodKey?: TMethodKey,
    input?: MethodInput<TContract['methods'][TMethodKey]>,
  ) => Promise<void>;
  isConnected: boolean;
  queryKey: <TMethodKey extends keyof TContract['methods'] & string>(
    methodKey: TMethodKey,
    input: MethodInput<TContract['methods'][TMethodKey]>,
  ) => QueryKey;
  request: <TMethodKey extends keyof TContract['methods'] & string>(
    methodKey: TMethodKey,
    input: MethodInput<TContract['methods'][TMethodKey]>,
  ) => Promise<MethodOutput<TContract['methods'][TMethodKey]>>;
  send: <TMessageKey extends keyof NonNullable<TContract['messages']> & string>(
    messageKey: TMessageKey,
    payload: AsyncMessagePayload<NonNullable<TContract['messages']>[TMessageKey]>,
  ) => void | Promise<void>;
  subscribe: (
    handler: Parameters<HelixServiceClient<TContract>['subscribe']>[0],
    matcher?: Parameters<HelixServiceClient<TContract>['subscribe']>[1],
  ) => () => void;
  transportName?: string;
}>;

type QueryDataUpdater<TData> =
  TData | undefined | ((current: TData | undefined) => TData | undefined);

export type UseTypedDeviceServiceQueryOptions<
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
  TData = MethodOutput<TContract['methods'][TMethodKey]>,
> = Omit<
  UseQueryOptions<MethodOutput<TContract['methods'][TMethodKey]>, Error, TData, QueryKey>,
  'queryFn' | 'queryKey'
>;

export type UseTypedDeviceServiceMutationOptions<
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
  TContext = unknown,
> = Omit<
  UseMutationOptions<
    MethodOutput<TContract['methods'][TMethodKey]>,
    Error,
    MethodInput<TContract['methods'][TMethodKey]>,
    TContext
  >,
  'mutationFn'
>;

const HelixTransportContext = createContext<HelixTransportContextValue | null>(null);

const serviceQueryKey = (baseQueryKey: QueryKey, methodKey?: string, input?: unknown): QueryKey => {
  if (methodKey === undefined) {
    return baseQueryKey;
  }
  return input === undefined ? [...baseQueryKey, methodKey] : [...baseQueryKey, methodKey, input];
};

export const HelixTransportProvider = ({
  children,
  isConnected,
  transport,
  transportName,
}: HelixTransportProviderProps) => (
  <HelixTransportContext.Provider value={{ isConnected, transport, transportName }}>
    {children}
  </HelixTransportContext.Provider>
);

export const useHelixTransport = (): HelixTransportContextValue => {
  const context = useContext(HelixTransportContext);
  if (context === null) {
    throw new Error('useHelixTransport must be used within a HelixTransportProvider.');
  }

  return context;
};

export const useTypedDeviceService = <TContract extends ServiceContract>(
  contract: TContract,
  options: TypedDeviceServiceRequestOptions = {},
): TypedDeviceServiceClient<TContract> => {
  const { isConnected, transport, transportName } = useHelixTransport();
  const queryClient = useQueryClient();
  const { timeoutMs } = options;
  const client = useMemo(
    () => new HelixServiceClient(contract, { send: (packet) => transport.send(packet), timeoutMs }),
    [contract, timeoutMs, transport],
  );

  const baseQueryKey = useMemo(
    () => ['helix-service', transportName ?? 'transport', contract.service] as const,
    [contract.service, transportName],
  );

  useEffect(
    () =>
      transport.subscribe((packet) => {
        client.receive(packet);
      }),
    [client, transport],
  );

  return useMemo(
    () => ({
      contract,
      invalidateQueries: async (methodKey, input) => {
        await queryClient.invalidateQueries({
          queryKey: serviceQueryKey(baseQueryKey, methodKey, input),
        });
      },
      isConnected,
      queryKey: (methodKey, input) => [...baseQueryKey, methodKey, input] as const,
      request: (methodKey, input) => client.request(methodKey, input),
      send: (messageKey, payload) => client.send(messageKey, payload),
      subscribe: (handler, matcher) => client.subscribe(handler, matcher),
      transportName,
    }),
    [baseQueryKey, client, contract, isConnected, queryClient, transportName],
  );
};

export const useTypedDeviceServiceQuery = <
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
  TData = MethodOutput<TContract['methods'][TMethodKey]>,
>(
  service: TypedDeviceServiceClient<TContract>,
  methodKey: TMethodKey,
  input: MethodInput<TContract['methods'][TMethodKey]>,
  options: UseTypedDeviceServiceQueryOptions<TContract, TMethodKey, TData> = {},
) =>
  useQuery<MethodOutput<TContract['methods'][TMethodKey]>, Error, TData, QueryKey>({
    ...options,
    enabled: service.isConnected && (options.enabled ?? true),
    queryFn: () => service.request(methodKey, input),
    queryKey: service.queryKey(methodKey, input),
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    retry: options.retry ?? false,
  });

export const useTypedDeviceServiceMutation = <
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
  TContext = unknown,
>(
  service: TypedDeviceServiceClient<TContract>,
  methodKey: TMethodKey,
  options: UseTypedDeviceServiceMutationOptions<TContract, TMethodKey, TContext> = {},
) =>
  useMutation<
    MethodOutput<TContract['methods'][TMethodKey]>,
    Error,
    MethodInput<TContract['methods'][TMethodKey]>,
    TContext
  >({
    ...options,
    mutationFn: (input) => service.request(methodKey, input),
  });

export const useTypedDeviceServiceSubscription = <TContract extends ServiceContract>(
  service: TypedDeviceServiceClient<TContract>,
  handler: Parameters<TypedDeviceServiceClient<TContract>['subscribe']>[0],
  matcher?: Parameters<TypedDeviceServiceClient<TContract>['subscribe']>[1],
): void => {
  useEffect(() => service.subscribe(handler, matcher), [handler, matcher, service]);
};

export const setTypedDeviceServiceQueryData = <
  TContract extends ServiceContract,
  TMethodKey extends keyof TContract['methods'] & string,
>(
  queryClient: ReturnType<typeof useQueryClient>,
  service: TypedDeviceServiceClient<TContract>,
  methodKey: TMethodKey,
  input: MethodInput<TContract['methods'][TMethodKey]>,
  updater: QueryDataUpdater<MethodOutput<TContract['methods'][TMethodKey]>>,
): void => {
  queryClient.setQueryData(service.queryKey(methodKey, input), updater);
};
