import { expect, test } from '@playwright/test';

/**
 * The entry surface over HTTP: the same routes the CLI and the browser use. Every mutation here
 * has a CLI verb (`ongoing field add`, `ongoing set`, `ongoing link`, `ongoing view save`), which
 * is the parity this phase owes.
 */
test('lists entries with their registry, and projects keep their alias', async ({ request }) => {
  const response = await request.get('/api/entries?kind=project');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    entries: { kind: string; slug: string; fields: Record<string, unknown>; sources: unknown[] }[];
    fields: { key: string; owner: string }[];
  };
  const alpha = body.entries.find((entry) => entry.slug === 'alpha');
  expect(alpha).toBeTruthy();
  expect(alpha!.kind).toBe('project');
  // Provider metrics are projected into namespaced fields, indistinguishable from stored ones.
  expect(alpha!.fields['github.stars']).toBe(120);
  expect(alpha!.fields.name).toBe('alpha');
  expect(alpha!.sources).toHaveLength(1);
  expect(body.fields.map((field) => field.key)).toEqual(
    expect.arrayContaining(['intent', 'github.stars', 'manual_rank'])
  );

  const projects = await request.get('/api/projects');
  expect(projects.ok()).toBe(true);
});

test('a user field added over the API is editable and visible everywhere', async ({ request }) => {
  const created = await request.post('/api/fields', {
    data: { key: 'x.owner', type: 'text', label: 'Owner' }
  });
  expect(created.status()).toBe(201);

  // Only the new field is touched: these tests share a seeded catalog with the browser tests, so
  // a decision field left behind here would change what the attention views classify there.
  const patched = await request.patch('/api/entries/project/alpha', {
    data: { 'x.owner': 'marcus' }
  });
  expect(patched.ok()).toBe(true);
  const entry = (await patched.json()) as { fields: Record<string, unknown> };
  expect(entry.fields['x.owner']).toBe('marcus');

  // The dashboard payload carries it too, so `ongoing list --json` sees it without a second read.
  const projects = (await (await request.get('/api/projects')).json()) as {
    projects: { name: string; attributes: Record<string, unknown> }[];
  };
  expect(projects.projects.find((project) => project.name === 'alpha')?.attributes['x.owner']).toBe(
    'marcus'
  );

  const rejected = await request.patch('/api/entries/project/alpha', {
    data: { 'x.ownr': 'marcus' }
  });
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toMatchObject({
    error: expect.stringContaining('did you mean x.owner')
  });

  const readOnly = await request.patch('/api/entries/project/alpha', {
    data: { 'github.stars': 5 }
  });
  expect(readOnly.status()).toBe(400);

  expect((await request.delete('/api/fields?key=x.owner')).ok()).toBe(true);
});

test('a declared relation round-trips, and a saved view stores its query', async ({ request }) => {
  // A rerun against a warm server would otherwise collide on the slug.
  await request.delete('/api/entries/technology/sveltekit');
  const technology = await request.post('/api/entries', {
    data: { kind: 'technology', name: 'SvelteKit', slug: 'sveltekit', ring: 'hot' }
  });
  expect(technology.status()).toBe(201);

  const relation = await request.post('/api/relations', {
    data: { from: 'project/alpha', to: 'technology/sveltekit', kind: 'uses', note: 'the app' }
  });
  expect(relation.status()).toBe(201);

  const entry = (await (await request.get('/api/entries/project/alpha')).json()) as {
    relations: { outgoing: { kind: string; evidence: string; other: { slug: string } }[] };
  };
  expect(entry.relations.outgoing).toEqual([
    expect.objectContaining({ kind: 'uses', evidence: 'declared' })
  ]);
  expect(entry.relations.outgoing[0].other.slug).toBe('sveltekit');

  const wrongWayRound = await request.post('/api/relations', {
    data: { from: 'technology/sveltekit', to: 'project/alpha', kind: 'uses' }
  });
  expect(wrongWayRound.status()).toBe(400);

  expect(
    (
      await request.delete('/api/relations', {
        data: { from: 'project/alpha', to: 'technology/sveltekit', kind: 'uses' }
      })
    ).ok()
  ).toBe(true);

  const view = await request.post('/api/views', {
    data: { name: 'oss-momentum', query: 'intent:invest github.stars>=100', columns: ['name'] }
  });
  expect(view.status()).toBe(201);
  const views = (await (await request.get('/api/views')).json()) as {
    views: { name: string; query: string }[];
  };
  // Built-in views ship with the app, so the saved one joins them rather than standing alone.
  expect(views.views).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'oss-momentum', query: 'intent:invest github.stars>=100' }),
      expect.objectContaining({ name: 'attention', builtin: true })
    ])
  );
  expect((await request.delete('/api/views?view=oss-momentum')).ok()).toBe(true);
  expect((await request.delete('/api/entries/technology/sveltekit')).ok()).toBe(true);
  expect((await request.delete('/api/entries/project/alpha')).status()).toBe(400);
});

/**
 * The query model over HTTP. `?q=`, `?sort=`, `?columns=`, and `?saved=` are the whole read
 * contract; the pre-Phase-2 parameters land on the same clauses (docs/cli.md prints the table).
 */
test('filters, sorts, and names its errors through one query grammar', async ({ request }) => {
  const read = async (search: string) => {
    const response = await request.get(`/api/entries?${search}`);
    return {
      status: response.status(),
      body: (await response.json()) as {
        query: string;
        sort: string;
        columns: string[];
        total: number;
        error?: string;
        entries: { slug: string; fields: Record<string, unknown> }[];
      }
    };
  };

  const favorites = await read('q=kind:project is_favorite:true');
  expect(favorites.status).toBe(200);
  expect(favorites.body.entries.map((entry) => entry.slug)).toContain('alpha');
  expect(favorites.body.total).toBe(favorites.body.entries.length);

  // The old parameters produce the same clauses as the query that replaces them.
  const legacy = await read('kind=project&filter=favorites');
  expect(legacy.body.query).toBe('kind:project is_favorite:true');
  expect(legacy.body.entries.map((entry) => entry.slug)).toEqual(
    favorites.body.entries.map((entry) => entry.slug)
  );

  const sorted = await read('q=kind:project&sort=-github.stars&columns=name,github.stars');
  expect(sorted.body.sort).toBe('-github.stars');
  expect(sorted.body.columns).toEqual(['name', 'github.stars']);
  expect(sorted.body.entries[0].fields['github.stars']).toBe(120);

  const typo = await read('q=intnet:invest');
  expect(typo.status).toBe(400);
  expect(typo.body.error).toContain('did you mean intent?');

  const badSort = await read('sort=githb.stars');
  expect(badSort.status).toBe(400);
  expect(badSort.body.error).toContain('Unknown sort field');

  // Saved views ship with the app and are addressable by name from every surface.
  const saved = await read('saved=attention');
  expect(saved.status).toBe(200);
  expect(saved.body.query).toBe('kind:project view:attention');
  expect((await read('saved=nope')).status).toBe(404);
});
