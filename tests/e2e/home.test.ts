import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('loads the cached catalog and round-trips sort and search through the URL', async ({
  page
}) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.getByRole('link', { name: 'ongoing home' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Projects' })).toBeVisible();
  await expect(page.locator('[data-project-row]').first()).toContainText('alpha');

  await page.getByRole('button', { name: /sort name/i }).click();
  await page.getByRole('button', { name: /lines of code/i }).click();
  await expect(page).toHaveURL(/sort=linesOfCode/);
  await expect(page.locator('[data-project-row]').first()).toContainText('beta');

  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Filter projects' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Filter projects' }).fill('alpha');
  await expect(page).toHaveURL(/q=alpha/);
  await expect(page.locator('[data-project-row]')).toHaveCount(1);

  const api = await page.request.get(
    '/api/projects?sort=linesOfCode&dir=desc&filter=all&group=none'
  );
  expect(api.ok()).toBe(true);
  expect((await api.json()).visibleProjects[0].name).toBe('beta');
});

test('supports keyboard navigation, details, and persistent themes', async ({ page }) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page.keyboard.press('j');
  await expect(page.locator('[data-project-row]').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'beta details' })).toBeVisible();

  await page.getByRole('button', { name: 'ink theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
});

test('keeps metric meaning in the narrow catalog layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const github = page.locator('[data-project-row]').first().locator('.github');
  expect(await github.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
    '"github"'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
