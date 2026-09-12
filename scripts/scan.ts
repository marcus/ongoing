/** Stable calendar entry point. HTTP only: the deployed service owns scanner code and schema. */
import { scheduledScan } from '../src/lib/host/scheduled-scan';

process.exitCode = await scheduledScan(process.argv.slice(2));
