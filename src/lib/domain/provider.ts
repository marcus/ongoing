import type { EntryKind } from './entry';
import type { FieldDefinition } from './fields';
import { catalogDerivedFields, projectedFieldsFor } from './provider-fields';
import { relationKinds, type RelationKindDefinition } from './relation';

/**
 * Provider manifests (ADR 0007).
 *
 * A provider declares what it contributes before it runs: the entry kinds it discovers or enriches,
 * the namespaced read-only fields it owns, the relation kinds it writes, what it needs from the
 * machine, and how often it runs. The scanner iterates the enabled manifests in dependency order
 * rather than running a fixed sequence, and the field registry is built from the manifests, so a
 * disabled or unavailable provider contributes no fields and every rule that reads them goes inert
 * rather than wrong.
 *
 * Nothing here performs I/O. Availability is decided by {@link resolveProviderAvailability} over a
 * probe result the server layer supplies, so the whole decision is testable without a machine.
 */
export interface ProviderRequirements {
  /** Executables that must resolve on `PATH`. */
  commands?: readonly string[];
  /** Environment variables that must be set. */
  env?: readonly string[];
  /** Declared, not probed: it tells a reader why the provider fails offline. */
  network?: boolean;
}

export type ProviderSchedule = 'every-scan' | 'when-changed' | 'daily';

export interface ProviderManifest {
  name: string;
  /** What it discovers or enriches. */
  kinds: readonly EntryKind[];
  /** Namespaced, read-only, registered on load. */
  fields: readonly FieldDefinition[];
  relations?: readonly RelationKindDefinition[];
  requires?: ProviderRequirements;
  schedule: ProviderSchedule;
  /**
   * Providers whose output this one reads. Decision 4's shape does not name it; the scanner needs
   * it to iterate "in dependency order" without a hard-coded sequence, which is the whole point of
   * the manifest, so it is declared rather than inferred from the array's order.
   */
  dependsOn?: readonly string[];
  /** One line for `ongoing providers` and the providers page. */
  description: string;
}

const usesRelation = relationKinds.filter(({ kind }) => kind === 'uses');

/**
 * The providers Ongoing ships with. Order here is documentation; {@link orderProviders} is what the
 * scanner iterates, and it is derived from `dependsOn`.
 */
export const providerManifests: readonly ProviderManifest[] = [
  {
    name: 'filesystem',
    kinds: ['project'],
    fields: projectedFieldsFor('filesystem'),
    requires: {},
    schedule: 'every-scan',
    description: 'Discovers Git repositories under the configured scan roots'
  },
  {
    name: 'git',
    kinds: ['project'],
    fields: projectedFieldsFor('git'),
    requires: { commands: ['git'] },
    schedule: 'every-scan',
    dependsOn: ['filesystem'],
    description: 'Commit history, branch, working-tree state, and tags'
  },
  {
    name: 'td',
    kinds: ['project'],
    fields: projectedFieldsFor('td'),
    requires: { commands: ['td'] },
    schedule: 'every-scan',
    dependsOn: ['filesystem'],
    description: 'Issue counts from a repository-local td database'
  },
  {
    name: 'stack',
    kinds: ['project'],
    fields: projectedFieldsFor('stack'),
    requires: {},
    schedule: 'every-scan',
    dependsOn: ['filesystem'],
    description: 'Declared toolchain versions read from committed manifests'
  },
  {
    name: 'tech-signatures',
    kinds: ['project', 'technology'],
    fields: [],
    relations: usesRelation,
    requires: {},
    schedule: 'every-scan',
    dependsOn: ['stack'],
    description: 'Detected `uses` edges from manifest dependency signatures, rewritten every scan'
  },
  {
    name: 'loc',
    kinds: ['project'],
    fields: projectedFieldsFor('loc'),
    requires: { commands: ['cloc'] },
    schedule: 'when-changed',
    dependsOn: ['filesystem', 'git'],
    description: 'Lines of code and dominant language, gated on the tracked-tree fingerprint'
  },
  {
    name: 'endoflife',
    kinds: ['project'],
    fields: [],
    requires: { network: true },
    schedule: 'daily',
    dependsOn: ['stack'],
    description: 'Release cycles and end-of-life dates for the toolchains projects declare'
  },
  {
    name: 'github',
    kinds: ['project'],
    fields: projectedFieldsFor('github'),
    requires: { commands: ['gh'], network: true },
    schedule: 'when-changed',
    dependsOn: ['filesystem', 'git'],
    description:
      'Stars, pull requests, issues, CI state, releases, and traffic for GitHub remotes; with `discover` set, also the repositories an owner has that nothing local claims'
  }
];

export const providerNames: readonly string[] = providerManifests.map(({ name }) => name);

export function getProviderManifest(name: string): ProviderManifest | undefined {
  return providerManifests.find((manifest) => manifest.name === name);
}

