import type { AttributeValue } from './entry';
import type { DeclaredStack, Toolchain } from './stack';

/**
 * Technologies as catalog entries, and the signatures that detect them.
 *
 * A technology is an entry with `kind = 'technology'`; its ring, kind, and tool surface are
 * registered fields; a usage edge is a `uses` relation carrying the detected version. This module
 * holds the parts that are pure data or pure rules: the seed list Ongoing ships with, the signature
 * table that is the whole detector, the matcher the stack collector runs over each manifest, and
 * the export the `project-standards` generator reads.
 *
 * Two rules from the radar keep this from ballooning. A signature exists only for a technology that
 * is already in the catalog, so a dependency nobody catalogued is invisible. And signatures are
 * manifest-only — a marker file counts, a source grep does not.
 */
export const TECHNOLOGY_KIND = 'technology';

/** The provider that owns detected `uses` edges; they are rewritten on every scan. */
export const TECH_SIGNATURES_PROVIDER = 'tech-signatures';

/** Marcus's vocabulary, ordered from "default choice" to "do not start new work on it". */
export const technologyRings = ['hot', 'warm', 'cool', 'out'] as const;

export type TechnologyRing = (typeof technologyRings)[number];

export const technologyKinds = [
  'language',
  'framework',
  'library',
  'service',
  'tool',
  'platform'
] as const;

export type TechnologyKind = (typeof technologyKinds)[number];

/** How long a ring stays current before it counts as stale and asks to be looked at again. */
export const RING_REVIEW_DAYS = 180;

const DAY = 86_400_000;

export function ringOrder(ring: string | null | undefined): number {
  const index = (technologyRings as readonly string[]).indexOf(ring ?? '');
  return index === -1 ? technologyRings.length : index;
}

/** `review_after` has passed, so the ring is a statement about a moment that is over. */
export function isRingStale(reviewAfter: string | null | undefined, now: number): boolean {
  if (!reviewAfter) return false;
  const parsed = Date.parse(`${reviewAfter}T23:59:59.999Z`);
  return Number.isFinite(parsed) && parsed < now;
}

