import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The provider seam, as data (ADR 0007): every manifest with its availability, its last run, the
 * fields it contributes, whether configuration has it switched on, and — when it cannot run — why.
 * The providers page and `ongoing providers` render this same payload.
 */
export const GET: RequestHandler = async () => {
  try {
    const { appConfig, catalogRepository } = await import('$lib/server/scanning/runtime');
    const { describeProviders } = await import('$lib/server/providers/registry');
    return json({
      providers: describeProviders(catalogRepository, appConfig),
      host: appConfig.hostAdapter,
      configPath: appConfig.configPath,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Providers could not be read' },
      { status: 503 }
    );
  }
};
