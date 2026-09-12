import { fail, redirect } from '@sveltejs/kit';
import { loadRuntimeConfig } from '$lib/server/config';
import { constantTimeSecretMatches, hasValidSession, setSessionCookie } from '$lib/server/security';
import type { Actions, PageServerLoad } from './$types';

const config = loadRuntimeConfig();
const attempts = new Map<string, { count: number; resetAt: number }>();

function safeReturnTo(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function limited(address: string, now = Date.now()): boolean {
  if (attempts.size >= 256)
    for (const [key, attempt] of attempts) if (attempt.resetAt <= now) attempts.delete(key);
  if (attempts.size >= 256 && !attempts.has(address)) return true;
  const current = attempts.get(address);
  if (!current || current.resetAt <= now) {
    attempts.set(address, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

export const load: PageServerLoad = ({ cookies, url }) => {
  if (hasValidSession(cookies, config.security))
    redirect(303, safeReturnTo(url.searchParams.get('returnTo')));
  return { returnTo: safeReturnTo(url.searchParams.get('returnTo')) };
};

export const actions: Actions = {
  default: async ({ cookies, getClientAddress, request, url }) => {
    let address = 'unknown';
    try {
      address = getClientAddress();
    } catch {
      /* adapter may not expose it in tests */
    }
    if (limited(address)) return fail(429, { error: 'Too many attempts. Try again shortly.' });
    const data = await request.formData();
    const candidate = data.get('secret');
    if (
      typeof candidate !== 'string' ||
      candidate.length > 256 ||
      !config.security.accessSecret ||
      !constantTimeSecretMatches(candidate, config.security.accessSecret)
    )
      return fail(400, { error: 'The access secret was not accepted.' });
    setSessionCookie(cookies, config.security);
    redirect(303, safeReturnTo(url.searchParams.get('returnTo')));
  }
};
