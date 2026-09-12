import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { repositoryRoot } from './run';

/** The calendar is only a client. It must never open or migrate a catalog from the checkout. */
export function scheduledScanArgs(argv: readonly string[]): string[] {
  const args = ['scan'];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (['--full', '--cheap', '--help', '-h'].includes(argument)) args.push(argument);
    else if (argument === '--changed') continue;
    else if (argument === '--project' && argv[index + 1] && !argv[index + 1].startsWith('-'))
      args.push(argv[++index]);
    else throw new Error(`Unknown or incomplete scheduled scan argument: ${argument}`);
  }
  return [...args, '--transport', 'http', '--wait', '--json'];
}

export async function scheduledScan(argv: readonly string[]): Promise<number> {
  const args = scheduledScanArgs(argv);
  const child = spawn(process.execPath, [join(repositoryRoot, 'bin/ongoing.ts'), ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit'
  });
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
