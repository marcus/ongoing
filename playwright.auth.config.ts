import { defineConfig } from '@playwright/test';

const secret = 'browser-auth-test-secret';
const port = Number(process.env.E2E_PORT ?? '5174');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: origin },
  webServer: {
    command: `bun run build && HOST=127.0.0.1 ONGOING_REQUIRE_AUTH=true PORT=${port} ORIGIN=${origin} APP_ORIGIN=${origin} ONGOING_ACCESS_SECRET=${secret} BODY_SIZE_LIMIT=16384 MAX_REQUEST_BYTES=16384 DATABASE_PATH=/private/tmp/ongoing-auth-e2e-${port}.sqlite SCAN_ROOTS=/private/tmp/ongoing-auth-e2e-unscanned bun build/index.js`,
    url: `${origin}/api/health`,
    reuseExistingServer: false
  }
});
