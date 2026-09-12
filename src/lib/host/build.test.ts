import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApplication, pinBuild } from './build';
import type { HostCommandRunner } from './adapter';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'ongoing-build-'));
  roots.push(path);
  return path;
}
function build(content: string, status = 0): HostCommandRunner {
  return (_command, _args, options) => {
    const output = options!.env!.ONGOING_BUILD_OUTPUT!;
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'handler.js'), content);
    return { status, stdout: '', stderr: '' };
  };
}

describe('production build lifecycle', () => {
  it('keeps a pinned build and its lazy chunks intact through subsequent builds', () => {
    const path = root();
    expect(buildApplication(path, build('first'))).toBe(0);
    const pinned = pinBuild(path);
    writeFileSync(join(pinned, 'lazy.js'), 'old lazy route');
    expect(buildApplication(path, build('second'))).toBe(0);
    expect(readFileSync(join(pinned, 'handler.js'), 'utf8')).toBe('first');
    expect(readFileSync(join(pinned, 'lazy.js'), 'utf8')).toBe('old lazy route');
    expect(readFileSync(join(pinBuild(path), 'handler.js'), 'utf8')).toBe('second');
  });

  it('never publishes a failed or incomplete build', () => {
    const path = root();
    buildApplication(path, build('working'));
    const before = realpathSync(join(path, 'build'));
    expect(buildApplication(path, build('partial', 1))).toBe(1);
    expect(realpathSync(join(path, 'build'))).toBe(before);
    expect(() => buildApplication(path, () => ({ status: 0, stdout: '', stderr: '' }))).toThrow(
      'handler.js'
    );
    expect(realpathSync(join(path, 'build'))).toBe(before);
  });

  it('preserves an old directory installation during its first upgrade', () => {
    const path = root();
    mkdirSync(join(path, 'build'));
    writeFileSync(join(path, 'build/handler.js'), 'legacy');
    const pinned = pinBuild(path);
    expect(() => buildApplication(path, build('upgraded'))).toThrow('Legacy build directory');
    expect(readFileSync(join(pinned, 'handler.js'), 'utf8')).toBe('legacy');
    expect(readFileSync(join(path, 'build/handler.js'), 'utf8')).toBe('legacy');
  });

  it('refuses overlapping builds before running Vite', () => {
    const path = root();
    mkdirSync(join(path, '.ongoing-builds/build.lock'), { recursive: true });
    expect(() => buildApplication(path, build('unused'))).toThrow('Another build');
  });
});