export function reviewAfterFrom(now: number, days = RING_REVIEW_DAYS): string {
  return new Date(now + days * DAY).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------- seeds */

export interface TechnologySeed {
  slug: string;
  name: string;
  technologyKind: TechnologyKind;
  ring: TechnologyRing;
  /** One line: why the ring, what it is for. */
  note?: string;
  /** When set, the technology appears in the `project-standards` tool table. */
  toolSurface?: string;
  /** Slug of the managed project that supplies it; becomes a declared `provides` edge. */
  providedBy?: string;
}

/**
 * The technologies Ongoing seeds, declared in code for the same reason as `builtinFields` and
 * `builtinSavedViews`: a fresh catalog and an upgraded one agree without a data migration, and
 * `ongoing tech seed` is idempotent because the list is the expected state rather than a script.
 *
 * It is wider than the radar's original six because the `project-standards` skill's two tables are
 * generated from this catalog: every language in its language table and every tool in its tool
 * table has to exist here, or regenerating the skill would delete prose rather than reproduce it.
 */
export const technologySeeds: readonly TechnologySeed[] = [
  {
    slug: 'go',
    name: 'Go',
    technologyKind: 'language',
    ring: 'hot',
    note: 'New projects by default; td, tasks, sidecar, comms and recall are the reference shape.'
  },
  {
    slug: 'typescript',
    name: 'JavaScript / TypeScript',
    technologyKind: 'language',
    ring: 'hot',
    note: 'When the problem wants a web or UI stack, which is often.'
  },
  {
    slug: 'ruby',
    name: 'Ruby',
    technologyKind: 'language',
    ring: 'warm',
    note: 'Quicker projects, or systems primarily for Marcus.'
  },
  {
    slug: 'bash',
    name: 'Bash',
    technologyKind: 'language',
    ring: 'warm',
    note: 'Where a shell solution is enough; actively preferred there.'
  },
  {
    slug: 'rust',
    name: 'Rust',
    technologyKind: 'language',
    ring: 'warm',
    note: 'When performance is essential.'
  },
  {
    slug: 'python',
    name: 'Python',
    technologyKind: 'language',
    ring: 'cool',
    note: 'Allowed, not preferred.'
  },
  {
    slug: 'sveltekit',
    name: 'SvelteKit',
    technologyKind: 'framework',
    ring: 'hot',
    note: 'The default web framework, with Svelte 5 runes and TypeScript.'
  },
  {
    slug: 'sqlite',
    name: 'SQLite',
    technologyKind: 'platform',
    ring: 'hot',
    note: 'The default store once JSONL stops being enough; Postgres only with a stated reason.'
  },
  {
    slug: 'tailwind',
    name: 'Tailwind CSS',
    technologyKind: 'library',
    ring: 'warm',
    note: 'Fine where a project has no design system yet; the Linear patterns lead.'
  },
  {
    slug: 'google-auth',
    name: 'Google authentication',
    technologyKind: 'service',
    ring: 'warm',
    note: 'Hosted sign-in where a project needs real accounts.'
  },
  {
    slug: 'td',
    name: 'td',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'td',
    toolSurface: 'Engineering issues, resolved per git repo. Always.'
  },
  {
    slug: 'tasks',
    name: 'tasks',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'tasks',
    toolSurface:
      'Marcus’s personal GTD. Something you noticed rather than were asked for goes in as `tasks propose "text" --note "why"`, never `capture`.'
  },
  {
    slug: 'sidecar',
    name: 'sidecar',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'sidecar',
    toolSurface:
      'Agent cockpit: shells, worktrees, panes, agent messaging. `sidecar agents` for the surface.'
  },
  {
    slug: 'comms',
    name: 'comms',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'comms',
    toolSurface: 'Async agent-to-agent messaging across harnesses.'
  },
  {
    slug: 'recall',
    name: 'recall',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'recall',
    toolSurface:
      'Retrieval across the corpus, project docs, tasks, td, and the catalog when you don’t know which source holds the answer. Keywords, not sentences.'
  },
  {
    slug: 'fractal',
    name: 'fractal',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'fractal',
    toolSurface:
      'Repository-owned architecture models, interactive presentation and SVG/PNG exports. Skill: `~/code/fractal/skills/fractal/SKILL.md`.'
  },
  {
    slug: 'ongoing',
    name: 'ongoing',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'ongoing',
    toolSurface:
      'The project catalog: what is managed, its stacks, intent, and attention. `ongoing show <project>`, `ongoing stacks --outdated`.'
  },
  {
    slug: 'mise',
    name: 'mise',
    technologyKind: 'tool',
    ring: 'hot',
    toolSurface:
      'The single surface for language runtimes and CLI tools. Wrong binary or version? Start here.'
  },
  {
    slug: 'gh',
    name: 'gh',
    technologyKind: 'tool',
    ring: 'hot',
    toolSurface: 'GitHub. Create repos private by default.'
  },
  {
    slug: 'naturally',
    name: 'naturally',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'naturally',
    toolSurface: 'Run prose that anyone other than Marcus will read through it.'
  },
  {
    slug: 'roc',
    name: 'roc',
    technologyKind: 'tool',
    ring: 'hot',
    providedBy: 'roc',
    toolSurface:
      'Icon library at `~/code/roc`. Add, publish, and improve icons freely (`roc-icons`).'
  }
];

/** The field values a seed asks for, as a patch the registry validates like any other. */
export function seedFields(seed: TechnologySeed): Record<string, AttributeValue> {
  return {
    name: seed.name,
    technology_kind: seed.technologyKind,
    ring: seed.ring,
    note: seed.note ?? '',
    tool_surface: seed.toolSurface ?? null
  };
}

/* ----------------------------------------------------------------- signatures */

export interface DependencySignature {
  /** Manifest read from the repository root, e.g. `package.json`. */
  file: string;
  /** Dependency names that prove the technology, matched exactly. */
  names: readonly string[];
}

export interface TechnologySignature {
  slug: string;
  /**
   * Toolchains in `project_stacks` that prove this technology. Languages come for free this way:
   * the declared version is already collected, so the radar reads it rather than storing it twice.
   */
  toolchains?: readonly Toolchain[];
  dependencies?: readonly DependencySignature[];
  /** Files whose mere presence proves the technology; they carry no version. */
  markers?: readonly string[];
}

/**
 * The whole detector. One table in source beside the toolchain table, as the radar asks: a
 * dependency with no signature here is invisible to Ongoing, and adding a technology means writing
 * its signature rather than extending a plugin system.
 */
export const technologySignatures: readonly TechnologySignature[] = [
  { slug: 'go', toolchains: ['go'] },
  {
    slug: 'typescript',
    toolchains: ['node', 'bun', 'deno'],
    dependencies: [{ file: 'package.json', names: ['typescript'] }]
  },
  { slug: 'ruby', toolchains: ['ruby'] },
  { slug: 'rust', toolchains: ['rust'] },
  { slug: 'python', toolchains: ['python'] },
  { slug: 'sveltekit', dependencies: [{ file: 'package.json', names: ['@sveltejs/kit'] }] },
  { slug: 'tailwind', dependencies: [{ file: 'package.json', names: ['tailwindcss'] }] },
  {
    slug: 'sqlite',
    dependencies: [
      { file: 'package.json', names: ['better-sqlite3', 'sqlite3', 'node-sqlite3-wasm'] },
      { file: 'go.mod', names: ['modernc.org/sqlite', 'github.com/mattn/go-sqlite3'] },
      { file: 'Gemfile', names: ['sqlite3'] },
      { file: 'Cargo.toml', names: ['rusqlite'] }
    ]
  },
  {
    slug: 'google-auth',
    dependencies: [
      { file: 'package.json', names: ['google-auth-library', 'googleapis'] },
      { file: 'go.mod', names: ['golang.org/x/oauth2', 'google.golang.org/api'] }
    ]
  },
  { slug: 'td', markers: ['.todos/config.json'] },
  { slug: 'mise', markers: ['mise.toml', '.mise.toml', '.tool-versions'] },
  { slug: 'fractal', markers: ['docs/diagrams/fractal/fractal.json'] }
];

/** Manifests the collector has to read dependencies from, derived from the signature table. */
export const signatureManifestFiles: readonly string[] = [
  ...new Set(
    technologySignatures.flatMap((signature) =>
      (signature.dependencies ?? []).map(({ file }) => file)
    )
  )
].sort();

/** Files whose presence alone is a signature, derived from the signature table. */
export const signatureMarkerFiles: readonly string[] = [
  ...new Set(technologySignatures.flatMap((signature) => signature.markers ?? []))
].sort();

/** One detected edge before it is written: which technology, from which file, at which version. */
export interface DetectedTechnology {
  slug: string;
  /** The declared version or range the manifest carried, when it carried one. */
  version: string | null;
  /** Repository-relative file the detector matched. */
  sourceFile: string;
  /** The dependency name or toolchain that matched, for the edge's attributes. */
  matched: string;
}

/** Signature matches for one manifest's dependency map. Pure; the collector does the reading. */
export function matchDependencies(
  file: string,
  dependencies: Readonly<Record<string, string>>
): DetectedTechnology[] {
  const detections: DetectedTechnology[] = [];
  for (const signature of technologySignatures)
    for (const group of signature.dependencies ?? []) {
      if (group.file !== file) continue;
      for (const name of group.names) {
        const version = dependencies[name];
        if (version === undefined) continue;
        detections.push({
          slug: signature.slug,
          version: version || null,
          sourceFile: file,
          matched: name
        });
      }
    }
  return detections;
}

/** Signature matches for a marker file that exists. */
export function matchMarker(file: string): DetectedTechnology[] {
  return technologySignatures
    .filter((signature) => (signature.markers ?? []).includes(file))
    .map((signature) => ({
      slug: signature.slug,
      version: null,
      sourceFile: file,
      matched: file
    }));
}

/**
 * The language half of the detector: `project_stacks` already says `go 1.27.0`, so a language
 * technology reads that table rather than parsing the manifest a second time.
 */
export function languageUsage(stacks: readonly DeclaredStack[]): DetectedTechnology[] {
  const detections: DetectedTechnology[] = [];
  for (const signature of technologySignatures)
    for (const stack of stacks) {
      if (!(signature.toolchains ?? []).includes(stack.toolchain)) continue;
      detections.push({
        slug: signature.slug,
        version: stack.declared || null,
        sourceFile: stack.sourceFile,
        matched: stack.toolchain
      });
    }
  return detections;
}

/**
 * One edge per technology. A project that matches the same technology twice — `typescript` from
 * both `package.json` and `.tool-versions` — keeps the versioned match, then the first one seen,
 * so the edge that survives is the one that says the most.
 */
export function mergeDetections(detections: readonly DetectedTechnology[]): DetectedTechnology[] {
  const bySlug = new Map<string, DetectedTechnology>();
  for (const detection of detections) {
    const existing = bySlug.get(detection.slug);
    if (!existing || (existing.version === null && detection.version !== null))
      bySlug.set(detection.slug, detection);
  }
  return [...bySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug, 'en'));
}

