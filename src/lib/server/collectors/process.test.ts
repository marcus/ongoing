import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand, runSuccessfulCommand } from './process';

describe('subprocess runner', () => {
  it('passes arguments literally and uses the requested cwd', async () => {
    const path = '/tmp/path with spaces;$(false)';
    const output = await runSuccessfulCommand(
      [
        process.execPath,
        '-e',
        'console.log(JSON.stringify([process.cwd(), process.argv[1]]))',
        path
      ],
      { cwd: process.cwd(), timeoutMs: 2_000 }
    );
    expect(JSON.parse(output)).toEqual([process.cwd(), path]);
  });

  it('returns bounded timeout results', async () => {
    const startedAt = performance.now();
    const result = await runCommand([process.execPath, '-e', 'await Bun.sleep(10_000)'], {
      cwd: process.cwd(),
      timeoutMs: 50
    });
    expect(result.timedOut).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it('terminates descendants in the timed-out process group', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ongoing-process-group-'));
    const marker = join(directory, 'descendant-survived');
    try {
      const script = `Bun.spawn([process.execPath, "-e", ${JSON.stringify(`await Bun.sleep(300); await Bun.write(${JSON.stringify(marker)}, "alive")`)}]); await Bun.sleep(10_000)`;
      const result = await runCommand([process.execPath, '-e', script], {
        cwd: process.cwd(),
        timeoutMs: 50
      });
      expect(result.timedOut).toBe(true);
      await Bun.sleep(500);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
