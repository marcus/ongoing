import { json, redirect, type RequestHandler } from '@sveltejs/kit';
import { loadConfig } from '$lib/server/config';
import { clearSessionCookie } from '$lib/server/security';

const config = loadConfig();

export const POST: RequestHandler = async ({ cookies, request }) => {
  // Reading before clearing the cookie makes adapter-node enforce BODY_SIZE_LIMIT for chunked
  // requests even when its hook-level Request did not expose the incoming stream. Logout has no
  // form fields, so any body is rejected before the session mutation.
  if ((await request.arrayBuffer()).byteLength !== 0)
    return json({ error: 'Request body is too large' }, { status: 413 });
  clearSessionCookie(cookies, config.security);
  redirect(303, '/login');
};
