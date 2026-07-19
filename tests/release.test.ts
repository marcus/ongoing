import { describe, expect, it } from 'vitest';
import {
  decodeReleaseConfig,
  encodeReleaseConfig,
  parseReleaseArgs,
  PRODUCTION_CHECKOUT,
  PRODUCTION_DATABASE,
  PRODUCTION_HOST,
  releasePlan
} from '../scripts/release-config';

const required = [
  '--host',
  PRODUCTION_HOST,
  '--checkout',
  PRODUCTION_CHECKOUT,
  '--database',
  PRODUCTION_DATABASE
];

describe('release tooling', () => {
  it('requires all three exact production targets', () => {
    expect(() => parseReleaseArgs([])).toThrow(/required explicit targets/);
    expect(() =>
      parseReleaseArgs([...required.slice(0, 1), 'root@example.test', ...required.slice(2)])
    ).toThrow(/host must be exactly/);
    expect(() =>
      parseReleaseArgs([...required.slice(0, 3), '/tmp/ongoing', ...required.slice(4)])
    ).toThrow(/checkout must be exactly/);
    expect(() => parseReleaseArgs([...required, '--unknown'])).toThrow(/unknown argument/);
  });

  it('round-trips only validated remote configuration', () => {
    const { config } = parseReleaseArgs(required);
    expect(decodeReleaseConfig(encodeReleaseConfig(config))).toEqual(config);
    expect(() => decodeReleaseConfig('not valid config!')).toThrow(/base64url/);
  });

  it('makes destructive rollback restoration opt-in and documents bounded operations', () => {
    const { config } = parseReleaseArgs([...required, '--dry-run']);
    expect(releasePlan('deploy', config)).toEqual(
      expect.arrayContaining(['fetch origin main and fast-forward only', 'record deployed SHA'])
    );
    expect(releasePlan('rollback', config)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('restore')])
    );
    expect(releasePlan('rollback', config, true)).toEqual(
      expect.arrayContaining([expect.stringContaining('restore')])
    );
  });
});
