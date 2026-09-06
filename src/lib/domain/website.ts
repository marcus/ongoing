/** Explicit public copy, independent of private dashboard notes and scan metadata. */
export interface ProjectWebsite {
  included: boolean;
  allowPrivateRepository: boolean;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  year: string;
  stack: string;
  url: string;
  status: string;
  order: number;
  artworkId: number | string;
}

const textLimits = {
  slug: 80,
  name: 100,
  tagline: 400,
  description: 2000,
  category: 80,
  year: 4,
  stack: 180,
  url: 1000,
  status: 100
} as const;

export function updateWebsite(current: ProjectWebsite | null, patch: unknown): ProjectWebsite {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('Website fields must be an object');
  const allowed = [
    ...Object.keys(textLimits),
    'included',
    'allowPrivateRepository',
    'order',
    'artworkId'
  ];
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key)))
    throw new Error('Unsupported or empty website fields');
  const result = {
    included: false,
    allowPrivateRepository: false,
    order: 0,
    ...current,
    ...patch
  } as ProjectWebsite;
  if (typeof result.included !== 'boolean') throw new Error('included must be a boolean');
  if (typeof result.allowPrivateRepository !== 'boolean')
    throw new Error('allowPrivateRepository must be a boolean');
  for (const [key, limit] of Object.entries(textLimits)) {
    const value = result[key as keyof typeof textLimits];
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > limit ||
      /[<>]/.test(value) ||
      [...value].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error(`${key} must be nonempty single-line text, at most ${limit} characters`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.slug) || result.slug === 'about')
    throw new Error(
      'slug must use lowercase letters, digits and single hyphens, and cannot be about'
    );
  if (!/^\d{4}$/.test(result.year)) throw new Error('year must contain four digits');
  const url = new URL(result.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('url must be an absolute HTTP(S) URL without credentials');
  if (
    result.allowPrivateRepository &&
    (url.hostname === 'github.com' ||
      url.hostname.endsWith('.github.com') ||
      url.hostname === 'raw.githubusercontent.com')
  )
    throw new Error(
      'A private-repository override requires a distinct public website URL, not a GitHub repository URL'
    );
  result.url = url.href;
  if (!Number.isSafeInteger(result.order) || result.order < 0)
    throw new Error('order must be a non-negative integer');
  if (
    !(
      typeof result.artworkId === 'number' &&
      Number.isSafeInteger(result.artworkId) &&
      result.artworkId > 0
    ) &&
    !(
      typeof result.artworkId === 'string' &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.artworkId) &&
      result.artworkId.length <= 100
    )
  )
    throw new Error(
      'artworkId must be a positive photo ID or stable lowercase artwork key from the site manifest'
    );
  return result;
}

export function websiteEligibility(
  website: ProjectWebsite | null | undefined,
  repositoryVisibility: string | null | undefined
) {
  if (!website) return { eligible: false, reason: 'No website metadata' };
  if (!website.included) return { eligible: false, reason: 'Not selected for website' };
  if (repositoryVisibility !== 'public' && !website.allowPrivateRepository)
    return {
      eligible: false,
      reason:
        repositoryVisibility === 'private'
          ? 'Private repository requires an explicit public-website override'
          : 'Unverified repository visibility requires an explicit public-website override'
    };
  return { eligible: true, reason: null };
}

export function exportWebsite(
  projects: readonly { website?: ProjectWebsite | null; repositoryVisibility?: string | null }[],
  drafts = false
) {
  const sites = projects.flatMap((project) =>
    project.website &&
    (drafts || websiteEligibility(project.website, project.repositoryVisibility).eligible)
      ? [updateWebsite(null, project.website)]
      : []
  );
  sites.sort((a, b) => a.order - b.order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (new Set(sites.map((site) => site.slug)).size !== sites.length)
    throw new Error('Duplicate website slugs');
  return {
    schemaVersion: 1,
    source: 'ongoing',
    mode: drafts ? 'draft' : 'live',
    projects: sites.map((site) => ({
      id: site.slug,
      name: site.name,
      tagline: site.tagline,
      description: site.description,
      category: site.category,
      year: site.year,
      stack: site.stack,
      url: site.url,
      status: site.status,
      artworkId: site.artworkId
    }))
  };
}
