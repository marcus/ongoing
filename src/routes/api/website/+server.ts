import { json } from '@sveltejs/kit';
import { exportWebsite } from '$lib/domain/website';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  if (
    [...url.searchParams.keys()].some((key) => key !== 'drafts') ||
    (url.searchParams.has('drafts') && !['true', 'false'].includes(url.searchParams.get('drafts')!))
  )
    return json({ error: 'Only drafts=true or drafts=false is supported' }, { status: 400 });
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    // Dashboard hidden/missing flags do not silently change an explicit website selection.
    return json(
      exportWebsite(
        [
          ...catalogRepository.listProjects({ includeHidden: true }).map((project) => ({
            website: project.website,
            repositoryVisibility: catalogRepository.getMetrics(project.id)?.githubVisibility
          })),
          ...catalogRepository
            .listWebsitePages()
            .map((website) => ({ website, repositoryVisibility: null }))
        ],
        url.searchParams.get('drafts') === 'true'
      ),
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Website export unavailable' },
      { status: 503 }
    );
  }
};
