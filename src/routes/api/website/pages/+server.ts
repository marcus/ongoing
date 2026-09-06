import { json } from '@sveltejs/kit';
import { websiteEligibility } from '$lib/domain/website';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async () => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  return json(
    catalogRepository.listWebsitePages().map((website) => ({
      website,
      repositoryVisibility: null,
      ...websiteEligibility(website, null)
    }))
  );
};
