import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rateLimitSmoke, smoke } from './smoke';

const directory = await mkdtemp(join(tmpdir(), 'ongoing-production-smoke-'));
const port = 43_000 + Math.floor(Math.random() * 1_000);
const origin = `http://127.0.0.1:${port}`;
const secret = 'production-smoke-secret-only';
const child = Bun.spawn(['bun', 'build/index.js'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    ONGOING_REQUIRE_AUTH: 'true',
    PORT: String(port),
    ORIGIN: origin,
    APP_ORIGIN: origin,
    ONGOING_ACCESS_SECRET: secret,
    DATABASE_PATH: join(directory, 'catalog.sqlite'),
    SCAN_ROOTS: join(directory, 'repositories'),
    ONGOING_ENABLE_SCAN_SCHEDULER: 'false',
    BODY_SIZE_LIMIT: '16384'
  },
  stdout: 'inherit',
  stderr: 'inherit'
});

try {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {
      /* starting */
    }
    await Bun.sleep(250);
  }
  if (process.env.ONGOING_RATE_SMOKE === 'true') await rateLimitSmoke({ baseUrl: origin });
  else await smoke({ baseUrl: origin, secret });
  console.log('Production adapter authentication smoke passed.');
} finally {
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2_000).then(() => false)
  ]);
  if (!stopped) child.kill('SIGKILL');
  child.unref();
  await rm(directory, { recursive: true, force: true });
}
