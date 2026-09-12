/**
 * Shim. The scan LaunchAgent installed on aerie runs this exact path, so it stays here while the
 * implementation lives behind the host seam in `src/lib/host/scan-command.ts`. The next deploy can
 * point the plist at `src/lib/host/scan-command.ts` and delete this file; see docs/deployment.md.
 */
import { main } from '../src/lib/host/scan-command';

process.exitCode = await main(process.argv.slice(2));
