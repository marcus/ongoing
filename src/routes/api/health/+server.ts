import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  return json({
    ok: true,
    database: 'available',
    scan: { running: catalogRepository.getActiveScanRun() !== null }
  });
};
