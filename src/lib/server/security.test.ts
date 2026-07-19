import { describe, expect, it } from 'vitest';
import {
  constantTimeSecretMatches,
  createSessionToken,
  bufferRequestBodyWithinLimit,
  isSameOriginMutation,
  sessionCookieOptions,
  verifySessionToken
} from './security';

const secret = 'this-is-a-test-secret';

describe('LAN sessions', () => {
  it('compares access secrets without direct string equality', () => {
    expect(constantTimeSecretMatches(secret, secret)).toBe(true);
    expect(constantTimeSecretMatches('this-is-a-wrong-secret', secret)).toBe(false);
    expect(constantTimeSecretMatches('', secret)).toBe(false);
  });

  it('accepts signed live tokens and rejects expiry, tampering, and malformed input', () => {
    const token = createSessionToken(secret, 2_000);
    expect(verifySessionToken(token, secret, 1_999)).toBe(true);
    expect(verifySessionToken(token, secret, 2_000)).toBe(false);
    expect(verifySessionToken(`${token.slice(0, -1)}x`, secret, 1_999)).toBe(false);
    expect(verifySessionToken(token, 'different-test-secret', 1_999)).toBe(false);
    expect(verifySessionToken('malformed', secret, 1_999)).toBe(false);
  });

  it('uses strict, HTTP-only cookies without Secure on trusted LAN HTTP', () => {
    expect(
      sessionCookieOptions({
        authenticationRequired: true,
        accessSecret: secret,
        sessionMaxAgeSeconds: 60,
        cookieSecure: false,
        maxRequestBytes: 1024
      })
    ).toEqual({ path: '/', httpOnly: true, sameSite: 'strict', secure: false, maxAge: 60 });
  });

  it('requires exact origin on every mutation', () => {
    expect(isSameOriginMutation(new Request('http://aerie.local:4173/api/projects'))).toBe(true);
    expect(
      isSameOriginMutation(
        new Request('http://aerie.local:4173/api/projects', {
          method: 'POST',
          headers: { origin: 'http://aerie.local:4173' }
        })
      )
    ).toBe(true);
    expect(
      isSameOriginMutation(
        new Request('http://aerie.local:4173/api/projects', {
          method: 'POST',
          headers: { origin: 'http://attacker.test' }
        })
      )
    ).toBe(false);
    const opaqueLogin = new Request('http://aerie.local:4173/login', {
      method: 'POST',
      headers: { origin: 'null' }
    });
    expect(isSameOriginMutation(opaqueLogin)).toBe(false);
    expect(
      isSameOriginMutation(
        new Request('http://aerie.local:4173/login', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'same-origin' }
        })
      )
    ).toBe(true);
    expect(
      isSameOriginMutation(new Request('http://aerie.local:4173/api/scan', { method: 'POST' }))
    ).toBe(false);
    expect(
      isSameOriginMutation(
        new Request('http://127.0.0.1/api/projects', {
          method: 'POST',
          headers: { origin: 'http://aerie.local:4173' }
        }),
        'http://aerie.local:4173'
      )
    ).toBe(true);
  });

  it('measures actual body bytes when content length is absent or false', async () => {
    expect(
      await bufferRequestBodyWithinLimit(
        new Request('http://aerie.local/api/scan', {
          method: 'POST',
          headers: { 'transfer-encoding': 'chunked' },
          body: 'bounded-but-unsupported'
        }),
        100
      )
    ).toBeNull();
    const missing = new Request('http://aerie.local/api/scan', {
      method: 'POST',
      body: 'x'.repeat(17)
    });
    missing.headers.delete('content-length');
    expect(await bufferRequestBodyWithinLimit(missing, 16)).toBeNull();

    const lying = new Request('http://aerie.local/api/scan', {
      method: 'POST',
      headers: { 'content-length': '1' },
      body: 'x'.repeat(17)
    });
    expect(await bufferRequestBodyWithinLimit(lying, 16)).toBeNull();
    const bounded = await bufferRequestBodyWithinLimit(
      new Request('http://aerie.local/login', {
        method: 'POST',
        headers: { 'content-length': '14' },
        body: 'secret=bounded'
      }),
      1_024
    );
    expect(await bounded?.text()).toBe('secret=bounded');
    expect(bounded?.headers.get('content-length')).toBe('14');
  });
});
