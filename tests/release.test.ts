import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeReleaseConfig,
  encodeReleaseConfig,
  parseReleaseArgs,
  PRODUCTION_CHECKOUT,
  PRODUCTION_DATABASE,
  PRODUCTION_HOST,
  PRODUCTION_BUN,
  PRODUCTION_SCAN_LABEL,
  PRODUCTION_SCAN_PATH,
  PRODUCTION_SCAN_PLIST,
  PRODUCTION_WEB_LABEL,
  PRODUCTION_WEB_PLIST,
  releasePlan
} from '../scripts/release-config';

const required = [
  '--host',
  PRODUCTION_HOST,
  '--checkout',
  PRODUCTION_CHECKOUT,
  '--database',
  PRODUCTION_DATABASE
];

describe('release tooling', () => {
  it('requires all three exact production targets', () => {
    expect(() => parseReleaseArgs([])).toThrow(/required explicit targets/);
    expect(() =>
      parseReleaseArgs([...required.slice(0, 1), 'root@example.test', ...required.slice(2)])
    ).toThrow(/host must be exactly/);
    expect(() =>
      parseReleaseArgs([...required.slice(0, 3), '/tmp/ongoing', ...required.slice(4)])
    ).toThrow(/checkout must be exactly/);
    expect(() => parseReleaseArgs([...required, '--unknown'])).toThrow(/unknown argument/);
  });

  it('round-trips only validated remote configuration', () => {
    const { config } = parseReleaseArgs(required);
    expect(config).toMatchObject({
      bunExecutable: PRODUCTION_BUN,
      webLabel: PRODUCTION_WEB_LABEL,
      scanLabel: PRODUCTION_SCAN_LABEL,
      webPlist: PRODUCTION_WEB_PLIST,
      scanPlist: PRODUCTION_SCAN_PLIST,
      healthUrl: 'http://127.0.0.1:7766/api/health'
    });
    expect(decodeReleaseConfig(encodeReleaseConfig(config))).toEqual(config);
    expect(() => decodeReleaseConfig('not valid config!')).toThrow(/base64url/);
    expect(() =>
      decodeReleaseConfig(encodeReleaseConfig({ ...config, bunExecutable: '/usr/local/bin/bun' }))
    ).toThrow(/unsupported targets/);
  });

  it('pins every Aerie production target beneath the canonical marcus home', () => {
    const { config } = parseReleaseArgs(required);
    expect(config).toMatchObject({
      checkout: '/Users/marcus/code/ongoing',
      database: '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite',
      webPlist: '/Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist',
      scanPlist: '/Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist',
      bunExecutable: '/Users/marcus/.local/share/ongoing/bun'
    });
  });

  it('makes destructive rollback restoration opt-in and documents bounded operations', () => {
    const { config } = parseReleaseArgs([...required, '--dry-run']);
    const deploy = releasePlan('deploy', config);
    const rollback = releasePlan('rollback', config);
    const restoringRollback = releasePlan('rollback', config, true);
    expect(deploy).toEqual(
      expect.arrayContaining(['fetch origin main and fast-forward only', 'record deployed SHA'])
    );
    expect(rollback).not.toEqual(
      expect.arrayContaining([expect.stringContaining('restore the recorded pre-deploy database')])
    );
    expect(restoringRollback).toEqual(expect.arrayContaining([expect.stringContaining('restore')]));
    for (const plan of [deploy, restoringRollback]) {
      expect(plan.join('\n')).toContain(PRODUCTION_BUN);
      expect(plan.join('\n')).toContain(
        `quiesce ${PRODUCTION_WEB_LABEL} and ${PRODUCTION_SCAN_LABEL}`
      );
      expect(plan.join('\n')).toContain(PRODUCTION_WEB_PLIST);
      expect(plan.join('\n')).toContain(PRODUCTION_SCAN_PLIST);
      expect(plan.join('\n')).toContain('without an immediate scan');
      expect(plan.join('\n')).toContain('http://127.0.0.1:7766/api/health');
    }
    const deployText = deploy.join('\n');
    expect(deployText).toContain(`validate ${PRODUCTION_SCAN_PATH}`);
    expect(deployText.indexOf('validate')).toBeLessThan(deployText.indexOf('quiesce'));
    expect(deployText.indexOf('quiesce')).toBeLessThan(deployText.indexOf('back up'));
    expect(deployText.indexOf('back up')).toBeLessThan(deployText.indexOf('apply migrations'));
    expect(deploy.filter((step) => step.includes('apply migrations'))).toHaveLength(1);
    const rollbackText = restoringRollback.join('\n');
    expect(rollbackText.indexOf('quiesce')).toBeLessThan(rollbackText.indexOf('back up'));
    expect(rollbackText.indexOf('back up')).toBeLessThan(rollbackText.indexOf('switch to'));
    expect(rollbackText.indexOf('switch to')).toBeLessThan(
      rollbackText.indexOf('restore the recorded pre-deploy database')
    );
  });
});

