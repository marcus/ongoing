/**
 * Shim. The web LaunchAgent installed on aerie runs this exact path, so it stays here while the
 * implementation lives behind the host seam in `src/lib/host/production-server.ts`. The next deploy
 * can point the plist at `src/lib/host/production-server.ts` and delete this file; see
 * docs/deployment.md.
 */
import { startProductionServer } from '../src/lib/host/production-server';

await startProductionServer();
