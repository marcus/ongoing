import { json } from '@sveltejs/kit';
import { createPageModel, parseDashboardQuery, readDashboardCatalog } from '$lib/dashboard/catalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    return json(
      createPageModel(
        readDashboardCatalog(catalogRepository),
        parseDashboardQuery(url.searchParams)
      )
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'The cached catalog could not be opened' },
      { status: 503 }
    );
  }
};
