import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

describe('application foundation', () => {
  it('declares the exact Bun runtime used by the project', () => {
    expect(packageJson.packageManager).toBe('bun@1.3.1');
    expect(packageJson.engines.bun).toBe('1.3.1');
  });
});
