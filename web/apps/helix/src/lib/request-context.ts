import { AsyncLocalStorage } from 'node:async_hooks';

import { headers } from 'next/headers';

interface RequestContext {
  requestId: string;
  method: string;
  path: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// Wrap a request handler so its logs carry request metadata from the x-request-* headers via requestContextStorage.
export const withRequestContext = <TArgs extends Array<unknown>, TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): ((...args: TArgs) => Promise<TReturn>) => {
  return async (...args: TArgs): Promise<TReturn> => {
    const headerStore = await headers();
    const requestId = headerStore.get('x-request-id') ?? 'unknown';
    const method = headerStore.get('x-request-method') ?? 'unknown';
    const path = headerStore.get('x-request-path') ?? 'unknown';

    return requestContextStorage.run({ requestId, method, path }, () => fn(...args));
  };
};
