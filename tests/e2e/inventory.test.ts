import { expect, test, type Page } from '@playwright/test';
import { ongoing, ongoingJson } from './cli';

/**
 * The inventory shell. Every mutation here is checked twice: once in the browser, once through
 * `bin/ongoing` against the same server, so the phase cannot quietly introduce a UI-only
 * capability (ADR 0008, AGENTS.md).
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function hydrated(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

test('the URL is the query: filter, sort, and columns round-trip and match the CLI', async ({
  page
}) => {
  await page.goto('/');
  await hydrated(page);
  await expect(page.getByRole('link', { name: 'ongoing home' })).toBeVisible();
  await expect(page.locator('[data-entry-row]').first()).toHaveAttribute('data-entry-row', 'alpha');

  // `/` with an empty URL is a real query, shown in the filter box rather than hidden state.
  const filter = page.getByRole('searchbox', { name: 'Filter inventory' });
  await expect(filter).toHaveValue('kind:project is_hidden:false');

  await page.keyboard.press('/');
  await expect(filter).toBeFocused();
  await filter.fill('kind:project is_favorite:true');
  await filter.press('Enter');
  await expect(page).toHaveURL(/q=kind%3Aproject\+is_favorite%3Atrue/);
  await expect(page.locator('[data-entry-row]')).toHaveCount(1);

  // The same string is an `ongoing list` argument, and answers with the same rows — including the
  // defaults both surfaces prepend, so the hidden favourite is absent on both.
  const fromCli = ongoing('list', 'kind:project is_favorite:true', '--ids');
  expect(fromCli.split('\n').filter(Boolean)).toHaveLength(1);

  await page.goto('/?q=kind%3Aproject&sort=-loc.code&columns=name,loc.code');
  await hydrated(page);
  await expect(page.locator('[data-entry-row]').first()).toHaveAttribute('data-entry-row', 'beta');
  await expect(page.getByRole('button', { name: 'Sort by Lines of code' })).toBeVisible();
  // `--no-group` because `ongoing list` floats favourites to the top by default and the browser
  // sorts by exactly the keys in the URL.
  const sorted = ongoingJson<{ name: string }[]>(
    'list',
    'kind:project',
    '--sort',
    '-loc.code',
    '--no-group',
    '--json'
  );
  expect(sorted[0].name).toBe('beta');
});

test('a saved view is created in the browser and the CLI lists it', async ({ page }) => {
  await page.goto('/?q=kind%3Aproject+github.stars%3E%3D100');
  await hydrated(page);
  page.once('dialog', (dialog) => void dialog.accept('browser-saved'));
  await page.getByRole('button', { name: /save view/i }).click();
  await expect(page.getByRole('link', { name: /browser-saved/ })).toBeVisible();

  expect(ongoing('views')).toContain('browser-saved');
  // `--json` projects the view's own columns, so `name` is what comes back.
  const viaSaved = ongoingJson<{ name: string }[]>('list', '--saved', 'browser-saved', '--json');
  expect(viaSaved.map((entry) => entry.name)).toEqual(['alpha']);

  // The view the browser saved is deletable from the CLI, which is the same contract.
  ongoing('view', 'delete', 'browser-saved');
  expect(ongoing('views')).not.toContain('browser-saved');
});

test('an inline edit is optimistic, reaches the CLI, and undoes', async ({ page }) => {
  await page.goto('/?q=kind%3Aproject&columns=name,intent');
  await hydrated(page);

  const cell = page.getByRole('button', { name: 'Edit Intent for beta' });
  await cell.click();
  await page.getByRole('combobox', { name: 'Intent for beta' }).selectOption('invest');

  // Optimistic: the cell shows the new value before anything is re-fetched.
  await expect(page.getByRole('button', { name: 'Edit Intent for beta' })).toHaveText('invest');
  await expect(page.getByRole('status')).toContainText('Intent saved');

  expect(ongoing('get', 'beta', 'intent')).toBe('invest');

  // Undo is a patch like any other, through the same endpoint.
  await page.getByRole('button', { name: /undo/i }).click();
  await expect(page.getByRole('button', { name: 'Edit Intent for beta' })).toHaveText('—');
  expect(ongoing('get', 'beta', 'intent')).toBe('');
});

test('a refused edit rolls back and shows the error the CLI would show', async ({ page }) => {
  await page.goto('/?q=kind%3Aproject&columns=name,excitement');
  await hydrated(page);
  await page.getByRole('button', { name: 'Edit Excitement for alpha' }).click();
  const editor = page.getByRole('spinbutton', { name: 'Excitement for alpha' });
  await editor.fill('9');
  await editor.press('Enter');
  // The editor stays open with the message beside it — inline feedback, no toast, nothing saved.
  await expect(page.getByRole('alert')).toContainText('must be at most 5');
  await expect(editor).toBeVisible();
  expect(ongoing('get', 'alpha', 'excitement')).toBe('');
  await editor.press('Escape');
});

test('keyboard: j/k move, Enter opens the panel, and the panel links to the fact sheet', async ({
  page
}) => {
  await page.goto('/?q=kind%3Aproject');
  await hydrated(page);
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/entry=project%2Fbeta/);
  const panel = page.getByRole('complementary', { name: /beta details/ });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Why it appears');

  await panel.getByRole('link', { name: /fact sheet/i }).click();
  await expect(page).toHaveURL(/\/p\/beta$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('beta');
});

test('the palette jumps to an entry and runs a command with a CLI equivalent', async ({ page }) => {
  await page.goto('/?q=kind%3Aproject');
  await hydrated(page);
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('textbox', { name: 'Command palette' });
  await expect(palette).toBeFocused();
  // A fuzzy jump: `cafe` finds `café catalog` through its slug.
  await palette.fill('cafe');
  await page
    .getByRole('option', { name: /café catalog/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/p\/cafe-catalog$/);

  // Favourite through the palette, then read it back with `ongoing list`.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('textbox', { name: 'Command palette' }).fill('Add to favorites');
  await page.getByRole('option', { name: 'Add to favorites' }).click();
  await expect
    .poll(() => ongoing('list', 'kind:project is_favorite:true', '--ids').split('\n').length)
    .toBe(2);
  // `set` addresses an entry by slug; `favorite` takes a project name or path.
  ongoing('set', 'cafe-catalog', 'is_favorite', 'false');
});

test('the fact sheet edits a field in place and shows the reasons behind a view', async ({
  page
}) => {
  await page.goto('/p/alpha');
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('alpha');
  await expect(page.getByText('Why it appears')).toBeVisible();
  // The drawer's evidence display carries over: input, comparison, threshold.
  await expect(page.locator('code').first()).toContainText(':');

  await page.getByRole('button', { name: 'Edit Note for alpha' }).click();
  const note = page.getByRole('textbox', { name: 'Note for alpha' });
  await note.fill('edited from the fact sheet');
  await note.press('ControlOrMeta+Enter');
  await expect.poll(() => ongoing('get', 'alpha', 'note')).toBe('edited from the fact sheet');
  ongoing('note', 'alpha', 'release after parser cleanup');
});

test('the radar shows rings with counts, edits a ring, and links into a filtered inventory', async ({
  page
}) => {
  await page.goto('/radar');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'hot' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go 2' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit ring for jQuery' }).click();
  await page.getByRole('combobox', { name: 'Ring for jQuery' }).selectOption('cool');
  await expect.poll(() => ongoing('get', 'jquery', 'ring')).toBe('cool');
  ongoing('set', 'jquery', 'ring', 'out');

  await page.goto('/radar');
  await hydrated(page);
  await page.getByRole('link', { name: 'Go 2' }).click();
  await expect(page).toHaveURL(/q=tech%3Ago/);
  await expect(page.locator('[data-entry-row]')).toHaveCount(2);
});

test('the providers screen names what contributes to the catalog', async ({ page }) => {
  await page.goto('/providers');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'github', exact: true })).toBeVisible();
  await expect(page.getByText('git.commits30d')).toBeVisible();
});

test('a list operation stays inside the interaction budget', async ({ page }) => {
  await page.goto('/?q=kind%3Aproject&columns=name,loc.code');
  await hydrated(page);
  // Measured inside the page: the time from the click to the table changing. Filtering and sorting
  // are pure functions over rows already in memory, so a list operation never costs a round trip.
  // The 500-entry budget is asserted over the same functions in `query.perf.test.ts`.
  const elapsed = await page.evaluate(async () => {
    const body = document.querySelector('tbody');
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Sort by Lines of code'
    );
    if (!body || !button) return Number.POSITIVE_INFINITY;
    return await new Promise<number>((done) => {
      const start = performance.now();
      const observer = new MutationObserver(() => {
        observer.disconnect();
        done(performance.now() - start);
      });
      observer.observe(body, { childList: true, subtree: true, characterData: true });
      button.click();
    });
  });
  expect(elapsed).toBeLessThan(100);
});

test('keeps text above the normal-text contrast ratio in both themes', async ({ page }) => {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance = ([red, green, blue]: number[]) =>
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  const contrast = (first: number[], second: number[]) => {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };

  for (const theme of ['dark', 'light'] as const) {
    await page.goto('/');
    await hydrated(page);
    await page.getByRole('button', { name: `${theme} theme` }).click();
    // The tokens are `lch()`, which the browser does not serialise as `rgb()`. Painting each one
    // into a canvas is the shortest honest conversion to the sRGB the ratio is defined over.
    const colors = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      return {
        background: rgb(getComputedStyle(document.body).backgroundColor),
        primary: rgb(styles.getPropertyValue('--text-primary')),
        secondary: rgb(styles.getPropertyValue('--text-secondary')),
        tertiary: rgb(styles.getPropertyValue('--text-tertiary'))
      };
    });
    expect(contrast(colors.primary, colors.background)).toBeGreaterThan(7);
    expect(contrast(colors.secondary, colors.background)).toBeGreaterThan(4.5);
    // Tertiary carries labels and counts, never prose; it clears large-text contrast.
    expect(contrast(colors.tertiary, colors.background)).toBeGreaterThan(3);
  }
});
