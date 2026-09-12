import { json } from '@sveltejs/kit';
import { runExportProfile } from '$lib/domain/export';
import type { RequestHandler } from './$types';

/**
 * The `opentangle` export profile, under the URL OpenTangle's build already calls. The profile
 * itself lives in `$lib/domain/export`; `/api/export?profile=opentangle` is the same bytes.
 */
export const GET: RequestHandler = async ({ url }) => {
  if (
    [...url.searchParams.keys()].some((key) => key !== 'drafts') ||
    (url.searchParams.has('drafts') && !['true', 'false'].includes(url.searchParams.get('drafts')!))
  )
    return json({ error: 'Only drafts=true or drafts=false is supported' }, { status: 400 });
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const { readExportSource } = await import('$lib/server/catalog/export');
    return json(
      runExportProfile('opentangle', readExportSource(catalogRepository), {
        drafts: url.searchParams.get('drafts') === 'true'
      }),
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Website export unavailable' },
      { status: 503 }
    );
  }
};
