import type { PageServerLoad } from './$types';
import {
  createPageModel,
  emptyDashboardCatalog,
  parseDashboardQuery,
  readDashboardCatalog
} from '$lib/dashboard/catalog';

export const load: PageServerLoad = async ({ url }) => {
  const query = parseDashboardQuery(url.searchParams);
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    return createPageModel(readDashboardCatalog(catalogRepository), query);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The cached catalog could not be opened';
    return createPageModel(emptyDashboardCatalog(), query, message);
  }
};
