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

test('persists personal organization controls and rejects forged mutations', async ({ page }) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

  const betaRow = page.locator('[data-project-row]').filter({ hasText: 'beta' });
  const favoriteResponse = page.waitForResponse((response) => response.url().endsWith('/favorite'));
  await betaRow.getByRole('button', { name: 'Favorite beta' }).click();
  expect((await favoriteResponse).status()).toBe(200);
  await expect(betaRow.getByRole('button', { name: 'Unfavorite beta' })).toBeVisible();

  await betaRow.click();
  const note = page.getByRole('textbox', { name: 'Note for beta' });
  await note.fill('ship after the catalog settles');
  await note.blur();
  await expect(page.getByRole('status').filter({ hasText: 'saved locally' })).toBeVisible();
  await page.reload();
  await page.locator('[data-project-row]').filter({ hasText: 'beta' }).click();
  await expect(page.getByRole('textbox', { name: 'Note for beta' })).toHaveValue(
    'ship after the catalog settles'
  );

  await page.goto('/?sort=manual&dir=asc&filter=all&group=none');
  const alphaHandle = page.getByRole('button', { name: 'Drag alpha to reorder' });
  const betaHandle = page.getByRole('button', { name: 'Drag beta to reorder' });
  await betaHandle.dragTo(alphaHandle);
  await expect(page.locator('[data-project-row]').first()).toContainText('beta');
  await page.reload();
  await expect(page.locator('[data-project-row]').first()).toContainText('beta');

  await page
    .locator('[data-project-row]')
    .first()
    .getByRole('button', { name: 'Actions for beta' })
    .click();
  await page.getByRole('button', { name: 'move to bottom' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-project-row]').last()).toContainText('beta');

  await page
    .locator('[data-project-row]')
    .last()
    .getByRole('button', { name: 'Actions for beta' })
    .click();
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('[data-project-row]').filter({ hasText: 'beta' })).toHaveCount(0);
  await page.goto('/hidden');
  await page.getByRole('searchbox', { name: 'Search hidden projects' }).fill('catalog settles');
  await expect(page.getByRole('listitem')).toContainText('beta');
  await page.getByRole('button', { name: /beta/ }).first().click();
  await expect(page.getByRole('region', { name: 'beta details' })).toBeVisible();
  await page.getByRole('button', { name: 'restore' }).first().click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.goto('/?sort=manual&dir=asc&filter=all&group=none');
  await expect(page.locator('[data-project-row]').last()).toContainText('beta');

  const unknownFavorite = await page.request.post('/api/projects/not-a-database-id/favorite', {
    data: { favorite: true }
  });
  expect(unknownFavorite.status()).toBe(404);
  const forgedPath = await page.request.post('/api/projects/not-a-database-id', {
    data: { action: 'finder', path: '/etc' }
  });
  expect(forgedPath.status()).toBe(400);
  const longNote = await page.request.patch('/api/projects/not-a-database-id', {
    data: { note: 'x'.repeat(501) }
  });
  expect(longNote.status()).toBe(400);
  const duplicateOrder = await page.request.post('/api/projects/reorder', {
    data: { orderedIds: ['duplicate', 'duplicate'] }
  });
  expect(duplicateOrder.status()).toBe(400);
});
