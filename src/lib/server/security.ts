import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type { SecurityConfig } from './config';

export const SESSION_COOKIE = 'ongoing_session';
const TOKEN_VERSION = 'v1';

function digest(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

export function constantTimeSecretMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate, expected), digest(expected, expected));
}

export function createSessionToken(secret: string, expiresAt: number): string {
  const payload = `${TOKEN_VERSION}.${expiresAt}.${randomBytes(18).toString('base64url')}`;
  return `${payload}.${digest(payload, secret).toString('base64url')}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now()
): boolean {
  if (!token || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const payload = parts.slice(0, 3).join('.');
  const provided = Buffer.from(parts[3], 'base64url');
  const expected = digest(payload, secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function sessionCookieOptions(config: SecurityConfig) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.cookieSecure,
    maxAge: config.sessionMaxAgeSeconds
  };
}

export function setSessionCookie(cookies: Cookies, config: SecurityConfig, now = Date.now()): void {
  if (!config.accessSecret) throw new Error('Authentication is not configured');
  cookies.set(
    SESSION_COOKIE,
    createSessionToken(config.accessSecret, now + config.sessionMaxAgeSeconds * 1_000),
    sessionCookieOptions(config)
  );
}

export function clearSessionCookie(cookies: Cookies, config: SecurityConfig): void {
  cookies.delete(SESSION_COOKIE, { path: '/', secure: config.cookieSecure, sameSite: 'strict' });
}

export function hasValidSession(
  cookies: Cookies,
  config: SecurityConfig,
  now = Date.now()
): boolean {
  return (
    !config.authenticationRequired ||
    Boolean(
      config.accessSecret &&
      verifySessionToken(cookies.get(SESSION_COOKIE), config.accessSecret, now)
    )
  );
}

export function isSameOriginMutation(request: Request, configuredOrigin?: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin';
  const expected = configuredOrigin ?? new URL(request.url).origin;
  return origin === expected;
}

export async function bufferRequestBodyWithinLimit(
  request: Request,
  limit: number
): Promise<Request | null> {
  // Adapter-node's HTTP/1 server exposes chunked framing. This application has no streaming
  // mutations, so rejecting it avoids cancellation ambiguity while normal browser forms remain valid.
  if (request.headers.has('transfer-encoding')) return null;
  const declared = request.headers.get('content-length');
  if (declared === null) return request.body ? null : request;
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) return null;
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete('transfer-encoding');
  headers.set('content-length', String(total));
  return new Request(request.url, {
    method: request.method,
    headers,
    body: body.buffer,
    signal: request.signal
  });
}
