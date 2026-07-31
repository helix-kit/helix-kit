import { type IncomingHttpHeaders, type Server } from 'node:http';

export const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve) => {
    server.listen(port, resolve);
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
  // Object.entries() over a Headers yields nothing (silently dropping every header), so pass an existing Headers through as-is.
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