/* --------------------------------------------------------------------- usage */

/** A technology one project uses, as the attention rules and the CLI see it. */
export interface UsedTechnology {
  slug: string;
  name: string;
  ring: string | null;
  reviewAfter: string | null;
  version: string | null;
  evidence: 'declared' | 'detected';
  sourceFile: string | null;
}

/** One `uses` edge plus the technology it points at, as the rules and the surfaces want it. */
export function usedTechnology(
  technology: {
    slug: string;
    name: string;
    attributes: Record<string, AttributeValue>;
    reviewAfter: string | null;
  },
  relation: { attributes: Record<string, AttributeValue>; evidence: string }
): UsedTechnology {
  const attributes = relation.attributes ?? {};
  return {
    slug: technology.slug,
    name: technology.name,
    ring: (technology.attributes.ring as string | undefined) ?? null,
    reviewAfter: technology.reviewAfter,
    version: typeof attributes.version === 'string' ? attributes.version : null,
    evidence: relation.evidence === 'detected' ? 'detected' : 'declared',
    sourceFile: typeof attributes.sourceFile === 'string' ? attributes.sourceFile : null
  };
}

export function sortUsedTechnologies(used: readonly UsedTechnology[]): UsedTechnology[] {
  return [...used].sort((left, right) => left.slug.localeCompare(right.slug, 'en'));
}

