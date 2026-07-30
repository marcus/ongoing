/**
 * Declared toolchains and how far behind they are.
 *
 * A project's stack is what its manifests *declare* (`go.mod`, `.nvmrc`, `Cargo.toml`, …), not what
 * happens to be installed. Declarations are persisted; the comparison against upstream release data
 * is recomputed on every read so that `classifyAttentionViews` stays a pure function of the project
 * and can be re-run in the browser without repository access.
 */

export const toolchainKeys = [
  'go',
  'node',
  'bun',
  'deno',
  'python',
  'ruby',
  'rust',
  'php',
  'elixir',
  'dotnet',
  'java',
  'swift',
  'postgresql'
] as const;

export type Toolchain = (typeof toolchainKeys)[number];

export function isToolchain(value: string): value is Toolchain {
  return (toolchainKeys as readonly string[]).includes(value);
}

/** What a manifest literally declares. Persisted in `project_stacks`. */
export interface DeclaredStack {
  toolchain: Toolchain;
  /** Normalized numeric version, e.g. `1.22`. Empty when the manifest names no version. */
  declared: string;
  /** Verbatim manifest text, e.g. `>=20` or `node:22-alpine`. */
  raw: string;
  /** Repository-relative file the declaration came from, e.g. `go.mod`. */
  sourceFile: string;
}

/** One upstream release cycle as a provider reports it, before it is cached. */
export interface ToolchainReleaseCycle {
  toolchain: Toolchain;
  /** The cycle identifier, e.g. `1.25` for Go or `22` for Node. */
  cycle: string;
  /** Newest release within the cycle, e.g. `1.25.12`. */
  latest: string | null;
  releaseDate: string | null;
  eolFrom: string | null;
  isEol: boolean;
  isMaintained: boolean;
  isLts: boolean;
}

/** A cached release cycle, stamped with when it was last refreshed. Persisted in `toolchain_releases`. */
export interface ToolchainRelease extends ToolchainReleaseCycle {
  fetchedAt: string;
}

/** Outcome of the last baseline refresh for one toolchain. Persisted in `toolchain_baseline_status`. */
export interface ToolchainBaselineStatus {
  toolchain: Toolchain;
  availability: 'available' | 'unavailable' | 'rate_limited';
  fetchedAt: string;
  message: string | null;
}

export type StackStatus = 'current' | 'behind' | 'eol' | 'unknown';

/** A declaration judged against cached release data. Never persisted. */
export interface ResolvedStack extends DeclaredStack {
  status: StackStatus;
  /** The release cycle the declaration falls into, e.g. `1.22`. */
  matchedCycle: string | null;
  /** Newest release within the project's own cycle. */
  cycleLatestRelease: string | null;
  /** Newest cycle upstream still supports. */
  latestCycle: string | null;
  /** Newest release within `latestCycle`. */
  latestRelease: string | null;
  /** Count of supported cycles newer than `matchedCycle`. */
  cyclesBehind: number | null;
  /** End-of-life date of the project's own cycle, when it has one. */
  eolFrom: string | null;
  baselineFetchedAt: string | null;
}

const VERSION_PATTERN = /\d+(?:\.\d+)*/;

/**
 * Extract a numeric version from whatever a manifest happens to contain: `v20`, `>=20`, `^1.22`,
 * `~3.12`, `20.x`, `22-alpine`, `1.22.0-rc1`. Ranges yield their first bound, which is the version
 * the project actually commits to supporting.
 */
export function parseVersion(raw: string): number[] | null {
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return null;
  const segments = match[0].split('.').map(Number);
  return segments.every((segment) => Number.isSafeInteger(segment) && segment >= 0)
    ? segments
    : null;
}

/** The canonical `declared` string for a raw manifest value; empty when no version is present. */
export function normalizeVersion(raw: string): string {
  return parseVersion(raw)?.join('.') ?? '';
}

export function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isPrefix(cycle: readonly number[], declared: readonly number[]): boolean {
  return (
    cycle.length <= declared.length && cycle.every((segment, index) => segment === declared[index])
  );
}

