import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  productionBodyLimit,
  productionRequestBodyLimit,
  readBoundedBody
} from '$lib/host/production-server';

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

  it('allows large attachment imports without widening ordinary mutation routes', async () => {
    const body = Buffer.alloc(652_166);
    const attachmentLimit = productionRequestBodyLimit(
      '/api/attachments/project_123/identity.logo',
      16_384
    );
    expect(attachmentLimit).toBe(16 * 1024 * 1024);
    expect(
      await readBoundedBody(
        Readable.from([body]),
        { 'content-length': String(body.length) },
        attachmentLimit
      )
    ).toHaveLength(body.length);
    expect(
      await readBoundedBody(
        Readable.from([body]),
        { 'content-length': String(body.length) },
        productionRequestBodyLimit('/api/entries/project/ongoing', 16_384)
      )
    ).toBeNull();
  });
});
