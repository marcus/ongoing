import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { describeField } from '$lib/domain/fields';
import {
  activeProviders,
  getProviderManifest,
  providerManifests,
  resolveProviders,
  type ProviderAvailability,
  type ProviderManifest,
  type ProviderProbe
} from '$lib/domain/provider';
import type { AppConfig } from '$lib/server/config';
import type { CatalogRepository, ProviderRun } from '$lib/server/catalog/repository';

/**
 * The machine half of the provider seam: what is actually installed, and what each provider did
 * last time. Every decision that follows from it is pure and lives in `$lib/domain/provider`.
 */
export type CommandLookup = (command: string) => boolean;

/** `which`, without a subprocess: walk PATH and look for something executable. */
export function createCommandLookup(
  env: Record<string, string | undefined> = process.env
): CommandLookup {
  const directories = (env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const cache = new Map<string, boolean>();
  return (command) => {
    const cached = cache.get(command);
    if (cached !== undefined) return cached;
    const candidates = command.includes('/')
      ? [isAbsolute(command) ? command : join(process.cwd(), command)]
      : directories.map((directory) => join(directory, command));
    const found = candidates.some((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    cache.set(command, found);
    return found;
  };
}

/** Everything the manifests ask about the machine, looked up once. */
export function probeProviders(
  manifests: readonly ProviderManifest[] = providerManifests,
  env: Record<string, string | undefined> = process.env,
  lookup: CommandLookup = createCommandLookup(env)
): ProviderProbe {
  const commands = new Set<string>();
  const found = new Set<string>();
  for (const manifest of manifests) {
    for (const command of manifest.requires?.commands ?? []) commands.add(command);
    for (const name of manifest.requires?.env ?? []) if ((env[name] ?? '').trim()) found.add(name);
  }
  const resolved = new Set([...commands].filter((command) => lookup(command)));
  return { commands: resolved, env: found };
}

/** Which providers this configuration and this machine allow to run, in dependency order. */
export function resolveProviderStates(
  config: Pick<AppConfig, 'providers'>,
  probe: ProviderProbe = probeProviders()
): ProviderAvailability[] {
  const enabled = new Set(config.providers.enabled);
  return resolveProviders((name) => enabled.has(name), probe);
}

export interface ProviderReport extends ProviderAvailability {
  kinds: readonly string[];
  schedule: string;
  description: string;
  dependsOn: readonly string[];
  requires: { commands: readonly string[]; env: readonly string[]; network: boolean };
  /** The keys this provider contributes to the field registry. */
  fields: string[];
  relations: string[];
  settings: Record<string, unknown>;
  lastRun: string | null;
  lastRunStatus: ProviderRun['status'] | null;
  lastRunDetail: string | null;
}

/**
 * The providers surface, shared by `GET /api/providers` and `ongoing providers`: availability, last
 * run, contributed fields, enable state, and why it cannot run.
 */
export function describeProviders(
  repository: CatalogRepository,
  config: Pick<AppConfig, 'providers'>,
  probe: ProviderProbe = probeProviders()
): ProviderReport[] {
  const runs = new Map(repository.listProviderRuns().map((run) => [run.provider, run]));
  return resolveProviderStates(config, probe).map((availability) => {
    const manifest = getProviderManifest(availability.name)!;
    const run = runs.get(availability.name);
    return {
      ...availability,
      kinds: manifest.kinds,
      schedule: manifest.schedule,
      description: manifest.description,
      dependsOn: manifest.dependsOn ?? [],
      requires: {
        commands: manifest.requires?.commands ?? [],
        env: manifest.requires?.env ?? [],
        network: manifest.requires?.network ?? false
      },
      fields: manifest.fields.map((field) => describeField(field).key),
      relations: (manifest.relations ?? []).map(({ kind }) => kind),
      settings: { ...(config.providers.settings[availability.name] ?? {}) },
      lastRun: run?.lastRunAt ?? null,
      lastRunStatus: run?.status ?? null,
      lastRunDetail: run?.detail ?? null
    };
  });
}

/** The provider names a scan should run, given this configuration and this machine. */
export function activeProviderNames(
  config: Pick<AppConfig, 'providers'>,
  probe: ProviderProbe = probeProviders()
): string[] {
  return activeProviders(resolveProviderStates(config, probe));
}
