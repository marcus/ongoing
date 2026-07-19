import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionToken } from '../src/lib/server/security';

interface SmokeOptions {
  baseUrl: string;
  secret: string;
}

async function chunkedPost(
  origin: string,
  path: string,
  cookieFile: string | undefined,
  body: string
): Promise<number> {
  const args = [
    'curl',
    '--silent',
    '--output',
    '/dev/null',
    '--write-out',
    '%{http_code}',
    '--max-time',
    '5',
    '--http1.1',
    '--request',
    'POST',
    '--header',
    `Origin: ${origin}`,
    '--header',
    'Transfer-Encoding: chunked',
    '--header',
    'Content-Type: application/x-www-form-urlencoded',
    '--data-binary',
    '@-'
  ];
  if (cookieFile) args.push('--cookie', cookieFile);
  args.push(`${origin}${path}`);
  const child = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  child.stdin.write(body);
  child.stdin.end();
  const [status, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (exitCode !== 0) throw new Error(`chunked curl failed: ${stderr.trim() || exitCode}`);
  return Number(status);
}

async function expectChunkedStatus(
  origin: string,
  path: string,
  cookieFile: string | undefined,
  body: string,
  status: number
): Promise<void> {
  const actual = await chunkedPost(origin, path, cookieFile, body);
  if (actual !== status) throw new Error(`chunked request to ${path} returned ${actual}`);
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('login did not set a session cookie');
  const normalized = value.toLowerCase();
  if (!normalized.includes('httponly') || !normalized.includes('samesite=strict'))
    throw new Error('session cookie is missing required protections');
  if (normalized.includes('; secure'))
    throw new Error('trusted-LAN HTTP session cookie must not use Secure');
  return value.split(';', 1)[0];
}

export async function smoke({ baseUrl, secret }: SmokeOptions): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const health = await fetch(`${origin}/api/health`);
  if (!health.ok || JSON.stringify(await health.json()) !== '{"ok":true}')
    throw new Error('public health response is not minimal and healthy');
  if (health.headers.get('x-frame-options') !== 'DENY')
    throw new Error('security headers are missing');
  console.log('Health and headers passed.');

  const anonymous = await fetch(`${origin}/api/projects`, { redirect: 'manual' });
  if (anonymous.status !== 401) throw new Error(`anonymous catalog returned ${anonymous.status}`);
  console.log('Anonymous protection passed.');

  const body = new FormData();
  body.set('secret', secret);
  const login = await fetch(`${origin}/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { origin }
  });
  if (![200, 303].includes(login.status)) throw new Error(`login returned ${login.status}`);
  const cookie = cookieFrom(login);
  console.log('Bounded login passed.');
  const catalog = await fetch(`${origin}/api/projects`, { headers: { cookie } });
  if (!catalog.ok) throw new Error(`authenticated catalog returned ${catalog.status}`);

  const cookieName = cookie.split('=', 1)[0];
  const tampered = await fetch(`${origin}/api/projects`, { headers: { cookie: `${cookie}x` } });
  if (tampered.status !== 401) throw new Error(`tampered session returned ${tampered.status}`);
  const expired = await fetch(`${origin}/api/projects`, {
    headers: { cookie: `${cookieName}=${createSessionToken(secret, Date.now() - 1)}` }
  });
  if (expired.status !== 401) throw new Error(`expired session returned ${expired.status}`);

  const bounded = await fetch(`${origin}/api/projects/not-a-database-id`, {
    method: 'PATCH',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'bounded' })
  });
  if (bounded.status !== 404) throw new Error(`bounded API mutation returned ${bounded.status}`);
  console.log('Bounded API mutation passed.');

  const csrf = await fetch(`${origin}/api/scan`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}'
  });
  if (csrf.status !== 403) throw new Error(`origin-free mutation returned ${csrf.status}`);
  for (const hostileOrigin of ['http://attacker.invalid', 'null']) {
    const hostile = await fetch(`${origin}/api/scan`, {
      method: 'POST',
      headers: { cookie, origin: hostileOrigin, 'content-type': 'application/json' },
      body: '{}'
    });
    if (hostile.status !== 403)
      throw new Error(`${hostileOrigin} mutation returned ${hostile.status}`);
  }

  const oversized = await fetch(`${origin}/api/scan`, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(20_000) })
  });
  if (oversized.status !== 413) throw new Error(`oversized mutation returned ${oversized.status}`);

  const cookieDirectory = await mkdtemp(join(tmpdir(), 'ongoing-smoke-cookie-'));
  const cookieFile = join(cookieDirectory, 'cookies.txt');
  const cookieValue = cookie.split('=', 2)[1];
  await writeFile(
    cookieFile,
    `# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\t${cookieName}\t${cookieValue}\n`,
    { mode: 0o600 }
  );
  try {
    for (const path of ['/login', '/logout', '/api/scan'])
      await expectChunkedStatus(
        origin,
        path,
        path === '/login' ? undefined : cookieFile,
        'x'.repeat(20_000),
        413
      );
  } finally {
    await rm(cookieDirectory, { recursive: true, force: true });
  }
  console.log('Chunked request limits passed.');

  const logout = await fetch(`${origin}/logout`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin }
  });
  if (logout.status !== 303 || !logout.headers.get('set-cookie')?.includes('Max-Age=0'))
    throw new Error('logout did not invalidate the browser session');
  console.log('Logout invalidation passed.');
}

export async function rateLimitSmoke({ baseUrl }: { baseUrl: string }): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const responses = await Promise.all(
    Array.from({ length: 9 }, async () => {
      const invalid = new FormData();
      invalid.set('secret', 'deliberately-invalid-secret');
      const response = await fetch(`${origin}/login`, {
        method: 'POST',
        body: invalid,
        redirect: 'manual',
        headers: { origin }
      });
      return { status: response.status, text: await response.text() };
    })
  );
  if (!responses.some(({ status, text }) => status === 429 || text.includes('Too many attempts')))
    throw new Error(`login rate limit did not activate (${responses.map(({ status }) => status)})`);
  console.log('Login rate limit passed.');
}

if (import.meta.main) {
  const baseUrl = process.argv[2];
  const secret = process.env.ONGOING_ACCESS_SECRET;
  if (!baseUrl || !/^https?:\/\//.test(baseUrl))
    throw new Error('Usage: ONGOING_ACCESS_SECRET=... bun run scripts/smoke.ts http://host:port');
  if (!secret) throw new Error('ONGOING_ACCESS_SECRET is required in the environment');
  await smoke({ baseUrl, secret });
  console.log(`Smoke checks passed for ${new URL(baseUrl).origin}.`);
}
