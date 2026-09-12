import type { ExportSource } from '$lib/domain/export';
import { readEntryViews } from './entries';
import type { CatalogRepository } from './repository';

/**
 * Everything an export profile reads, gathered once. The profiles themselves are pure functions in
 * `$lib/domain/export`, so the CLI, the API, and a test all run the identical code over these rows.
 */
export function readExportSource(repository: CatalogRepository): ExportSource {
  const entries = readEntryViews(repository, { includeHidden: true });
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      slug: entry.slug,
      name: entry.name,
      note: entry.note,
      tags: entry.tags,
      fields: entry.fields
    })),
    relations: repository.listRelations().map((relation) => ({
      kind: relation.kind,
      evidence: relation.evidence,
      provider: relation.provider,
      from: relation.fromId,
      to: relation.toId,
      attributes: relation.attributes
    })),
    fields: repository.registry().fields,
    // Dashboard hidden/missing flags do not silently change an explicit website selection.
    websites: [
      ...repository.listProjects({ includeHidden: true }).map((project) => ({
        website: project.website,
        repositoryVisibility: repository.getMetrics(project.id)?.githubVisibility
      })),
      ...repository.listWebsitePages().map((website) => ({ website, repositoryVisibility: null }))
    ]
  };
}
