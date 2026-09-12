import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(directory)).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(resolve(path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte|js)$/.test(entry) ? [path] : [];
  });
}

describe('application foundation', () => {
  const pinned = readFileSync(resolve('.bun-version'), 'utf8').trim();

  it('declares the exact Bun runtime in .bun-version alone', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    // Everything else names the stable executable that provision-runtime.sh points at this version,
    // so a bump is a one-line change. Fail loudly if the version is written down anywhere else.
    for (const derived of [
      'package.json',
      'bin/ongoing',
      'deploy/aerie/config/ongoing.plist.example',
      'deploy/aerie/config/ongoing-scan.plist.example',
      'deploy/aerie/provision-runtime.sh',
      'deploy/aerie/release-config.ts',
      'deploy/aerie/remote-release.ts',
      'AGENTS.md',
      'README.md',
      'docs/deployment.md',
      'deploy/aerie/README.md',
      'docs/cli.md',
      'docs/qa/release-coverage.md'
    ]) {
      const content = readFileSync(resolve(derived), 'utf8');
      expect(content, `${derived} restates the pinned Bun version`).not.toMatch(
        new RegExp(`bun[@/ ]${pinned.replaceAll('.', '\\.')}`, 'i')
      );
    }
  });

  /**
   * Deployment is a profile, not part of the application (ADR 0007). `deploy/aerie/` may import the
   * core; the core may never import `deploy/`, or a second machine would have to fork it.
   */
  it('keeps the core free of every deployment profile', () => {
    const offenders = ['src', 'bin', 'scripts', 'tests']
      .flatMap(sourceFiles)
      .filter((path) => /from\s+['"][^'"]*\bdeploy\//.test(readFileSync(resolve(path), 'utf8')));
    expect(offenders).toEqual([]);
  });

  /**
   * The core has to run on a machine that is not the author's. Anything naming one person, one
   * host, or one home directory belongs in a deployment profile or an export profile.
   */
  it('carries no machine-specific strings outside the profiles that own them', () => {
    const machineSpecific = /marcus|vorwaller|aerie|\/Users\//i;
    const offenders = ['src', 'bin', 'scripts', 'tests']
      .flatMap(sourceFiles)
      .filter((path) => path !== 'tests/foundation.test.ts')
      .filter((path) => machineSpecific.test(readFileSync(resolve(path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