describe('production LaunchAgent definitions', () => {
  const web = readFileSync(resolve('config/ongoing.plist.example'), 'utf8');
  const scan = readFileSync(resolve('config/ongoing-scan.plist.example'), 'utf8');
  const provision = readFileSync(resolve('scripts/provision-runtime.sh'), 'utf8');
  const deployment = readFileSync(resolve('docs/deployment.md'), 'utf8');
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const productionSmoke = readFileSync(resolve('scripts/production-smoke.ts'), 'utf8');
  const remoteRelease = readFileSync(resolve('scripts/remote-release.ts'), 'utf8');

  it('uses one stable app-scoped Bun executable, provisioned from .bun-version, for both agents', () => {
    expect(PRODUCTION_BUN).not.toMatch(/\d+\.\d+\.\d+/);
    expect(web).toContain(`<string>${PRODUCTION_BUN}</string>`);
    expect(web).toContain(
      '<string>/Users/marcus/code/ongoing/scripts/production-server.ts</string>'
    );
    expect(scan).toContain(`<string>${PRODUCTION_BUN}</string>`);
    expect(provision).toContain(`readonly bun=${PRODUCTION_BUN}`);
    expect(provision).toContain('< "$checkout/.bun-version"');
    expect(provision).toContain(
      'MISE_DATA_DIR="$mise_data" "$mise" install "bun@$required_version"'
    );
    expect(provision).toContain('ln -sfn "$installed" "$bun"');
    expect(provision).not.toContain('/.bun/bin/bun');
    expect(deployment).toContain(`ongoing_bun=${PRODUCTION_BUN}`);
  });

  it('re-provisions the runtime whenever the checkout moves, before building with it', () => {
    const deploySteps = remoteRelease.slice(remoteRelease.indexOf('async function deploy('));
    expect(deploySteps.indexOf("'--ff-only'")).toBeLessThan(
      deploySteps.indexOf('await provisionRuntime(config);')
    );
    const rollbackSteps = remoteRelease.slice(remoteRelease.indexOf('async function rollback('));
    expect(rollbackSteps.indexOf("'--detach'")).toBeLessThan(
      rollbackSteps.indexOf('await provisionRuntime(config);')
    );
    for (const steps of [deploySteps, rollbackSteps])
      expect(steps.indexOf('await provisionRuntime(config);')).toBeLessThan(
        steps.indexOf("'--frozen-lockfile'")
      );
  });

  it('keeps production entrypoints on the invoking exact Bun without ambient PATH fallback', () => {
    for (const name of ['test:production', 'deploy', 'rollback', 'smoke', 'migrate', 'scan']) {
      expect(packageJson.scripts[name]).toContain('$npm_execpath');
      expect(packageJson.scripts[name]).not.toMatch(/(^|&& )bun /);
    }
    expect(productionSmoke).toContain(
      "Bun.spawn([process.execPath, 'run', 'scripts/production-server.ts']"
    );
    expect(deployment).toContain('"$ongoing_bun" run scripts/migrate.ts');
    expect(deployment).toContain('"$ongoing_bun" run scripts/scan.ts');
    expect(deployment).toContain('"$ongoing_bun" run scripts/smoke.ts');
    expect(deployment).toContain('scripts/smoke.ts http://aerie.local:7766');
    expect(deployment).toContain('http://127.0.0.1:7766/api/health');
    expect(deployment).not.toContain('scripts/smoke.ts http://127.0.0.1:7766');
    expect(deployment).not.toContain('"$ongoing_bun" run migrate');
    expect(deployment).not.toContain('"$ongoing_bun" run scan');
  });

  it('configures the authenticated web process on 7766 with in-process scans disabled', () => {
    expect(web).toContain(`<key>Label</key><string>${PRODUCTION_WEB_LABEL}</string>`);
    expect(web).toContain('<key>PORT</key><string>7766</string>');
    expect(web).toContain('<key>ORIGIN</key><string>http://aerie.local:7766</string>');
    expect(web).toContain('<key>ONGOING_ENABLE_SCAN_SCHEDULER</key><string>false</string>');
    expect(web).toContain('<key>RunAtLoad</key><true/>');
    expect(web).toContain('<key>KeepAlive</key><true/>');
    // Scans triggered through the API run in this process, so it needs the collectors' tools too.
    expect(web).toContain(`<key>PATH</key><string>${PRODUCTION_SCAN_PATH}</string>`);
  });

  it('runs only the shared scanner at 03:00 with shared storage and no load loop', () => {
    expect(scan).toContain(`<key>Label</key><string>${PRODUCTION_SCAN_LABEL}</string>`);
    expect(scan.match(/<key>StartCalendarInterval<\/key>/g)).toHaveLength(1);
    expect(scan).toMatch(/<key>Hour<\/key><integer>3<\/integer>/);
    expect(scan).toMatch(/<key>Minute<\/key><integer>0<\/integer>/);
    expect(scan).not.toContain('<key>RunAtLoad</key>');
    expect(scan).not.toContain('<key>KeepAlive</key>');
    expect(scan).toContain('/Users/marcus/code/ongoing/scripts/scan.ts');
    expect(scan).toContain(`<key>PATH</key><string>${PRODUCTION_SCAN_PATH}</string>`);
    expect(PRODUCTION_SCAN_PATH.split(':')).toEqual([
      '/Users/marcus/.local/share/mise/shims',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin'
    ]);
    expect(PRODUCTION_SCAN_PATH).not.toMatch(/~|\.bun|Users\/marcus\/(bin|go)\b/);
    for (const shared of [
      '<key>SCAN_ROOTS</key><string>/Users/marcus/code</string>',
      '<key>DATABASE_PATH</key><string>/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite</string>'
    ]) {
      expect(web).toContain(shared);
      expect(scan).toContain(shared);
    }
    expect(PRODUCTION_SCAN_LABEL).not.toBe(PRODUCTION_WEB_LABEL);
  });

  it('resolves every scheduled tool with only the launchd PATH', async () => {
    // launchd gives the agent this PATH and nothing else from a shell — but it does set HOME, and
    // `gh` is a mise shim that reads the user's mise config to resolve its version. So the probe
    // runs with the real HOME and no other inherited environment: that is exactly what the
    // scheduled scan gets.
    const probes = [
      [process.execPath, '--version'],
      ['gh', '--version'],
      ['gh', 'auth', 'status'],
      ['td', '--version'],
      ['cloc', '--version'],
      ['git', '--version']
    ];
    for (const probe of probes) {
      const child = Bun.spawn(probe, {
        cwd: process.cwd(),
        env: { HOME: homedir(), PATH: PRODUCTION_SCAN_PATH },
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      // A logged-out or rate-limited `gh auth status` exits 1; the collector treats that as
      // "unavailable" rather than a failure, so it must not fail this test either.
      if (probe[1] === 'auth') expect([0, 1]).toContain(status);
      else expect(status, `${probe[0]} was not available: ${stderr}`).toBe(0);
    }
    expect(Bun.version).toBe(readFileSync(resolve('.bun-version'), 'utf8').trim());
  });

  it('preflights tooling before quiescing and reloads the installed scan definition', () => {
    expect(remoteRelease).toContain('await validateScanTooling(config);');
    expect(remoteRelease).toContain("['gh', '--version']");
    expect(remoteRelease).toContain("['td', '--version']");
    expect(remoteRelease).toContain("['cloc', '--version']");
    expect(remoteRelease).toContain("['git', '--version']");
    expect(remoteRelease.indexOf('await validateScanTooling(config);')).toBeLessThan(
      remoteRelease.indexOf('await quiesce(config);')
    );
    expect(remoteRelease).toContain('await installDefinition(scanSource, config.scanPlist);');
    expect(remoteRelease).toContain(
      "await command(['launchctl', 'bootstrap', domain, config.scanPlist], config.checkout);"
    );
  });
});
