import { describe, expect, it } from 'vitest';
import type { CommandResult, HostCommandRunner } from './adapter';
import { findLaunchdLabels, LaunchdHost, parseLaunchdPrint } from './launchd';

/**
 * Captured `launchctl print gui/501/<label>` output, with the machine it came from replaced by an
 * imaginary one. The adapter is tested against this text and an injected runner; it never touches
 * the real agents on this machine.
 */
const runningPrint = `com.example.ongoing = {
	active count = 1
	path = /home/pat/Library/LaunchAgents/com.example.ongoing.plist
	state = running
	program = /home/pat/.local/share/ongoing/bun
	arguments = {
		/home/pat/.local/share/ongoing/bun
		/home/pat/src/ongoing/src/lib/host/production-server.ts
	}
	default environment = {
		PATH => /usr/bin:/bin:/usr/sbin:/sbin
	}
	pid = 52341
	immediate reason = speculative
	forks = 0
	execs = 1
	initialized = 1
	trampolined = 1
	started suspended = 0
	proxy started suspended = 0
	last exit code = (never exited)
}`;

const waitingPrint = `com.example.ongoing.scan = {
	active count = 0
	path = /home/pat/Library/LaunchAgents/com.example.ongoing.scan.plist
	state = waiting
	last exit code = 1
}`;

function recorder(results: Record<string, CommandResult>): {
  runner: HostCommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: HostCommandRunner = (command, args) => {
    calls.push([command, ...args]);
    const key = [command, ...args].join(' ');
    return (
      Object.entries(results).find(([prefix]) => key.startsWith(prefix))?.[1] ?? {
        status: 0,
        stdout: '',
        stderr: ''
      }
    );
  };
  return { runner, calls };
}

function host(runner: HostCommandRunner): LaunchdHost {
  return new LaunchdHost({
    runner,
    uid: 501,
    home: '/home/pat',
    root: '/home/pat/src/ongoing',
    // Named outright so the adapter never reads this machine's real LaunchAgents directory.
    labels: { web: 'com.example.ongoing', scan: 'com.example.ongoing.scan' },
    wait: async () => {}
  });
}

describe('launchd agent labels', () => {
  /**
   * The reverse-DNS prefix belongs to whoever installed the agents, so the adapter reads it off
   * the definitions they installed rather than carrying one person's name in the application.
   */
  it('takes both labels from the plists a user has installed', () => {
    expect(
      findLaunchdLabels([
        'com.apple.something.plist',
        'net.example.ongoing.plist',
        'net.example.ongoing.scan.plist',
        'README'
      ])
    ).toEqual({ web: 'net.example.ongoing', scan: 'net.example.ongoing.scan' });
  });

  it('derives the missing half from whichever agent is installed', () => {
    expect(findLaunchdLabels(['org.pat.ongoing.plist'])).toEqual({
      web: 'org.pat.ongoing',
      scan: 'org.pat.ongoing.scan'
    });
    expect(findLaunchdLabels(['org.pat.ongoing.scan.plist'])).toEqual({
      web: 'org.pat.ongoing',
      scan: 'org.pat.ongoing.scan'
    });
  });

  it('falls back to a plain name when nothing is installed', () => {
    expect(findLaunchdLabels([])).toEqual({ web: 'ongoing', scan: 'ongoing.scan' });
  });
});

describe('launchd host adapter', () => {
  it('reads state and pid out of launchctl print', () => {
    expect(parseLaunchdPrint(runningPrint)).toEqual({
      state: 'running',
      running: true,
      pid: 52_341,
      lastExitStatus: null
    });
    expect(parseLaunchdPrint(waitingPrint)).toEqual({
      state: 'waiting',
      running: false,
      pid: null,
      lastExitStatus: 1
    });
  });

  it('reports a job launchd does not know as not loaded', async () => {
    const { runner } = recorder({
      'launchctl print': { status: 113, stdout: '', stderr: 'Could not find service' }
    });
    await expect(host(runner).status('web')).resolves.toMatchObject({
      adapter: 'launchd',
      label: 'com.example.ongoing',
      state: 'not loaded',
      running: false,
      pid: null
    });
  });

  it('surfaces a non-zero last exit code on a loaded job', async () => {
    const { runner } = recorder({
      'launchctl print': { status: 0, stdout: waitingPrint, stderr: '' }
    });
    await expect(host(runner).status('scan')).resolves.toMatchObject({
      label: 'com.example.ongoing.scan',
      state: 'waiting',
      detail: 'last exit code 1'
    });
  });

  /** bootout + bootstrap, not `kickstart -k`, so an edited plist is actually reloaded. */
  it('boots a job out and back in, waiting for launchd to finish the teardown', async () => {
    let printed = 0;
    const calls: string[][] = [];
    const runner: HostCommandRunner = (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === 'print')
        return printed++ === 0
          ? { status: 0, stdout: runningPrint, stderr: '' }
          : { status: 113, stdout: '', stderr: 'not found' };
      return { status: 0, stdout: '', stderr: '' };
    };
    await expect(host(runner).restart('web')).resolves.toEqual({
      ok: true,
      message: 'restarted com.example.ongoing'
    });
    expect(calls.map((call) => call.join(' '))).toEqual([
      'launchctl bootout gui/501/com.example.ongoing',
      'launchctl print gui/501/com.example.ongoing',
      'launchctl print gui/501/com.example.ongoing',
      'launchctl bootstrap gui/501 /home/pat/Library/LaunchAgents/com.example.ongoing.plist'
    ]);
  });

  it('refuses to restart a service whose build failed', async () => {
    const { runner, calls } = recorder({
      [`${process.execPath} run build`]: { status: 1, stdout: '', stderr: 'type error' }
    });
    await expect(host(runner).restart('web', { build: true })).resolves.toEqual({
      ok: false,
      message: 'build failed; service left running'
    });
    expect(calls.some(([command]) => command === 'launchctl')).toBe(false);
  });

  it('reports a bootstrap that never succeeds instead of hanging', async () => {
    const { runner } = recorder({
      'launchctl print': { status: 113, stdout: '', stderr: '' },
      'launchctl bootstrap': { status: 5, stdout: '', stderr: 'Input/output error' }
    });
    await expect(host(runner).restart('scan')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Input/output error')
    });
  });

  it('treats booting out an unloaded job as success', async () => {
    const { runner } = recorder({
      'launchctl bootout': { status: 3, stdout: '', stderr: 'No such process' }
    });
    await expect(host(runner).stop('web')).resolves.toEqual({
      ok: true,
      message: 'com.example.ongoing was not loaded'
    });
  });

  it('names the log files each service writes', () => {
    const { runner } = recorder({});
    expect(host(runner).logs('web').files).toEqual([
      '/home/pat/Library/Logs/Ongoing/stdout.log',
      '/home/pat/Library/Logs/Ongoing/stderr.log'
    ]);
    expect(host(runner).logs('scan').files).toEqual([
      '/home/pat/Library/Logs/Ongoing/scan-stdout.log',
      '/home/pat/Library/Logs/Ongoing/scan-stderr.log'
    ]);
  });
});
