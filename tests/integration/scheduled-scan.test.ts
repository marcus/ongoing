import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);
async function scheduled(url: string) {
  const home = mkdtempSync(join(tmpdir(), 'ongoing-scheduled-'));
  directories.push(home);
  const database = join(home, 'must-not-open.sqlite');
  const child = Bun.spawn([process.execPath, resolve('scripts/scan.ts'), '--cheap'], {
    cwd: resolve('.'),
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ONGOING_URL: url,
      ONGOING_TRANSPORT: 'local',
      DATABASE_PATH: database
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  expect(existsSync(database)).toBe(false);
  return { status, stdout, stderr };
}

describe('scheduled scan real entry point', () => {
  it('does not create a database when the service is unavailable, even with local transport in the environment', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = server.url.toString();
    await server.stop(true);
    const result = await scheduled(url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not reachable');
  });

  it('reports the exact failed run instead of a later successful catalog run', async () => {
    const paths: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        paths.push(request.method + ' ' + url.pathname + url.search);
        if (request.method === 'POST')
          return Response.json({ runId: 'original', status: 'running' }, { status: 202 });
        if (url.pathname === '/api/scan')
          return Response.json({ id: 'original', status: 'failed' });
        return Response.json({ scan: { id: 'later', status: 'completed' } });
      }
    });
    try {
      const result = await scheduled(server.url.toString());
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ id: 'original', status: 'failed' });
      expect(paths).toContain('GET /api/scan?runId=original');
      expect(paths).not.toContain('GET /api/projects');
    } finally {
      await server.stop(true);
    }
  });
});
