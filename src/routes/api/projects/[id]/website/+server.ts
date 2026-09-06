import { json } from '@sveltejs/kit';
import { websiteEligibility } from '$lib/domain/website';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const project = catalogRepository.getProject(params.id);
  const repositoryVisibility = catalogRepository.getMetrics(params.id)?.githubVisibility ?? null;
  return project
    ? json({
        id: project.id,
        website: project.website ?? null,
        repositoryVisibility,
        ...websiteEligibility(project.website, repositoryVisibility)
      })
    : json({ error: `Unknown project ID: ${params.id}` }, { status: 404 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  try {
    const patch: unknown = await request.json();
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const website = await catalogRepository.updateWebsite(params.id, patch);
    const repositoryVisibility = catalogRepository.getMetrics(params.id)?.githubVisibility ?? null;
    return json({
      id: params.id,
      website,
      repositoryVisibility,
      ...websiteEligibility(website, repositoryVisibility)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid website fields';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 400 }
    );
  }
};
