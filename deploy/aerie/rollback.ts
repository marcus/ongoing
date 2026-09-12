import { runReleaseClient } from './release-client';

try {
  await runReleaseClient('rollback', process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
