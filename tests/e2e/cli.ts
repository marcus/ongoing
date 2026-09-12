import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../../bin/ongoing');
const PORT = process.env.E2E_PORT ?? '5173';

/**
 * Runs the real `ongoing` CLI against the test server. Every browser mutation in this suite is
 * confirmed through it, which is the parity rule Phase 4 owes: if the browser can do it, the CLI
 * can do it, and they go through the same HTTP contract (AGENTS.md, ADR 0006).
 */
export function ongoing(...args: string[]): string {
  return execFileSync(BIN, ['--url', `http://127.0.0.1:${PORT}`, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

export function ongoingJson<T>(...args: string[]): T {
  return JSON.parse(ongoing(...args)) as T;
}
