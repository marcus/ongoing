import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

function event(request: Request) {
  const clear = vi.fn();
  return {
    input: { request, cookies: { delete: clear } } as never,
    clear
  };
}

describe('logout request body boundary', () => {
  it.each([
    ['fixed-length', { 'content-length': '20000' }],
    ['chunked', { 'transfer-encoding': 'chunked' }]
  ])('rejects an oversized %s body before clearing the session', async (_name, headers) => {
    const { input, clear } = event(
      new Request('http://aerie.local:7766/logout', {
        method: 'POST',
        headers,
        body: 'x'.repeat(20_000)
      })
    );
    const response = await POST(input);
    expect(response).toMatchObject({ status: 413 });
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears the session and redirects for a bodyless logout', async () => {
    const { input, clear } = event(
      new Request('http://aerie.local:7766/logout', { method: 'POST' })
    );
    await expect(POST(input)).rejects.toMatchObject({ status: 303, location: '/login' });
    expect(clear).toHaveBeenCalledOnce();
  });
});
