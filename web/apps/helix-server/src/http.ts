import { type IncomingHttpHeaders, type Server } from 'node:http';

export const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve) => {
    server.listen(port, '0.0.0.0', resolve);
  });

export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

export const toHeaders = (incoming: IncomingHttpHeaders | Headers): Headers => {
  // trpc-to-openapi's standalone adapter runs incomingMessageToRequest, so the
  // `req` handed to createContext is a web Request whose headers are already a
  // Headers instance. Object.entries() over a Headers yields nothing, which would
  // silently drop every header (e.g. Authorization) — so pass it through as-is.
  if (incoming instanceof Headers) {
    return incoming;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    }
  }
  return headers;
};
