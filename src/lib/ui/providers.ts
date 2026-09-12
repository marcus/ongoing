/**
 * The providers screen reads `GET /api/providers` — the same payload `ongoing providers` renders.
 * The shapes below mirror `ProviderReport` in `$lib/server/providers/registry`, which the browser
 * cannot import; `tests/e2e/inventory.test.ts` holds them to the same answer as the CLI.
 */
export type ProviderState = 'active' | 'disabled' | 'unavailable';

export interface ProviderStatus {
  name: string;
  /** Whether configuration has it switched on. */
  enabled: boolean;
  /** Whether its requirements are satisfied on this host. */
  available: boolean;
  state: ProviderState;
  /** Why it cannot run, in one sentence; null when it can. */
  reason: string | null;
  /** What the machine is missing, when that is the reason. */
  missing: { commands: string[]; env: string[] };
  /** Entry kinds it discovers or enriches. */
  kinds: string[];
  /** `every-scan`, `when-changed`, or `daily`. */
  schedule: string;
  description: string;
  dependsOn: string[];
  requires: { commands: string[]; env: string[]; network: boolean };
  /** Field keys it contributes, as declared in its manifest. */
  fields: string[];
  /** Relation kinds it writes. */
  relations: string[];
  settings: Record<string, unknown>;
  lastRun: string | null;
  lastRunStatus: string | null;
  lastRunDetail: string | null;
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
  /** Which host adapter serves and schedules this instance. */
  host: string | null;
  /** The TOML file the configuration came from, when there is one. */
  configPath: string | null;
  /** Set when the route could not answer, so the screen can say so rather than show nothing. */
  error: string | null;
}

const empty: ProvidersResponse = { providers: [], host: null, configPath: null, error: null };

/** Reads `GET /api/providers`, and reports a refusal rather than guessing at one. */
export async function loadProviders(fetcher: typeof fetch = fetch): Promise<ProvidersResponse> {
  try {
    const response = await fetcher('/api/providers');
    const body = (await response.json()) as Partial<ProvidersResponse> & { error?: string };
    if (!response.ok || !Array.isArray(body.providers))
      return { ...empty, error: body?.error ?? `Providers could not be read (${response.status})` };
    return {
      providers: body.providers,
      host: body.host ?? null,
      configPath: body.configPath ?? null,
      error: null
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Providers unreachable' };
  }
}

/** One badge per provider: what state it is in, and how to colour it. */
export function stateTone(state: ProviderState): 'ok' | 'neutral' | 'error' {
  if (state === 'active') return 'ok';
  if (state === 'disabled') return 'neutral';
  return 'error';
}

/** What a provider needs from the machine, as one readable list. */
export function requirementList(provider: ProviderStatus): string[] {
  return [
    ...provider.requires.commands,
    ...provider.requires.env.map((name) => `$${name}`),
    ...(provider.requires.network ? ['network'] : [])
  ];
}
