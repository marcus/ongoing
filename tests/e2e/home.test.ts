import { expect, test } from '@playwright/test';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(color: string): number {
  const value = color.trim();
  const [red, green, blue] = value.startsWith('#')
    ? [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map((part) =>
        Number.parseInt(part, 16)
      )
    : value.match(/\d+/g)!.slice(0, 3).map(Number);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

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

test('accepts every planned sort in URL state and exposes its semantic label', async ({ page }) => {
  const sorts = [
    ['manual', 'manual'],
    ['latestCommit', 'latest commit'],
    ['commits30d', 'commits 30d'],
    ['activeDays30d', 'active days'],
    ['linesOfCode', 'lines of code'],
    ['lifetimeCommits', 'lifetime commits'],
    ['openTdIssues', 'td open'],
    ['githubStars', 'github stars'],
    ['githubStarsGained30d', '★ gained 30d'],
    ['githubOpenPrs', 'open prs'],
    ['githubOldestExternalPr', 'oldest external pr'],
    ['githubTraffic', 'github traffic'],
    ['name', 'name']
  ] as const;

  for (const [key, label] of sorts) {
    await page.goto(`/?sort=${key}&dir=asc&filter=all&group=none`);
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
    await expect(
      page.getByRole('button', { name: new RegExp(`sort ${label}`, 'i') })
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`sort=${key}`));
  }
});

test('streams scan completion without dropping catalog or URL state', async ({ page }) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none&q=alpha');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Filter projects' });
  await search.focus();

  const eventStream = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/scan/events'
  );
  await page.getByRole('button', { name: 'rescan' }).click();
  await eventStream;
  await expect(page.getByRole('status').filter({ hasText: /scan complete|completed/ })).toBeVisible(
    {
      timeout: 15_000
    }
  );
  await expect(page).toHaveURL(/q=alpha/);
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
});

test('provides visible keyboard focus, reduced motion, and a recoverable empty result', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to project catalog' })).toBeFocused();
  expect(
    await page
      .getByRole('link', { name: 'Skip to project catalog' })
      .evaluate((element) => getComputedStyle(element).outlineStyle)
  ).not.toBe('none');
  expect(
    await page.locator('.scanline i').evaluate((element) => getComputedStyle(element).animationName)
  ).toBe('none');

  const search = page.getByRole('searchbox', { name: 'Filter projects' });
  await search.fill('no-project-has-this-name');
  await expect(page.getByText('No projects match this view.')).toBeVisible();
  await page.getByRole('button', { name: 'clear filters' }).click();
  await expect(page.getByRole('list', { name: 'Projects' })).toBeVisible();
});

