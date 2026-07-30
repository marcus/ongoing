import { DEFAULT_RELEASE_BASELINE_API_URL } from '$lib/server/config';
import type { Toolchain, ToolchainReleaseCycle } from '$lib/domain/stack';

/**
 * Upstream release data for a toolchain.
 *
 * The adapter exists so the catalog is never coupled to endoflife.date specifically: anything that
 * can answer "which cycles exist and which are still supported" can be substituted.
 */
export interface ReleaseBaselineProvider {
  fetchCycles(toolchain: Toolchain, signal?: AbortSignal): Promise<ToolchainReleaseCycle[]>;
}

export class ReleaseBaselineError extends Error {
  constructor(
    message: string,
    readonly availability: 'unavailable' | 'rate_limited' = 'unavailable'
  ) {
    super(message);
    this.name = 'ReleaseBaselineError';
  }
}

/** Toolchains endoflife.date has no single product for; they stay unresolved rather than guessed. */
export const UNTRACKED_TOOLCHAINS: readonly Toolchain[] = ['java', 'swift'];

const PRODUCT_IDS: Partial<Record<Toolchain, string>> = { node: 'nodejs' };

export function releaseProductId(toolchain: Toolchain): string | null {
  if (UNTRACKED_TOOLCHAINS.includes(toolchain)) return null;
  return PRODUCT_IDS[toolchain] ?? toolchain;
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface EndOfLifeRelease {
  name?: unknown;
  releaseDate?: unknown;
  isLts?: unknown;
  isEol?: unknown;
  eolFrom?: unknown;
  isMaintained?: unknown;
  latest?: { name?: unknown } | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseReleaseDocument(toolchain: Toolchain, body: unknown): ToolchainReleaseCycle[] {
  const document = body as { result?: { releases?: unknown } } | null;
  const releases = document?.result?.releases;
  if (!Array.isArray(releases))
    throw new ReleaseBaselineError('Release baseline returned an unexpected document');

  const parsed: ToolchainReleaseCycle[] = [];
  for (const entry of releases as EndOfLifeRelease[]) {
    const cycle = optionalString(entry?.name);
    if (!cycle) continue;
    parsed.push({
      toolchain,
      cycle,
      latest: optionalString(entry.latest?.name),
      releaseDate: optionalString(entry.releaseDate),
      eolFrom: optionalString(entry.eolFrom),
      isEol: entry.isEol === true,
      // Absent maintenance data must not read as "supported" when deciding upgrade pressure.
      isMaintained: entry.isMaintained === true,
      isLts: entry.isLts === true
    });
  }
  if (parsed.length === 0)
    throw new ReleaseBaselineError('Release baseline returned no usable release cycles');
  return parsed;
}

export interface EndOfLifeProviderOptions {
  apiUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export class EndOfLifeProvider implements ReleaseBaselineProvider {
  private readonly apiUrl: string;
  private readonly fetch: NonNullable<EndOfLifeProviderOptions['fetch']>;
  private readonly timeoutMs: number;

  constructor(options: EndOfLifeProviderOptions = {}) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_RELEASE_BASELINE_API_URL).replace(/\/+$/, '');
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new RangeError('Release baseline timeout must be positive');
  }

  async fetchCycles(toolchain: Toolchain, signal?: AbortSignal): Promise<ToolchainReleaseCycle[]> {
    const product = releaseProductId(toolchain);
    if (!product) throw new ReleaseBaselineError(`No release data is published for ${toolchain}`);

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timed out')), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.apiUrl}/products/${product}/`, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (response.status === 429)
        throw new ReleaseBaselineError('Release baseline rate limited', 'rate_limited');
      if (!response.ok)
        throw new ReleaseBaselineError(
          `Release baseline request for ${product} failed with status ${response.status}`
        );
      return parseReleaseDocument(toolchain, await response.json());
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error instanceof ReleaseBaselineError) throw error;
      throw new ReleaseBaselineError(
        `Release baseline request for ${product} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
