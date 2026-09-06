import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';
import { exportWebsite, updateWebsite, websiteEligibility } from '../../src/lib/domain/website';

const databases: CatalogDatabase[] = [];
const draft = {
  slug: 'fixture',
  name: 'Fixture',
  tagline: 'Public summary',
  description: 'Public description',
  category: 'Developer Tool',
  year: '2026',
  stack: 'TypeScript',
  url: 'https://example.com/fixture',
  status: 'Active',
  order: 0,
  artworkId: 146
};
afterEach(() => databases.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = new CatalogDatabase(':memory:');
  databases.push(db);
  const repository = new CatalogRepository(db);
  const project = await repository.upsertDiscovered({
    canonicalPath: '/private/fixture',
    relativePath: 'fixture',
    name: 'fixture',
    scanRoot: '/private'
  });
  await repository.updateNote(project.id, 'Private dashboard note');
  await repository.updateMetrics(project.id, { githubVisibility: 'public' });
  return { repository, project };
}

describe('public website metadata', () => {
  it('defaults to draft, requires opt-in, survives scans, and exports only public copy', async () => {
    const { repository, project } = await fixture();
    expect(repository.getProject(project.id)?.website).toBeNull();
    await repository.updateWebsite(project.id, draft);
    expect(exportWebsite(repository.listProjects()).projects).toEqual([]);
    expect(exportWebsite(repository.listProjects(), true).mode).toBe('draft');
    await repository.updateWebsite(project.id, { included: true });
    await repository.upsertDiscovered({ ...project, name: 'renamed locally' });
    await repository.setHidden(project.id, true);
    const result = exportWebsite(
      repository
        .listProjects({ includeHidden: true })
        .map((p) => ({ ...p, repositoryVisibility: repository.getMetrics(p.id)?.githubVisibility }))
    );
    expect(result.projects.map((p) => p.id)).toEqual(['fixture']);
    expect(JSON.stringify(result)).not.toMatch(/private|canonicalPath|note|metrics|included/);
    expect(result.projects[0].name).toBe('Fixture');
    await repository.updateWebsite(project.id, { included: false });
    expect(
      exportWebsite(
        repository.listProjects({ includeHidden: true }).map((p) => ({
          ...p,
          repositoryVisibility: repository.getMetrics(p.id)?.githubVisibility
        }))
      ).projects
    ).toEqual([]);
  });
  it('rejects incomplete selection, unknown fields, markup, unsafe URLs and duplicate slugs atomically', async () => {
    const { repository, project } = await fixture();
    await expect(repository.updateWebsite(project.id, { included: true })).rejects.toThrow();
    expect(repository.getProject(project.id)?.website).toBeNull();
    for (const patch of [
      { ...draft, privatePath: '/secret' },
      { ...draft, name: '<script>' },
      { ...draft, url: 'javascript:alert(1)' },
      { ...draft, url: 'https://user:secret@example.com/' },
      { ...draft, included: 'true' }
    ])
      expect(() => updateWebsite(null, patch)).toThrow();
    await repository.updateWebsite(project.id, draft);
    const other = await repository.upsertDiscovered({
      canonicalPath: '/private/other',
      relativePath: 'other',
      name: 'other',
      scanRoot: '/private'
    });
    await expect(repository.updateWebsite(other.id, draft)).rejects.toThrow(/slug already used/);
    expect(repository.getProject(other.id)?.website).toBeNull();
  });
  it('excludes private and unknown repositories unless an explicit distinct public website override exists', () => {
    const selected = updateWebsite(null, { ...draft, included: true });
    for (const repositoryVisibility of ['private', null, undefined]) {
      expect(exportWebsite([{ website: selected, repositoryVisibility }]).projects).toEqual([]);
      expect(websiteEligibility(selected, repositoryVisibility).eligible).toBe(false);
      const website = updateWebsite(selected, { allowPrivateRepository: true });
      expect(exportWebsite([{ website, repositoryVisibility }]).projects).toHaveLength(1);
    }
    expect(() =>
      updateWebsite(selected, {
        allowPrivateRepository: true,
        url: 'https://github.com/owner/private'
      })
    ).toThrow(/distinct public website/);
    expect(() =>
      updateWebsite(selected, {
        allowPrivateRepository: true,
        url: 'https://github.com/owner/private/issues'
      })
    ).toThrow(/distinct public website/);
    expect(
      exportWebsite([{ website: selected, repositoryVisibility: 'public' }]).projects
    ).toHaveLength(1);
  });

  it('manages non-repository pages as drafts through the same export and slug rules', async () => {
    const { repository, project } = await fixture();
    const page = await repository.updateWebsitePage('greatway', {
      ...draft,
      slug: 'greatway',
      allowPrivateRepository: true,
      artworkId: 'braid-cover-2026-09-05'
    });
    expect(page.included).toBe(false);
    expect(
      exportWebsite(repository.listWebsitePages().map((website) => ({ website }))).projects
    ).toEqual([]);
    await repository.updateWebsitePage('greatway', { included: true });
    expect(
      exportWebsite(repository.listWebsitePages().map((website) => ({ website }))).projects[0].id
    ).toBe('greatway');
    await expect(
      repository.updateWebsite(project.id, { ...draft, slug: 'greatway' })
    ).rejects.toThrow(/slug already used/);
    await repository.updateWebsite(project.id, draft);
    await expect(repository.updateWebsitePage('fixture', draft)).rejects.toThrow(
      /slug already used/
    );
  });

  it('exports reproducibly by explicit order then slug, regardless of dashboard order', () => {
    const a = {
      repositoryVisibility: 'public',
      website: updateWebsite(null, { ...draft, included: true, slug: 'a', order: 2 })
    };
    const b = {
      repositoryVisibility: 'public',
      website: updateWebsite(null, { ...draft, included: true, slug: 'b', order: 1 })
    };
    expect(exportWebsite([a, b])).toEqual(exportWebsite([b, a]));
    expect(exportWebsite([a, b]).projects.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
