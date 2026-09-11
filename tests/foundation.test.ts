import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('application foundation', () => {
  const pinned = readFileSync(resolve('.bun-version'), 'utf8').trim();

  it('declares the exact Bun runtime in .bun-version alone', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    // Everything else names the stable executable that provision-runtime.sh points at this version,
    // so a bump is a one-line change. Fail loudly if the version is written down anywhere else.
    for (const derived of [
      'package.json',
      'bin/ongoing',
      'config/ongoing.plist.example',
      'config/ongoing-scan.plist.example',
      'scripts/provision-runtime.sh',
      'scripts/release-config.ts',
      'scripts/remote-release.ts',
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
});
