import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The screen record in `docs/qa/screens/`. Skipped by default — it writes tracked files, and a
 * screenshot that changes on every unrelated run is noise rather than evidence. Regenerate with:
 *
 * ```sh
 * QA_SCREENSHOTS=1 E2E_PORT=7801 bun run test:e2e tests/e2e/screenshots.test.ts
 * ```
 */
const enabled = Boolean(process.env.QA_SCREENSHOTS);
const directory = resolve(import.meta.dirname, '../../docs/qa/screens');

test.describe('screen record', () => {
  test.skip(!enabled, 'set QA_SCREENSHOTS=1 to regenerate docs/qa/screens');
  test.use({ viewport: { width: 1440, height: 900 } });

  const screens: { name: string; go: (page: Page) => Promise<void> }[] = [
    {
      name: 'inventory',
      go: async (page) => {
        await page.goto('/');
      }
    },
    {
      name: 'inventory-panel',
      go: async (page) => {
        await page.goto('/?q=kind%3Aproject&entry=project%2Falpha');
      }
    },
    {
      name: 'inventory-columns',
      go: async (page) => {
        await page.goto('/?saved=attention');
        await page.getByRole('button', { name: /columns/i }).click();
      }
    },
    {
      name: 'fact-sheet-project',
      go: async (page) => {
        await page.goto('/p/alpha');
      }
    },
    {
      name: 'fact-sheet-technology',
      go: async (page) => {
        await page.goto('/t/go');
      }
    },
    {
      name: 'radar',
      go: async (page) => {
        await page.goto('/radar');
      }
    },
    {
      name: 'providers',
      go: async (page) => {
        await page.goto('/providers');
        await expect(page.getByRole('heading', { name: 'github', exact: true })).toBeVisible();
      }
    },
    {
      name: 'palette',
      go: async (page) => {
        await page.goto('/?q=kind%3Aproject');
        await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('textbox', { name: 'Command palette' }).fill('a');
      }
    }
  ];

  for (const theme of ['dark', 'light'] as const)
    for (const screen of screens)
      test(`${screen.name} · ${theme}`, async ({ page }) => {
        mkdirSync(directory, { recursive: true });
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
        await page.getByRole('button', { name: `${theme} theme` }).click();
        await screen.go(page);
        await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${directory}/${screen.name}-${theme}.png` });
      });
});