/**
 * Dependency order: a provider never runs before a provider it reads. Ties keep declaration order,
 * so the sequence stays the familiar one (discover, git, td, stack, …) while the ordering rule is
 * the manifest rather than a hard-coded list.
 */
export function orderProviders(
  manifests: readonly ProviderManifest[] = providerManifests
): ProviderManifest[] {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const ordered: ProviderManifest[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (manifest: ProviderManifest): void => {
    if (placed.has(manifest.name)) return;
    if (visiting.has(manifest.name))
      throw new Error(`Provider dependency cycle at ${manifest.name}`);
    visiting.add(manifest.name);
    for (const dependency of manifest.dependsOn ?? []) {
      const next = byName.get(dependency);
      if (next) visit(next);
    }
    visiting.delete(manifest.name);
    placed.add(manifest.name);
    ordered.push(manifest);
  };

  for (const manifest of manifests) visit(manifest);
  return ordered;
}

/** Every field the manifests contribute, plus the ones the catalog derives from itself. */
export const providerFieldDefinitions: readonly FieldDefinition[] = [
  ...providerManifests.flatMap((manifest) => manifest.fields),
  ...catalogDerivedFields
];

/**
 * The fields an enabled set of providers contributes. A disabled or unavailable provider registers
 * nothing, which is what makes an attention rule reading its fields inert rather than wrong.
 */
export function fieldsForProviders(active: readonly string[]): FieldDefinition[] {
  const names = new Set(active);
  return [
    ...providerManifests
      .filter((manifest) => names.has(manifest.name))
      .flatMap((manifest) => manifest.fields),
    ...catalogDerivedFields
  ];
}

export type ProviderState = 'active' | 'disabled' | 'unavailable';

export interface ProviderProbe {
  /** Executables that resolved on `PATH`. */
  commands: ReadonlySet<string>;
  /** Environment variables that are set and non-empty. */
  env: ReadonlySet<string>;
}

export interface ProviderAvailability {
  name: string;
  enabled: boolean;
  available: boolean;
  state: ProviderState;
  /** Why it cannot run, in one sentence; null when it can. */
  reason: string | null;
  missing: { commands: string[]; env: string[] };
}

/**
 * Availability as a pure function of the manifest, the enabled list, and what the machine turned
 * out to have. `network` is declared rather than probed: a provider is not marked unavailable for
 * being offline, it simply fails its fetch and keeps its cached data (ADR 0002/0003).
 */
export function resolveProviderAvailability(
  manifest: ProviderManifest,
  enabled: boolean,
  probe: ProviderProbe
): ProviderAvailability {
  const missingCommands = (manifest.requires?.commands ?? []).filter(
    (command) => !probe.commands.has(command)
  );
  const missingEnv = (manifest.requires?.env ?? []).filter((name) => !probe.env.has(name));
  const available = missingCommands.length === 0 && missingEnv.length === 0;
  const parts: string[] = [];
  if (missingCommands.length)
    parts.push(
      `${missingCommands.join(', ')} ${missingCommands.length > 1 ? 'are' : 'is'} not on PATH`
    );
  if (missingEnv.length)
    parts.push(`${missingEnv.join(', ')} ${missingEnv.length > 1 ? 'are' : 'is'} not set`);
  return {
    name: manifest.name,
    enabled,
    available,
    state: !enabled ? 'disabled' : available ? 'active' : 'unavailable',
    reason: !enabled
      ? 'disabled in configuration'
      : available
        ? null
        : parts.length
          ? parts.join('; ')
          : 'requirements are not met',
    missing: { commands: missingCommands, env: missingEnv }
  };
}

/**
 * Every provider's state, in dependency order, with a provider whose dependency cannot run marked
 * unavailable for that reason rather than left to fail. This is the whole decision a scan makes
 * about who runs, expressed as one pure function over a probe result.
 */
export function resolveProviders(
  isEnabled: (name: string) => boolean,
  probe: ProviderProbe,
  manifests: readonly ProviderManifest[] = providerManifests
): ProviderAvailability[] {
  const ordered = orderProviders(manifests);
  const resolved = new Map<string, ProviderAvailability>();
  for (const manifest of ordered) {
    const availability = resolveProviderAvailability(manifest, isEnabled(manifest.name), probe);
    const blocked = (manifest.dependsOn ?? []).filter(
      (name) => resolved.get(name)?.state !== undefined && resolved.get(name)?.state !== 'active'
    );
    resolved.set(
      manifest.name,
      availability.state === 'active' && blocked.length
        ? {
            ...availability,
            available: false,
            state: 'unavailable',
            reason: `${blocked.join(', ')} ${blocked.length > 1 ? 'are' : 'is'} not running`
          }
        : availability
    );
  }
  return ordered.map((manifest) => resolved.get(manifest.name)!);
}

/** The names a scan should actually run, in dependency order. */
export function activeProviders(availability: readonly ProviderAvailability[]): string[] {
  return availability.filter(({ state }) => state === 'active').map(({ name }) => name);
}
