import { json } from '@sveltejs/kit';
import { websiteEligibility } from '$lib/domain/website';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const website = catalogRepository.getWebsitePage(params.slug);
  return json({ website, repositoryVisibility: null, ...websiteEligibility(website, null) });
};
export const PATCH: RequestHandler = async ({ params, request }) => {
  try {
    const patch: unknown = await request.json();
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const website = await catalogRepository.updateWebsitePage(params.slug, patch);
    return json({ website, repositoryVisibility: null, ...websiteEligibility(website, null) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Invalid website page' },
      { status: 400 }
    );
  }
};
