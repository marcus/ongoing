import { redirect, type RequestHandler } from '@sveltejs/kit';
import { loadConfig } from '$lib/server/config';
import { clearSessionCookie } from '$lib/server/security';

const config = loadConfig();

export const POST: RequestHandler = ({ cookies }) => {
  clearSessionCookie(cookies, config.security);
  redirect(303, '/login');
};
