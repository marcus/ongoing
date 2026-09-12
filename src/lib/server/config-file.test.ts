import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  configPathFrom,
  parseConfigFile,
  providerSettings,
  readConfigFile,
  renderConfigFile
} from './config-file';
import { loadConfig, resolveEnabledProviders } from './config';

const directory = mkdtempSync(join(tmpdir(), 'ongoing-config-'));

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function write(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

const example = `
[server]
port = 7800

[scan]
roots = ["~/work", "~/code"]

[providers]
enabled = ["filesystem", "git", "stack", "tech-signatures"]

[providers.filesystem]
max_depth = 5

[providers.github]
token_env = "WORK_GITHUB_TOKEN"

[providers.endoflife]
max_age_hours = 72

[host]
adapter = "foreground"
`;

describe('the configuration file', () => {
  it('reads providers, their settings, and the host adapter', () => {
    const file = parseConfigFile(example);
    expect(file.providers?.enabled).toEqual(['filesystem', 'git', 'stack', 'tech-signatures']);
    expect(providerSettings(file, 'github')).toEqual({ token_env: 'WORK_GITHUB_TOKEN' });
    expect(file.host?.adapter).toBe('foreground');
    const config = loadConfig({ HOST: '127.0.0.1' }, file);
    expect(config.port).toBe(7800);
    expect(config.maxScanDepth).toBe(5);
    expect(config.scanRoots).toHaveLength(2);
    expect(config.hostAdapter).toBe('foreground');
    expect(config.releaseBaselineEnabled).toBe(false);
    expect(config.providers.enabled).toEqual(['filesystem', 'git', 'stack', 'tech-signatures']);
    expect(config.providers.settings.github).toEqual({ token_env: 'WORK_GITHUB_TOKEN' });
  });

  it('lets the environment override the file, and the file override the default', () => {
    const file = parseConfigFile(example);
    expect(loadConfig({ HOST: '127.0.0.1', PORT: '9100' }, file).port).toBe(9100);
    expect(loadConfig({ HOST: '127.0.0.1' }, file).port).toBe(7800);
    expect(loadConfig({ HOST: '127.0.0.1' }).port).toBe(4173);
    expect(
      loadConfig({ HOST: '127.0.0.1', ONGOING_HOST_ADAPTER: 'launchd' }, file).hostAdapter
    ).toBe('launchd');
  });

  it('keeps every provider on when nothing says otherwise', () => {
    expect(resolveEnabledProviders({}, {})).toContain('github');
    expect(resolveEnabledProviders({ ONGOING_DISABLE_PROVIDERS: 'github,td' }, {})).not.toContain(
      'github'
    );
    // The pre-manifest environment switch keeps meaning what it meant.
    expect(resolveEnabledProviders({ ONGOING_ENABLE_RELEASE_BASELINE: 'false' }, {})).not.toContain(
      'endoflife'
    );
    expect(resolveEnabledProviders({ ONGOING_PROVIDERS: 'git,loc' }, {})).toEqual(['git', 'loc']);
  });

  it('refuses a section or a key it does not understand', () => {
    expect(() => parseConfigFile('[nonsense]\na = 1\n')).toThrow(/Unknown configuration section/);
    expect(() => parseConfigFile('[scan]\nroot = "~/code"\n')).toThrow(/Unknown \[scan\] key/);
    expect(() => parseConfigFile('[providers]\ngithub = "on"\n')).toThrow(/must be a table/);
    expect(() => parseConfigFile('not = toml = at = all')).toThrow(/not valid TOML/);
  });

  it('treats a missing file as no configuration at all', () => {
    const missing = readConfigFile(join(directory, 'absent.toml'));
    expect(missing).toMatchObject({ present: false, config: {} });
  });

  it('reads the file named by ONGOING_CONFIG', () => {
    const path = write('custom.toml', '[providers]\ndisabled = ["loc"]\n');
    expect(configPathFrom({ ONGOING_CONFIG: path })).toBe(path);
    const loaded = readConfigFile(path);
    expect(loaded.present).toBe(true);
    expect(resolveEnabledProviders({}, loaded.config)).not.toContain('loc');
  });

  it('names the file in the error when it cannot be parsed', () => {
    const path = write('broken.toml', '[scan]\nroots = 3\n');
    expect(() => readConfigFile(path)).toThrow(new RegExp(`${path}: `));
  });

  /** What `ongoing init` writes has to parse as the configuration it claims to be. */
  it('renders a template this same parser accepts, with the choices a first install makes', () => {
    const text = renderConfigFile({
      dataDir: '/srv/ongoing',
      scanRoots: ['/srv/src', '/srv/work'],
      port: 7801,
      hostAdapter: 'foreground'
    });
    const parsed = parseConfigFile(text);
    expect(parsed.server).toMatchObject({
      database: '/srv/ongoing/ongoing.sqlite',
      port: 7801
    });
    expect(parsed.scan?.roots).toEqual(['/srv/src', '/srv/work']);
    expect(parsed.host?.adapter).toBe('foreground');
    expect(providerSettings(parsed, 'github').discover).toEqual([]);
    expect(loadConfig({}, parsed, '/etc/ongoing.toml')).toMatchObject({
      databasePath: '/srv/ongoing/ongoing.sqlite',
      port: 7801,
      hostAdapter: 'foreground',
      scanRoots: ['/srv/src', '/srv/work'],
      githubDiscoverOwners: []
    });
    // Every key it does not choose is present as a comment, so the file is its own reference.
    expect(text).toContain('# max_depth = 3');
    expect(text).toContain('# include_forks = false');
  });
});
