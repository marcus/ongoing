import { describe, expect, it } from 'vitest';
import { createFieldRegistry, validateEntryPatch } from './fields';
import {
  isRingStale,
  languageUsage,
  matchDependencies,
  matchMarker,
  mergeDetections,
  seedFields,
  signatureManifestFiles,
  signatureMarkerFiles,
  technologyExport,
  technologySeeds,
  technologySignatures,
  type TechnologyEntryLike,
  type RelationLike
} from './technology';

const NOW = Date.parse('2026-09-12T12:00:00Z');

describe('the seed list', () => {
  it('validates against the field registry, so seeding is an ordinary patch', () => {
    const registry = createFieldRegistry();
    for (const seed of technologySeeds) {
      const patch = validateEntryPatch(registry, 'technology', seedFields(seed));
      expect(patch.attributes.ring).toBe(seed.ring);
      expect(patch.attributes.technology_kind).toBe(seed.technologyKind);
    }
  });

  it('uses each slug once', () => {
    const slugs = technologySeeds.map((seed) => seed.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('carries every language and tool the project-standards tables are generated from', () => {
    const languages = technologySeeds.filter((seed) => seed.technologyKind === 'language');
    expect(languages.map((seed) => seed.slug)).toContain('go');
    expect(technologySeeds.filter((seed) => seed.toolSurface).length).toBeGreaterThan(5);
  });
});

describe('the signature table', () => {
  // The radar's rule: a signature exists only for a technology that is already in the catalog, so
  // a dependency nobody catalogued stays invisible rather than inventing an entry.
  it('only names technologies the catalog seeds', () => {
    const seeded = new Set(technologySeeds.map((seed) => seed.slug));
    for (const signature of technologySignatures) expect(seeded).toContain(signature.slug);
  });

  it('derives the manifests and markers the collector has to read', () => {
    expect(signatureManifestFiles).toContain('package.json');
    expect(signatureManifestFiles).toContain('go.mod');
    expect(signatureMarkerFiles).toContain('.todos/config.json');
  });

  it('matches a dependency by exact name and keeps the declared version', () => {
    expect(
      matchDependencies('package.json', { '@sveltejs/kit': '^2.70.1', lodash: '^4.0.0' })
    ).toEqual([
      {
        slug: 'sveltekit',
        version: '^2.70.1',
        sourceFile: 'package.json',
        matched: '@sveltejs/kit'
      }
    ]);
    // A near miss is not a match; signatures are exact.
    expect(matchDependencies('package.json', { '@sveltejs/kit-extra': '1' })).toEqual([]);
    // A manifest a signature does not name contributes nothing, even with the same dependency.
    expect(matchDependencies('Gemfile', { '@sveltejs/kit': '1' })).toEqual([]);
  });

  it('matches a marker file, which carries no version', () => {
    expect(matchMarker('.todos/config.json')).toEqual([
      { slug: 'td', version: null, sourceFile: '.todos/config.json', matched: '.todos/config.json' }
    ]);
    expect(matchMarker('README.md')).toEqual([]);
  });

  it('reads languages out of the declared stacks rather than the manifest', () => {
    expect(
      languageUsage([{ toolchain: 'go', declared: '1.27', raw: '1.27.0', sourceFile: 'go.mod' }])
    ).toEqual([{ slug: 'go', version: '1.27', sourceFile: 'go.mod', matched: 'go' }]);
    expect(
      languageUsage([{ toolchain: 'bun', declared: '', raw: '', sourceFile: 'package.json' }])
    ).toEqual([{ slug: 'typescript', version: null, sourceFile: 'package.json', matched: 'bun' }]);
  });

  it('keeps one edge per technology, preferring the match that names a version', () => {
    expect(
      mergeDetections([
        { slug: 'typescript', version: null, sourceFile: '.tool-versions', matched: 'node' },
        { slug: 'typescript', version: '5.9.3', sourceFile: 'package.json', matched: 'typescript' },
        { slug: 'go', version: '1.27', sourceFile: 'go.mod', matched: 'go' }
      ])
    ).toEqual([
      { slug: 'go', version: '1.27', sourceFile: 'go.mod', matched: 'go' },
      { slug: 'typescript', version: '5.9.3', sourceFile: 'package.json', matched: 'typescript' }
    ]);
  });
});

describe('ring staleness', () => {
  it('treats the review date as inclusive and an absent one as never stale', () => {
    expect(isRingStale('2026-09-12', NOW)).toBe(false);
    expect(isRingStale('2026-09-11', NOW)).toBe(true);
    expect(isRingStale(null, NOW)).toBe(false);
  });
});

describe('the export', () => {
  function relation(overrides: Partial<RelationLike> = {}): RelationLike {
    return {
      kind: 'uses',
      evidence: 'detected',
      provider: 'tech-signatures',
      attributes: { version: '1.27', sourceFile: 'go.mod' },
      note: null,
      other: { id: 'project_x', kind: 'project', slug: 'td', name: 'td' },
      ...overrides
    };
  }

  function entry(
    slug: string,
    fields: Record<string, string | null>,
    incoming: RelationLike[] = []
  ): TechnologyEntryLike {
    return {
      id: `technology_${slug}`,
      kind: 'technology',
      slug,
      name: slug,
      fields,
      relations: { outgoing: [], incoming }
    };
  }

  it('orders by ring then name and lists each technology’s projects', () => {
    const document = technologyExport(
      [
        entry('python', { ring: 'cool', technology_kind: 'language' }),
        entry('go', { ring: 'hot', technology_kind: 'language', review_after: '2026-09-11' }, [
          relation(),
          relation({
            other: { id: 'project_a', kind: 'project', slug: 'aerie', name: 'aerie' }
          }),
          relation({ kind: 'provides', evidence: 'declared', provider: null })
        ]),
        { ...entry('ignored', {}), kind: 'project' }
      ],
      { now: NOW, generatedAt: 'fixed' }
    );

    expect(document.technologies.map((technology) => technology.slug)).toEqual(['go', 'python']);
    const go = document.technologies[0];
    expect(go.stale).toBe(true);
    expect(go.providedBy).toBe('td');
    expect(go.projects.map((project) => project.project)).toEqual(['aerie', 'td']);
    expect(go.projects[0]).toMatchObject({ version: '1.27', evidence: 'detected' });
  });

  it('renders the same document twice for the same catalog', () => {
    const entries = [entry('go', { ring: 'hot' }), entry('ruby', { ring: 'warm' })];
    expect(JSON.stringify(technologyExport(entries, { now: NOW, generatedAt: 'fixed' }))).toBe(
      JSON.stringify(technologyExport([...entries].reverse(), { now: NOW, generatedAt: 'fixed' }))
    );
  });
});
