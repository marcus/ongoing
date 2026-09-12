import { json } from '@sveltejs/kit';
import { exportProfiles, runExportProfile } from '$lib/domain/export';
import type { RequestHandler } from './$types';

/**
 * Publishing the catalog is an adapter: `?profile=opentangle` is the shape OpenTangle reads and
 * `?profile=json` is the generic one. `/api/website` stays as it was — it is the same `opentangle`
 * profile under the URL the site build already calls.
 */
export const GET: RequestHandler = async ({ url }) => {
  const allowed = ['profile', 'drafts', 'kind'];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)))
    return json({ error: `Only ${allowed.join(', ')} are supported` }, { status: 400 });
  const drafts = url.searchParams.get('drafts');
  if (drafts !== null && !['true', 'false'].includes(drafts))
    return json({ error: 'drafts must be true or false' }, { status: 400 });
  const profile = url.searchParams.get('profile') ?? 'json';
  if (!(exportProfiles as readonly string[]).includes(profile))
    return json(
      { error: `Unknown export profile: ${profile} (expected ${exportProfiles.join(', ')})` },
      { status: 400 }
    );

  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const { readExportSource } = await import('$lib/server/catalog/export');
    return json(
      runExportProfile(profile, readExportSource(catalogRepository), {
        drafts: drafts === 'true',
        kind: url.searchParams.get('kind') ?? undefined
      }),
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Export unavailable' },
      { status: 503 }
    );
  }
};
