import type { PageServerLoad } from './$types';
import { readHiddenProjects } from '$lib/dashboard/catalog';

export const load: PageServerLoad = async () => {
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    return { projects: readHiddenProjects(catalogRepository), loadError: null };
  } catch (error) {
    return {
      projects: [],
      loadError: error instanceof Error ? error.message : 'The hidden catalog could not be opened'
    };
  }
};
