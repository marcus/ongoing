import { describe, expect, it, vi } from 'vitest';
import { collectLocMetrics, parseClocJson } from './loc';
import type { CommandRunner } from './process';

const clocOutput = JSON.stringify({
  header: { cloc_url: 'example' },
  'src/main.ts': { language: 'TypeScript', blank: 2, comment: 3, code: 20 },
  'src/main.test.ts': { language: 'TypeScript', blank: 1, comment: 1, code: 8 },
  'scripts/tool.py': { language: 'Python', blank: 1, comment: 2, code: 10 },
  SUM: { blank: 4, comment: 6, code: 38 }
});

describe('LOC collection', () => {
  it('parses aggregate, dominant language, and reliably classified test LOC', () => {
    expect(parseClocJson(clocOutput)).toEqual({
      locCode: 38,
      locComment: 6,
      locBlank: 4,
      locFiles: 3,
      locTest: 8,
      dominantLanguage: 'TypeScript'
    });
  });

  it('skips cloc for an unchanged tracked-worktree fingerprint', async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue({
      command: ['cloc'],
      cwd: '/repo',
      exitCode: 0,
      stdout: clocOutput,
      stderr: '',
      timedOut: false
    });
    const fingerprint = vi
      .fn()
      .mockResolvedValueOnce('same')
      .mockResolvedValueOnce('same')
      .mockResolvedValueOnce('changed');

    const first = await collectLocMetrics('/repo', {
      runner,
      fingerprint,
      now: () => '2026-07-19T10:00:00.000Z'
    });
    const second = await collectLocMetrics('/repo', {
      runner,
      fingerprint,
      previousFingerprint: 'same'
    });
    const third = await collectLocMetrics('/repo', {
      runner,
      fingerprint,
      previousFingerprint: 'same'
    });

    expect(first.status).toBe('collected');
    expect(second).toEqual({ status: 'unchanged', fingerprint: 'same' });
    expect(third).toMatchObject({
      status: 'collected',
      metrics: { locFingerprint: 'changed' }
    });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenCalledWith(
      ['cloc', '--json', '--by-file', '--vcs', 'git'],
      expect.objectContaining({ cwd: '/repo' })
    );
  });

  it('reports cloc errors without manufacturing fresh metrics', async () => {
    const runner: CommandRunner = async (command, options) => ({
      command,
      cwd: options.cwd,
      exitCode: 2,
      stdout: '',
      stderr: 'cloc unavailable',
      timedOut: false
    });
    await expect(
      collectLocMetrics('/repo', { runner, fingerprint: async () => 'changed' })
    ).rejects.toThrow('cloc failed: cloc unavailable');
  });
});