/* -------------------------------------------------------------------- export */

/** The minimum an entry has to look like for the export; `EntryView` satisfies it structurally. */
export interface TechnologyEntryLike {
  id: string;
  kind: string;
  slug: string;
  name: string;
  fields: Record<string, AttributeValue>;
  relations: {
    outgoing: readonly RelationLike[];
    incoming: readonly RelationLike[];
  };
}

export interface RelationLike {
  kind: string;
  evidence: string;
  provider: string | null;
  attributes: Record<string, AttributeValue>;
  note: string | null;
  other: { id: string; kind: string; slug: string; name: string } | null;
}

export interface TechnologyUsage {
  project: string;
  name: string;
  version: string | null;
  evidence: string;
  provider: string | null;
  sourceFile: string | null;
  note: string | null;
}

export interface TechnologyExportEntry {
  slug: string;
  name: string;
  kind: string | null;
  ring: string | null;
  note: string;
  toolSurface: string | null;
  reviewAfter: string | null;
  stale: boolean;
  /** The managed project that supplies it, from a `provides` edge. */
  providedBy: string | null;
  projects: TechnologyUsage[];
}

export interface TechnologyExport {
  generatedAt: string;
  technologies: TechnologyExportEntry[];
}

function text(value: AttributeValue | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}

function usage(relation: RelationLike): TechnologyUsage {
  return {
    project: relation.other?.slug ?? '?',
    name: relation.other?.name ?? '?',
    version: text(relation.attributes.version),
    evidence: relation.evidence,
    provider: relation.provider,
    sourceFile: text(relation.attributes.sourceFile),
    note: relation.note
  };
}

/**
 * Technologies and their edges as one deterministic document — ring order first, then name, with
 * every project list sorted — so a generator that renders it produces the same bytes twice and a
 * regeneration with nothing changed is an empty diff.
 */
export function technologyExport(
  entries: readonly TechnologyEntryLike[],
  options: { now?: number; generatedAt?: string } = {}
): TechnologyExport {
  const now = options.now ?? Date.now();
  const technologies = entries
    .filter((entry) => entry.kind === TECHNOLOGY_KIND)
    .map((entry): TechnologyExportEntry => {
      const reviewAfter = text(entry.fields.review_after);
      const edges = entry.relations.incoming.filter(
        (relation) => relation.other?.kind === 'project'
      );
      return {
        slug: entry.slug,
        name: entry.name,
        kind: text(entry.fields.technology_kind),
        ring: text(entry.fields.ring),
        note: text(entry.fields.note) ?? '',
        toolSurface: text(entry.fields.tool_surface),
        reviewAfter,
        stale: isRingStale(reviewAfter, now),
        providedBy: edges.find((relation) => relation.kind === 'provides')?.other?.slug ?? null,
        projects: edges
          .filter((relation) => relation.kind === 'uses')
          .map(usage)
          .sort((left, right) => left.project.localeCompare(right.project, 'en'))
      };
    })
    .sort(
      (left, right) =>
        ringOrder(left.ring) - ringOrder(right.ring) || left.name.localeCompare(right.name, 'en')
    );
  return { generatedAt: options.generatedAt ?? new Date(now).toISOString(), technologies };
}
