import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { activeProviders, resolveProviders } from '$lib/domain/provider';
import { loadConfig } from '$lib/server/config';
import { parseConfigFile } from '$lib/server/config-file';
import { probeProviders } from '$lib/server/providers/registry';

/**
 * ADR 0007's promise, checked rather than asserted: a machine with no `td`, no `cloc`, no `gh`, and
 * no GitHub token runs a clean scan and reports those providers unavailable.
 *
 * The scan runs in a child process with a constructed PATH, so nothing here depends on — or
 * disturbs — what this machine happens to have installed.
 */
const directory = mkdtempSync(join(tmpdir(), 'ongoing-bare-machine-'));
const catalog = join(directory, 'catalog.sqlite');
const roots = join(directory, 'roots');
const bin = join(directory, 'bin');
const configPath = join(directory, 'config.toml');

function which(command: string): string | null {
  const found = spawnSync('/usr/bin/which', [command], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : null;
}

const gitPath = which('git');

beforeAll(() => {
  mkdirSync(bin, { recursive: true });
  // Only git. td, cloc, and gh are deliberately absent.
  if (gitPath) symlinkSync(gitPath, join(bin, 'git'));
  const project = join(roots, 'solo');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'go.mod'), 'module example.test/solo\n\ngo 1.27\n');
  writeFileSync(join(project, 'README.md'), '# solo\n');
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
  // The endoflife provider is switched off rather than left to fail, so the scan touches no network.
  writeFileSync(
    configPath,
    ['[providers]', 'disabled = ["endoflife"]', '', '[host]', 'adapter = "foreground"', ''].join(
      '\n'
    )
  );
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('a machine with none of the optional tools', () => {
  it('decides availability from the manifests alone', () => {
    const file = parseConfigFile(['[providers]', 'disabled = ["endoflife"]'].join('\n'));
    const config = loadConfig({ HOST: '127.0.0.1' }, file);
    const probe = probeProviders(undefined, { PATH: bin });
    const states = resolveProviders((name) => config.providers.enabled.includes(name), probe);
    const byName = new Map(states.map((state) => [state.name, state]));

    expect(byName.get('td')).toMatchObject({ state: 'unavailable', reason: 'td is not on PATH' });
    expect(byName.get('loc')).toMatchObject({
      state: 'unavailable',
      reason: 'cloc is not on PATH'
    });
    expect(byName.get('github')).toMatchObject({
      state: 'unavailable',
      reason: 'gh is not on PATH'
    });
    expect(byName.get('endoflife')).toMatchObject({ state: 'disabled' });
    expect(activeProviders(states)).toEqual(['filesystem', 'git', 'stack', 'tech-signatures']);
  });

  it('completes a scan and records why each provider did not run', () => {
    expect(gitPath, 'git must exist for this test to mean anything').toBeTruthy();
    const scan = spawnSync(process.execPath, [resolve('src/lib/host/scan-command.ts')], {
      cwd: resolve('.'),
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        // Deliberately hostile: one tool, no token, no ambient configuration.
        PATH: bin,
        HOME: directory,
        TMPDIR: directory,
        DATABASE_PATH: catalog,
        SCAN_ROOTS: roots,
        ONGOING_CONFIG: configPath
      }
    });

    expect(scan.stderr, scan.stderr).not.toMatch(/Error|error:/);
    expect(scan.status).toBe(0);
    const result = JSON.parse(scan.stdout.trim().split('\n').at(-1)!) as {
      status: string;
      discoveredCount: number;
      errorCount: number;
    };
    expect(result).toMatchObject({ status: 'completed', discoveredCount: 1, errorCount: 0 });

    const database = new CatalogDatabase(catalog);
    try {
      const repository = new CatalogRepository(database);
      const runs = new Map(repository.listProviderRuns().map((run) => [run.provider, run]));
      expect(runs.get('filesystem')?.status).toBe('ok');
      expect(runs.get('git')?.status).toBe('ok');
      expect(runs.get('stack')?.status).toBe('ok');
      expect(runs.get('td')).toMatchObject({ status: 'unavailable', detail: 'td is not on PATH' });
      expect(runs.get('loc')).toMatchObject({
        status: 'unavailable',
        detail: 'cloc is not on PATH'
      });
      expect(runs.get('github')).toMatchObject({
        status: 'unavailable',
        detail: 'gh is not on PATH'
      });
      expect(runs.get('endoflife')).toMatchObject({
        status: 'disabled',
        detail: 'disabled in configuration'
      });

      // An unavailable provider contributes nothing rather than a warning: no collection error was
      // recorded for td, loc, or hosting, and the project still carries its git and stack data.
      const [project] = repository.listProjects();
      expect(project.name).toBe('solo');
      expect(repository.listCollectionErrors(project.id, true)).toEqual([]);
      expect(repository.getMetrics(project.id)?.commitCount).toBe(1);
      expect(repository.listProjectStacks(project.id)).toEqual([
        expect.objectContaining({ toolchain: 'go', declared: '1.27' })
      ]);
    } finally {
      database.close();
    }
  }, 120_000);
});