test('keeps every text hierarchy token above normal-text contrast in all themes', async ({
  page
}) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  for (const theme of ['ember', 'ink', 'paper', 'moss', 'port']) {
    await page.getByRole('button', { name: `${theme} theme` }).click();
    const colors = await page.locator('html').evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        background: styles.getPropertyValue('--bg'),
        text: styles.getPropertyValue('--ink'),
        dim: styles.getPropertyValue('--ink-dim'),
        faint: styles.getPropertyValue('--ink-faint')
      };
    });
    for (const foreground of [colors.text, colors.dim, colors.faint]) {
      expect(
        contrast(foreground, colors.background),
        `${theme}: ${foreground}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
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

test('renders TD counts, freshness, stale warnings, and attention membership', async ({ page }) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const alpha = page.locator('[data-project-row]').filter({ hasText: 'alpha' });
  const td = alpha.locator('[data-label="td"]');
  await expect(td).toContainText('4');
  await expect(td).toContainText('1blk');
  await expect(td).toHaveAttribute(
    'title',
    /TD collected .* · 2 open · 1 in progress · 1 in review/
  );
  await expect(alpha.locator('[title="1 stale TD issues"]')).toBeVisible();

  await alpha.click();
  const drawer = page.getByRole('region', { name: 'alpha details' });
  await expect(drawer).toContainText('td open / blocked / review');
  await expect(drawer).toContainText('td in progress / stale');
  await expect(drawer).toContainText('td collected');

  await page.goto('/?view=attention&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('[data-project-row]').filter({ hasText: 'alpha' })).toBeVisible();
  await alpha.click();
  await expect(page.getByRole('region', { name: 'needs attention reasons' })).toContainText(
    'tdBlockedCount: 1 > 0'
  );
});

test('navigates attention views with counts, history, search, and favorite grouping', async ({
  page
}) => {
  await page.goto('/?sort=name&dir=asc&filter=all&group=favorites&q=a');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: /sort name/i }).click();
  await expect(page.getByRole('button', { name: /needs attention 2/i })).toBeVisible();
  await page.getByRole('button', { name: /needs attention 2/i }).click();
  await expect(page).toHaveURL(/view=attention/);
  await expect(page).toHaveURL(/q=a/);
  await expect(page).toHaveURL(/group=favorites/);
  await expect(page.locator('[data-project-row]').first()).toContainText('alpha');

  await page.getByRole('button', { name: /rising 1/i }).click();
  await expect(page).toHaveURL(/view=rising/);
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/view=attention/);
});

test('recomputes decision-driven views, counts, and reasons without a reload', async ({ page }) => {
  await page.goto('/?sort=name&dir=asc&view=dormant&filter=all&group=none');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const dormant = page.locator('[data-project-row]').filter({ hasText: 'dormant' });
  await expect(dormant).toBeVisible();
  await dormant.click();
  await expect(page.getByRole('region', { name: 'dormant reasons' })).toContainText(
    'Project is not marked invest'
  );

  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'PATCH' && /\/api\/projects\//.test(candidate.url())
  );
  await page.getByLabel('Intent for dormant').selectOption('invest');
  expect((await response).status()).toBe(200);

  await expect(page.locator('[data-project-row]')).toHaveCount(0);
  await expect(page.getByText('No projects match this view.')).toBeVisible();
  await page.getByRole('button', { name: /sort name/i }).click();
  await expect(page.getByRole('button', { name: /dormant 0/i })).toBeVisible();
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
  const noteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await note.blur();
  expect((await noteResponse).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'saved locally' }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page.locator('[data-project-row]').filter({ hasText: 'beta' }).click();
  await expect(page.getByRole('textbox', { name: 'Note for beta' })).toHaveValue(
    'ship after the catalog settles'
  );

  let decisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await page.getByLabel('Intent for beta').selectOption('invest');
  expect((await decisionResponse).status()).toBe(200);
  decisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await page.getByLabel('Excitement for beta').selectOption('5');
  expect((await decisionResponse).status()).toBe(200);
  decisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await page.getByLabel('Strategic importance for beta').selectOption('4');
  expect((await decisionResponse).status()).toBe(200);
  await page.getByLabel('Next action for beta').fill('publish the catalog release');
  decisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await page.getByLabel('Next action for beta').blur();
  expect((await decisionResponse).status()).toBe(200);
  decisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/projects\//.test(response.url())
  );
  await page.getByLabel('Review after for beta').fill('2026-08-15');
  expect((await decisionResponse).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'saved locally' })).toHaveCount(2);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page.locator('[data-project-row]').filter({ hasText: 'beta' }).click();
  await expect(page.getByLabel('Intent for beta')).toHaveValue('invest');
  await expect(page.getByLabel('Excitement for beta')).toHaveValue('5');
  await expect(page.getByLabel('Strategic importance for beta')).toHaveValue('4');
  await expect(page.getByLabel('Next action for beta')).toHaveValue('publish the catalog release');
  await expect(page.getByLabel('Review after for beta')).toHaveValue('2026-08-15');

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
  await expect(page.getByRole('listitem').filter({ hasText: 'beta' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'manual-notes' })).toHaveCount(0);
  await page.getByRole('button', { name: /beta/ }).first().click();
  await expect(page.getByRole('region', { name: 'beta details' })).toBeVisible();
  await page.getByRole('button', { name: 'restore' }).first().click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.goto('/?sort=manual&dir=asc&filter=all&group=none');
  await expect(page.locator('[data-project-row]').last()).toContainText('beta');

  const trustedHeaders = { origin: 'http://127.0.0.1:5173' };
  const unknownFavorite = await page.request.post('/api/projects/not-a-database-id/favorite', {
    headers: trustedHeaders,
    data: { favorite: true }
  });
  expect(unknownFavorite.status()).toBe(404);
  const forgedPath = await page.request.post('/api/projects/not-a-database-id', {
    headers: trustedHeaders,
    data: { action: 'finder', path: '/etc' }
  });
  expect(forgedPath.status()).toBe(400);
  const longNote = await page.request.patch('/api/projects/not-a-database-id', {
    headers: trustedHeaders,
    data: { note: 'x'.repeat(501) }
  });
  expect(longNote.status()).toBe(400);
  const invalidDecision = await page.request.patch('/api/projects/not-a-database-id', {
    headers: trustedHeaders,
    data: { excitement: 6 }
  });
  expect(invalidDecision.status()).toBe(400);
  const invalidDate = await page.request.patch('/api/projects/not-a-database-id', {
    headers: trustedHeaders,
    data: { reviewAfter: 'tomorrow' }
  });
  expect(invalidDate.status()).toBe(400);
  const duplicateOrder = await page.request.post('/api/projects/reorder', {
    headers: trustedHeaders,
    data: { orderedIds: ['duplicate', 'duplicate'] }
  });
  expect(duplicateOrder.status()).toBe(400);
});
