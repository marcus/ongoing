import { json } from '@sveltejs/kit';
import {
  createPageModel,
  parseDashboardQuery,
  readDashboardCatalog,
  readHiddenCatalog
} from '$lib/dashboard/catalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    // `?hidden=true` reads the hidden shelf instead of the dashboard, so non-browser clients can
    // list and unhide projects that are otherwise reachable only through the /hidden page.
    const read =
      url.searchParams.get('hidden') === 'true' ? readHiddenCatalog : readDashboardCatalog;
    return json(createPageModel(read(catalogRepository), parseDashboardQuery(url.searchParams)));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'The cached catalog could not be opened' },
      { status: 503 }
    );
  }
};
