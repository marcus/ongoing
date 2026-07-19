import { expect, test } from '@playwright/test';

test.skip(!process.env.AUTH_E2E, 'run with bun run test:e2e:auth');

test('LAN authentication protects the catalog and logout clears the session', async ({ page }) => {
  const anonymous = await page.request.get('/api/projects');
  expect(anonymous.status()).toBe(401);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Access secret').fill('wrong-secret-value');
  await page.getByRole('button', { name: /enter dashboard/i }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted');
  await page.getByLabel('Access secret').fill('browser-auth-test-secret');
  await page.getByRole('button', { name: /enter dashboard/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(() => fetch('/logout', { method: 'POST' }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
