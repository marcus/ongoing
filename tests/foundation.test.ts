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
  it('keeps the core free of the deployment profile', () => {
    const offenders = ['src', 'bin', 'scripts', 'tests/e2e']
      .flatMap(sourceFiles)
      .filter((path) => /from\s+['"][^'"]*deploy\/aerie/.test(readFileSync(resolve(path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
