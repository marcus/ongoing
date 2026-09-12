import { defineConfig } from '@playwright/test';

// 5173 is Vite's default and is often already taken by another project on this machine, and
// `reuseExistingServer` will happily talk to whatever answers there. `E2E_PORT` moves the whole
// run — server and baseURL together — to a port that is free, and --strictPort makes a collision
// fail loudly instead of silently testing a stranger's app.
const port = Number(process.env.E2E_PORT ?? 5173);
const environment = `DATABASE_PATH=.data/ongoing-e2e.sqlite SCAN_ROOTS=/private/tmp/ongoing-e2e-unscanned`;

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`
  },
  webServer: {
    command: `${environment} bun run tests/e2e/seed.ts && ${environment} bun run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI
  }
});
