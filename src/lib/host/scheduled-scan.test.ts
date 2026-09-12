import { describe, expect, it } from 'vitest';
import { scheduledScanArgs } from './scheduled-scan';

describe('scheduled scan transport', () => {
  it('waits for the deployed scanner over HTTP with structured results', () => {
    expect(scheduledScanArgs(['--cheap', '--project', 'demo'])).toEqual([
      'scan',
      '--cheap',
      'demo',
      '--transport',
      'http',
      '--wait',
      '--json'
    ]);
  });
  it('cannot be steered into opening the local catalog', () => {
    for (const args of [['--local'], ['--transport', 'local'], ['--project'], ['--project', '--']])
      expect(() => scheduledScanArgs(args)).toThrow('scheduled scan argument');
  });
});
