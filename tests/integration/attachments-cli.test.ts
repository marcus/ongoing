import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';
import { transparentPng } from '../fixtures/png';

const directories: string[] = [];
async function cli(databasePath: string, ...args: string[]) {
  const child = Bun.spawn(['bun', 'run', 'bin/ongoing.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: databasePath },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (status !== 0) throw new Error(stderr || stdout);
  return stdout.trim();
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('attachment CLI', () => {
  it('sets, gets, and exports through the local API contract', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ongoing-cli-attachment-'));
    directories.push(directory);
    const databasePath = join(directory, 'catalog.sqlite');
    const database = new CatalogDatabase(databasePath);
    const repository = new CatalogRepository(database);
    const entry = await repository.upsertDiscovered({
      canonicalPath: '/code/ongoing',
      relativePath: 'ongoing',
      name: 'Ongoing',
      scanRoot: '/code'
    });
    await repository.upsertDiscovered({
      canonicalPath: '/code/without-logo',
      relativePath: 'without-logo',
      name: 'Without Logo',
      scanRoot: '/code'
    });
    database.close();
    const document = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/impressions-logo-v1.json'), 'utf8')
    );
    const bundle = {
      kind: 'impressions.logo.bundle',
      version: 1,
      document,
      poster: {
        mediaType: 'image/png',
        base64: transparentPng().toString('base64')
      }
    };
    const bundlePath = join(directory, 'input.json');
    writeFileSync(bundlePath, JSON.stringify(bundle));
    const saved = JSON.parse(
      await cli(
        databasePath,
        'attachment',
        'set',
        entry.id,
        '--field',
        'identity.logo',
        '--file',
        bundlePath,
        '--expected',
        'none',
        '--local',
        '--json'
      )
    );
    expect(saved).toMatchObject({
      entry: entry.id,
      field: 'identity.logo',
      document,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    const current = JSON.parse(
      await cli(
        databasePath,
        'attachment',
        'get',
        entry.id,
        '--field',
        'identity.logo',
        '--local',
        '--json'
      )
    );
    expect(current).toMatchObject({ revision: saved.revision, document });
    expect(await cli(databasePath, 'list', 'identity.logo:*', '--local', '--count')).toBe('1');
    expect(await cli(databasePath, 'list', 'identity.logo:none', '--local', '--count')).toBe('1');
    const output = join(directory, 'export');
    const exported = JSON.parse(
      await cli(
        databasePath,
        'attachment',
        'export',
        entry.id,
        '--field',
        'identity.logo',
        '--output',
        output,
        '--local',
        '--json'
      )
    );
    expect(exported.files).toEqual(['manifest.json', 'poster.png', 'bundle.json']);
    expect(JSON.parse(readFileSync(join(output, 'bundle.json'), 'utf8'))).toEqual(bundle);
  });
});
