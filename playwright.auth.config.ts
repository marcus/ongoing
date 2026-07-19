import { defineConfig } from '@playwright/test';

const secret = 'browser-auth-test-secret';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command: `bun run build && HOST=127.0.0.1 ONGOING_REQUIRE_AUTH=true PORT=5174 ORIGIN=http://127.0.0.1:5174 APP_ORIGIN=http://127.0.0.1:5174 ONGOING_ACCESS_SECRET=${secret} BODY_SIZE_LIMIT=16384 MAX_REQUEST_BYTES=16384 DATABASE_PATH=.data/ongoing-auth-e2e.sqlite SCAN_ROOTS=/private/tmp/ongoing-auth-e2e-unscanned bun build/index.js`,
    url: 'http://127.0.0.1:5174/api/health',
    reuseExistingServer: false
  }
});
