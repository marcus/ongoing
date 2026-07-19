import { describe, expect, it } from 'vitest';
import { isLoopbackHost, loadConfig } from './config';

describe('listener security configuration', () => {
  it.each(['localhost', '127.0.0.1', '127.42.9.3', '::1', '[::1]'])(
    'recognizes %s as loopback',
    (host) => expect(isLoopbackHost(host)).toBe(true)
  );

  it.each(['0.0.0.0', '192.168.1.8', 'aerie.local', '128.0.0.1', '127.0.0.999'])(
    'recognizes %s as non-loopback',
    (host) => expect(isLoopbackHost(host)).toBe(false)
  );

  it('keeps loopback auth-free by default', () => {
    expect(loadConfig({ HOST: '127.0.0.1' }).security).toMatchObject({
      authenticationRequired: false,
      cookieSecure: false,
      maxRequestBytes: 16_384
    });
  });

  it('can force authentication on loopback for production-adapter verification', () => {
    expect(
      loadConfig({
        HOST: '127.0.0.1',
        ONGOING_REQUIRE_AUTH: 'true',
        ONGOING_ACCESS_SECRET: 'a-sufficiently-long-secret'
      }).security.authenticationRequired
    ).toBe(true);
  });

  it('fails closed for a LAN listener without a strong secret', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/required/);
    expect(() => loadConfig({ HOST: '0.0.0.0', ONGOING_ACCESS_SECRET: 'short' })).toThrow(
      /at least 16/
    );
  });

  it('uses an HTTP-compatible cookie for the configured trusted-LAN origin', () => {
    const config = loadConfig({
      HOST: '0.0.0.0',
      ONGOING_ACCESS_SECRET: 'a-sufficiently-long-secret',
      APP_ORIGIN: 'http://aerie.local:4173'
    });
    expect(config.security).toMatchObject({ authenticationRequired: true, cookieSecure: false });
  });

  it('validates origins, booleans, and numeric request limits', () => {
    expect(() => loadConfig({ APP_ORIGIN: 'http://example.test/path' })).toThrow(/origin/);
    expect(() => loadConfig({ SESSION_COOKIE_SECURE: 'yes' })).toThrow(/true or false/);
    expect(() => loadConfig({ MAX_REQUEST_BYTES: '0' })).toThrow(/positive integer/);
  });
});
