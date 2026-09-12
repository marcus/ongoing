import { defineConfig } from '@playwright/test';

// 5173 is Vite's default and is often already taken by another project on this machine, and
// `reuseExistingServer` will happily talk to whatever answers there. `E2E_PORT` moves the whole
// run — server and baseURL together — to a port that is free, and --strictPort makes a collision
// fail loudly instead of silently testing a stranger's app.
//
// `--strictPort` only binds this run's server, though: when something is already listening,
// `reuseExistingServer` never starts one and the whole suite tests the stranger anyway (it did,
// against a Fractal server squatting on the chosen port). Naming a port is an explicit statement
// about where this run belongs, so it turns reuse off and the collision fails loudly as intended.
const port = Number(process.env.E2E_PORT ?? 5173);
const reuseExistingServer = !process.env.CI && !process.env.E2E_PORT;
const environment = `DATABASE_PATH=.data/ongoing-e2e.sqlite SCAN_ROOTS=/private/tmp/ongoing-e2e-unscanned`;

export default defineConfig({
  testDir: './tests/e2e',
  // One worker. Every test in this suite shares one seeded catalog and several of them mutate it —
  // a favourite, an intent, a saved view — and then check the CLI sees the change against the same
  // server. Run in parallel and a `is_favorite:true` count means whatever another worker was in the
  // middle of doing. The suite is seconds long; a shared, mutable fixture is worth more here than
  // the parallelism.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`
  },
  webServer: {
    command: `${environment} bun run tests/e2e/seed.ts && ${environment} bun run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer
  }
});
