import type { FieldRegistry } from '$lib/domain/fields';
import { providersForKind } from './facts';

/**
 * The providers screen reads `GET /api/providers`.
 *
 * TODO(phase-5, td-c5dc7d): that route does not exist yet — Phase 5 adds it alongside the provider
 * manifests and the TOML configuration (ADR 0007). Until it answers, this loader falls back to what
 * the field registry already knows: which providers own fields, and therefore which ones could
 * contribute. Availability, last run, and enable state are unknown in the fallback and are rendered
 * as such rather than guessed. When the route lands, delete {@link registryFallback} and nothing
 * else in the screen has to change — the shape below is the contract.
 */
export interface ProviderStatus {
  name: string;
  /** Whether the provider's requirements are satisfied on this host. Null when unknown. */
  available: boolean | null;
  /** ISO timestamp of its last run, or null when it has never run or is unknown. */
  lastRun: string | null;
  /** Field keys the provider contributes, as declared in its manifest. */
  fields: string[];
  /** Whether configuration has it switched on. Null when unknown. */
  enabled: boolean | null;
  /** Why it is unavailable, when the provider knows. */
  detail?: string | null;
  /** `every-scan`, `when-changed`, `daily` — the manifest's schedule. */
  schedule?: string | null;
  /** Entry kinds the provider enriches or discovers. */
  kinds?: string[];
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
  /** True when the answer came from `/api/providers` rather than from the registry fallback. */
  live: boolean;
}

/** What the registry alone can say about providers, before Phase 5 makes them first-class. */
export function registryFallback(registry: FieldRegistry): ProviderStatus[] {
  const kinds = ['project', 'technology'];
  const byProvider = new Map<string, { fields: string[]; kinds: Set<string> }>();
  for (const kind of kinds)
    for (const name of providersForKind(registry, kind)) {
      const record = byProvider.get(name) ?? { fields: [], kinds: new Set<string>() };
      record.kinds.add(kind);
      byProvider.set(name, record);
    }
  for (const field of registry.fields) {
    if (!field.owner.startsWith('provider:')) continue;
    const name = field.owner.slice('provider:'.length);
    const record = byProvider.get(name);
    if (record) record.fields.push(field.key);
  }
  return [...byProvider.entries()]
    .map(([name, record]) => ({
      name,
      available: null,
      lastRun: null,
      fields: record.fields.sort((left, right) => left.localeCompare(right, 'en')),
      enabled: null,
      kinds: [...record.kinds]
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

/** Reads the live route when it exists, and falls back to the registry when it does not. */
export async function loadProviders(
  registry: FieldRegistry,
  fetcher: typeof fetch = fetch
): Promise<ProvidersResponse> {
  try {
    const response = await fetcher('/api/providers');
    if (response.ok) {
      const body = (await response.json()) as { providers?: ProviderStatus[] };
      if (Array.isArray(body.providers)) return { providers: body.providers, live: true };
    }
  } catch {
    /* the route is not there yet; the registry fallback below is the honest answer */
  }
  return { providers: registryFallback(registry), live: false };
}
