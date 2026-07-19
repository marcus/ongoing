import { json, redirect, type Handle } from '@sveltejs/kit';
import { loadConfig } from '$lib/server/config';
import {
  hasValidSession,
  bufferRequestBodyWithinLimit,
  isSameOriginMutation
} from '$lib/server/security';

let scheduled = false;
const config = loadConfig();
const publicPaths = new Set(['/login', '/api/health']);

function secure(response: Response): Response {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'same-origin');
  response.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
  response.headers.set(
    'content-security-policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  );
  return response;
}

function unauthenticated(pathname: string): Response {
  if (pathname.startsWith('/api/'))
    return json({ error: 'Authentication required' }, { status: 401 });
  const returnTo = pathname === '/' ? '' : `?returnTo=${encodeURIComponent(pathname)}`;
  redirect(303, `/login${returnTo}`);
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const isAsset = pathname.startsWith('/_app/') || pathname === '/favicon.svg';
  const isPublic = publicPaths.has(pathname) || isAsset;
  if (!isPublic && !hasValidSession(event.cookies, config.security))
    return secure(unauthenticated(pathname));

  if (!isSameOriginMutation(event.request, config.security.appOrigin))
    return secure(json({ error: 'Request origin is not allowed' }, { status: 403 }));
  const routeLimit =
    pathname === '/logout' ? 0 : pathname === '/login' ? 1_024 : config.security.maxRequestBytes;
  const boundedRequest = await bufferRequestBodyWithinLimit(event.request, routeLimit);
  if (!boundedRequest) return secure(json({ error: 'Request body is too large' }, { status: 413 }));
  if (boundedRequest !== event.request) (event as { request: Request }).request = boundedRequest;

  // Do not await startup work: the first page renders immediately from the durable cache.
  if (!scheduled && !isPublic) {
    scheduled = true;
    setTimeout(() => {
      void import('$lib/server/scanning/runtime').then(({ catalogScanScheduler }) =>
        catalogScanScheduler.start()
      );
    }, 0);
  }
  return secure(await resolve(event));
};
