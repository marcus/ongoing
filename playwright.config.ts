import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173'
  },
  webServer: {
    command:
      'DATABASE_PATH=.data/ongoing-e2e.sqlite SCAN_ROOTS=/private/tmp/ongoing-e2e-unscanned bun run tests/e2e/seed.ts && DATABASE_PATH=.data/ongoing-e2e.sqlite SCAN_ROOTS=/private/tmp/ongoing-e2e-unscanned bun run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI
  }
});
