import { expect, test } from '@playwright/test';

test('shows the application foundation', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Choose what deserves your attention next.' })
  ).toBeVisible();
});
