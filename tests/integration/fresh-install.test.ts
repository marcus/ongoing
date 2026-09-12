import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalApi } from '$lib/server/api/local';

/**
 * Phase 6's evidence, as a test: a machine that has never run Ongoing installs it, inits, scans a
 * directory, lists what it found, and edits an entry from the CLI and through the API — with a
 * fresh HOME and no configuration of anybody's on it.
 *
 * Every step runs `bin/ongoing` the way a person would, in a child process with a constructed
 * environment, so nothing here reads or writes this machine's real `~/.config/ongoing`.
 */
const directory = mkdtempSync(join(tmpdir(), 'ongoing-fresh-'));
const home = join(directory, 'home');
const roots = join(directory, 'src');
const configPath = join(home, '.config/ongoing/config.toml');
const databasePath = join(home, '.local/share/ongoing/ongoing.sqlite');
const cli = resolve('bin/ongoing');

/** Bun and git, and nothing else: no `td`, no `cloc`, no `gh`, no token. */
const path = [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');

function ongoing(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cli, args, {
    cwd: resolve('.'),
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      PATH: path,
      HOME: home,
      TMPDIR: directory,
      // Nothing is listening, and nothing should be: the whole point is that a bare machine works.
      ONGOING_TRANSPORT: 'local'
    }
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

beforeAll(() => {
  mkdirSync(home, { recursive: true });
  const project = join(roots, 'atlas');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'go.mod'), 'module example.test/atlas\n\ngo 1.27\n');
  writeFileSync(join(project, 'README.md'), '# atlas\n');
  const git = (...args: string[]) =>
    spawnSync('git', args, {
      cwd: project,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    });
  git('init', '--quiet', '--initial-branch', 'main');
  git('config', 'user.email', 'nobody@example.test');
  git('config', 'user.name', 'Nobody');
  git('add', '--all');
  git('commit', '--quiet', '--message', 'first');
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('a machine that has never run Ongoing', () => {
  it('installs, scans, lists, and edits from the CLI and the API', async () => {
    // 1. init — one configuration file and a catalog, inside this test's HOME and nowhere else.
    const init = ongoing(
      'init',
      '--scan-root',
      roots,
      '--port',
      '7899',
      '--config',
      configPath,
      '--json'
    );
    expect(init.stderr, init.stderr).toBe('');
    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({
      config: configPath,
      database: databasePath,
      scanRoots: [roots],
      port: 7899
    });
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(databasePath)).toBe(true);

    // The file it wrote is a document a person can read and the parser accepts, with the
    // endoflife provider left on — this scan simply never reaches it, having nothing to ask about.
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain('# Ongoing configuration.');
    expect(written).toContain('adapter = "foreground"');

    // Running it twice does not quietly replace somebody's choices.
    const again = ongoing('init', '--config', configPath);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already exists/);

    // 2. scan — one repository found, no warnings, with three of the providers unavailable.
    const scan = ongoing('scan', '--full');
    expect(scan.status, scan.stderr).toBe(0);
    expect(JSON.parse(scan.stdout.trim().split('\n').at(-1)!)).toMatchObject({
      status: 'completed',
      discoveredCount: 1,
      errorCount: 0
    });

    // 3. list — the query grammar, over a catalog nobody has configured.
    const listed = ongoing('list', '--json');
    expect(listed.status, listed.stderr).toBe(0);
    const entries = JSON.parse(listed.stdout) as {
      slug: string;
      fields: Record<string, unknown>;
    }[];
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe('atlas');
    expect(entries[0].fields['stack.go']).toBe('1.27');
    // Completeness reads the registry, so a project nobody has decided about is visibly incomplete.
    expect(entries[0].fields.complete).toBe(60);
    expect(ongoing('list', 'complete<100', '--count').stdout.trim()).toBe('1');

    // 4. edit from the CLI.
    const set = ongoing('set', 'atlas', 'intent', 'invest');
    expect(set.status, set.stderr).toBe(0);
    expect(ongoing('get', 'atlas', 'intent').stdout.trim()).toBe('invest');

    // 5. edit through the API. `createLocalApi` answers the same request table the HTTP routes
    // call, over the catalog init just made; the HTTP transport over those same handlers is what
    // the Playwright suite drives.
    const api = createLocalApi({ HOME: home, ONGOING_CONFIG: configPath, PATH: path });
    try {
      expect(api.config.databasePath).toBe(databasePath);
      const response = await api.request('/api/entries/project/atlas', {
        method: 'PATCH',
        body: { next_action: 'write the README', tags: ['inventory'] }
      });
      expect(response.status).toBe(200);
      const patched = (await response.json()) as { fields: Record<string, unknown> };
      expect(patched.fields.next_action).toBe('write the README');
      // Both edits are in the catalog now and every required field carries a value, so the entry
      // is complete — computed from the registry rather than from anything this test told it.
      expect(patched.fields.complete).toBe(100);
    } finally {
      api.close();
    }

    expect(ongoing('get', 'atlas', 'next_action').stdout.trim()).toBe('write the README');
    expect(ongoing('list', 'complete<100', '--count').stdout.trim()).toBe('0');
    expect(ongoing('list', 'tag:inventory', '--count').stdout.trim()).toBe('1');
  }, 180_000);
});
