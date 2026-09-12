import { createFieldRegistry, describeField } from '$lib/domain/fields';
import type { LayoutServerLoad } from './$types';

/**
 * The whole catalog, once, for the whole shell.
 *
 * Filtering, sorting, and column changes are pure functions over these rows (`filterRows`,
 * `sortRows`), so the browser runs them locally and a list operation costs no round trip — which
 * is what keeps them under the 100 ms interaction budget at catalog size. The URL is still the
 * query, and `GET /api/entries?q=…` answers the identical question for the CLI.
 *
 * This load deliberately reads nothing from `url`, so SvelteKit does not re-run it when the query
 * string changes; only a mutation or a manual refresh re-reads the catalog.
 */
export const load: LayoutServerLoad = async () => {
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const { readEntryViews } = await import('$lib/server/catalog/entries');
    const registry = catalogRepository.registry();
    return {
      entries: readEntryViews(catalogRepository, { includeHidden: true }),
      fields: registry.fields.map(describeField),
      views: catalogRepository.listSavedViews(),
      scan: catalogRepository.getLatestScanRun(),
      generatedAt: new Date().toISOString(),
      loadError: null as string | null
    };
  } catch (error) {
    return {
      entries: [],
      fields: createFieldRegistry().fields.map(describeField),
      views: [],
      scan: null,
      generatedAt: new Date().toISOString(),
      loadError: error instanceof Error ? error.message : 'The catalog could not be opened'
    };
  }
};
