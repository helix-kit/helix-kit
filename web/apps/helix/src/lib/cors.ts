const ALLOW_HEADERS = 'authorization, content-type, x-trpc-source';
const ALLOW_METHODS = 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT';

export const applyCorsHeaders = (_request: Request, response: Response): Response => {
  response.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
  response.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
};

export const createCorsPreflightResponse = (request: Request): Response =>
  applyCorsHeaders(request, new Response(null, { status: 204 }));
