import { readFileSync } from 'node:fs';
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
  PRODUCTION_BUN_VERSION,
  PRODUCTION_SCAN_LABEL,
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
      bunVersion: PRODUCTION_BUN_VERSION,
      webLabel: PRODUCTION_WEB_LABEL,
      scanLabel: PRODUCTION_SCAN_LABEL,
      webPlist: PRODUCTION_WEB_PLIST,
      scanPlist: PRODUCTION_SCAN_PLIST,
      healthUrl: 'http://127.0.0.1:7766/api/health'
    });
    expect(decodeReleaseConfig(encodeReleaseConfig(config))).toEqual(config);
    expect(() => decodeReleaseConfig('not valid config!')).toThrow(/base64url/);
    expect(() =>
      decodeReleaseConfig(encodeReleaseConfig({ ...config, bunVersion: '1.3.9' }))
    ).toThrow(/unsupported targets/);
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
    expect(deployText.indexOf('quiesce')).toBeLessThan(deployText.indexOf('back up'));
    expect(deployText.indexOf('back up')).toBeLessThan(deployText.indexOf('apply migrations'));
    expect(deploy.filter((step) => step === 'apply migrations')).toHaveLength(1);
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

  it('uses one exact app-scoped Bun 1.3.1 executable for both agents', () => {
    expect(web).toContain(`<string>${PRODUCTION_BUN}</string>`);
    expect(scan).toContain(`<string>${PRODUCTION_BUN}</string>`);
    expect(provision).toContain(`readonly bun=${PRODUCTION_BUN}`);
    expect(provision).toContain('MISE_DATA_DIR="$mise_data" "$mise" install');
    expect(provision).not.toContain('/.bun/bin/bun');
  });

  it('configures the authenticated web process on 7766 with in-process scans disabled', () => {
    expect(web).toContain(`<key>Label</key><string>${PRODUCTION_WEB_LABEL}</string>`);
    expect(web).toContain('<key>PORT</key><string>7766</string>');
    expect(web).toContain('<key>ORIGIN</key><string>http://aerie.local:7766</string>');
    expect(web).toContain('<key>ONGOING_ENABLE_SCAN_SCHEDULER</key><string>false</string>');
    expect(web).toContain('<key>RunAtLoad</key><true/>');
    expect(web).toContain('<key>KeepAlive</key><true/>');
  });

  it('runs only the shared scanner at 04:00 with shared storage and no load loop', () => {
    expect(scan).toContain(`<key>Label</key><string>${PRODUCTION_SCAN_LABEL}</string>`);
    expect(scan.match(/<key>StartCalendarInterval<\/key>/g)).toHaveLength(1);
    expect(scan).toMatch(/<key>Hour<\/key><integer>4<\/integer>/);
    expect(scan).toMatch(/<key>Minute<\/key><integer>0<\/integer>/);
    expect(scan).not.toContain('<key>RunAtLoad</key>');
    expect(scan).not.toContain('<key>KeepAlive</key>');
    expect(scan).toContain('/Users/marcusvorwaller/code/ongoing/scripts/scan.ts');
    for (const shared of [
      '<key>SCAN_ROOTS</key><string>/Users/marcusvorwaller/code</string>',
      '<key>DATABASE_PATH</key><string>/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite</string>'
    ]) {
      expect(web).toContain(shared);
      expect(scan).toContain(shared);
    }
    expect(PRODUCTION_SCAN_LABEL).not.toBe(PRODUCTION_WEB_LABEL);
  });
});