function retired(release: ToolchainRelease, now: number): boolean {
  if (release.isEol) return true;
  const eol = release.eolFrom ? Date.parse(release.eolFrom) : NaN;
  return Number.isFinite(eol) && eol <= now;
}

function unresolved(declared: DeclaredStack, baselineFetchedAt: string | null): ResolvedStack {
  return {
    ...declared,
    status: 'unknown',
    matchedCycle: null,
    cycleLatestRelease: null,
    latestCycle: null,
    latestRelease: null,
    cyclesBehind: null,
    eolFrom: null,
    baselineFetchedAt
  };
}

/**
 * Judge one declaration against the cached cycles for its toolchain.
 *
 * `cyclesBehind` counts the *supported* cycles newer than the project's own, so a project on the
 * previous LTS reads as one behind rather than being penalised for every intermediate short-lived
 * release. Anything the baseline cannot speak to stays `unknown` — it must never present as
 * `current`, because attention rules treat `current` as positive evidence.
 */
export function resolveStack(
  declared: DeclaredStack,
  releases: readonly ToolchainRelease[],
  now = Date.now()
): ResolvedStack {
  const baselineFetchedAt =
    releases
      .map((release) => release.fetchedAt)
      .sort((left, right) => (left < right ? 1 : -1))[0] ?? null;
  const parsed = parseVersion(declared.declared || declared.raw);
  if (!parsed || releases.length === 0) return unresolved(declared, baselineFetchedAt);

  const cycles = releases
    .map((release) => ({ release, version: parseVersion(release.cycle) }))
    .filter((entry): entry is { release: ToolchainRelease; version: number[] } => !!entry.version)
    .sort((left, right) => compareVersions(right.version, left.version));
  if (cycles.length === 0) return unresolved(declared, baselineFetchedAt);

  const supported = cycles.filter(({ release }) => !retired(release, now));
  const newest = supported[0] ?? null;
  const latestCycle = newest?.release.cycle ?? null;
  const latestRelease = newest?.release.latest ?? null;

  // Longest prefix wins so `1.22.3` matches cycle `1.22` rather than a bare `1` cycle.
  const matched =
    cycles
      .filter(({ version }) => isPrefix(version, parsed))
      .sort((left, right) => right.version.length - left.version.length)[0] ??
    // A declaration less specific than any cycle — `golang:1`, `python:3` — floats to the newest
    // release in its line, which is what those tags actually resolve to. Treating it as the oldest
    // matching cycle would let an intentionally-unpinned project read as end of life.
    supported.find(({ version }) => isPrefix(parsed, version)) ??
    cycles.find(({ version }) => isPrefix(parsed, version));

  if (!matched) {
    const oldest = cycles.at(-1);
    // A version below every cycle upstream still lists is certainly retired if the oldest one is.
    if (oldest && compareVersions(parsed, oldest.version) < 0 && retired(oldest.release, now))
      return {
        ...declared,
        status: 'eol',
        matchedCycle: null,
        cycleLatestRelease: null,
        latestCycle,
        latestRelease,
        cyclesBehind: supported.length,
        eolFrom: oldest.release.eolFrom,
        baselineFetchedAt
      };
    return { ...unresolved(declared, baselineFetchedAt), latestCycle, latestRelease };
  }

  const cyclesBehind = supported.filter(
    ({ version }) => compareVersions(version, matched.version) > 0
  ).length;
  const isRetired = retired(matched.release, now);

  return {
    ...declared,
    status: isRetired ? 'eol' : cyclesBehind > 0 ? 'behind' : 'current',
    matchedCycle: matched.release.cycle,
    cycleLatestRelease: matched.release.latest,
    latestCycle,
    latestRelease,
    cyclesBehind,
    eolFrom: matched.release.eolFrom,
    baselineFetchedAt
  };
}

/** Largest `cyclesBehind` across a project's declarations, for sorting. */
export function stackLag(stacks: readonly ResolvedStack[]): number | null {
  const lags = stacks
    .map((stack) => stack.cyclesBehind)
    .filter((lag): lag is number => lag !== null);
  return lags.length === 0 ? null : Math.max(...lags);
}
