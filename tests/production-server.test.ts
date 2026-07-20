import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { productionBodyLimit, readBoundedBody } from '../scripts/production-server';

describe('raw production request body boundary', () => {
  it('rejects an oversized declared body before forwarding it', async () => {
    expect(
      await readBoundedBody(Readable.from(['not-consumed']), { 'content-length': '16385' }, 16_384)
    ).toBeNull();
  });

  it('counts raw chunk bytes when no content length exists', async () => {
    expect(
      await readBoundedBody(
        Readable.from([Buffer.alloc(9_000), Buffer.alloc(9_000)]),
        {
          'transfer-encoding': 'chunked'
        },
        16_384
      )
    ).toBeNull();
  });

  it('replays a bounded body exactly', async () => {
    const body = await readBoundedBody(
      Readable.from([Buffer.from('secret='), Buffer.from('bounded')]),
      { 'transfer-encoding': 'chunked' },
      1_024
    );
    expect(body?.toString()).toBe('secret=bounded');
  });

  it('validates the production limit', () => {
    expect(productionBodyLimit('16384')).toBe(16_384);
    expect(() => productionBodyLimit('0')).toThrow(/positive integer/);
    expect(() => productionBodyLimit('16K')).toThrow(/positive integer/);
  });
});
