import { describe, expect, it } from 'vitest';
import { createFieldRegistry } from './fields';
import {
  activeProviders,
  fieldsForProviders,
  orderProviders,
  providerFieldDefinitions,
  providerManifests,
  providerNames,
  resolveProviderAvailability,
  resolveProviders,
  type ProviderManifest,
  type ProviderProbe
} from './provider';

const everything: ProviderProbe = {
  commands: new Set(providerManifests.flatMap((manifest) => manifest.requires?.commands ?? [])),
  env: new Set(providerManifests.flatMap((manifest) => manifest.requires?.env ?? []))
};

const bare: ProviderProbe = { commands: new Set(['git']), env: new Set() };

describe('provider manifests', () => {
  it('declares every provider the plan names', () => {
    expect(providerNames).toEqual(
      expect.arrayContaining([
        'filesystem',
        'git',
        'loc',
        'td',
        'stack',
        'github',
        'endoflife',
        'tech-signatures'
      ])
    );
  });

  it('owns every namespaced field in the registry, and no field twice', () => {
    const keys = providerManifests.flatMap((manifest) => manifest.fields.map(({ key }) => key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const manifest of providerManifests)
      for (const field of manifest.fields) {
        expect(field.owner).toBe(`provider:${manifest.name}`);
        expect(field.editable).toBe(false);
        expect(field.storage).toBe('projected');
      }
    // The registry is built from the manifests, so a field can only exist because one declares it.
    const registry = createFieldRegistry();
    for (const field of providerFieldDefinitions) expect(registry.get(field.key)).toBeDefined();
  });

  it('orders providers so nothing runs before what it reads', () => {
    const order = orderProviders().map(({ name }) => name);
    for (const manifest of providerManifests)
      for (const dependency of manifest.dependsOn ?? [])
        expect(order.indexOf(dependency)).toBeLessThan(order.indexOf(manifest.name));
  });

  it('names dependencies that exist', () => {
    for (const manifest of providerManifests)
      for (const dependency of manifest.dependsOn ?? [])
        expect(providerNames).toContain(dependency);
  });
});

describe('provider availability', () => {
  it('is available when the machine has what the manifest asks for', () => {
    const states = resolveProviders(() => true, everything);
    expect(activeProviders(states)).toEqual(orderProviders().map(({ name }) => name));
    expect(states.every(({ reason }) => reason === null)).toBe(true);
  });

  it('reports a missing command rather than failing', () => {
    const states = resolveProviders(() => true, bare);
    const byName = new Map(states.map((state) => [state.name, state]));
    expect(byName.get('td')).toMatchObject({
      state: 'unavailable',
      available: false,
      reason: 'td is not on PATH'
    });
    expect(byName.get('loc')?.reason).toBe('cloc is not on PATH');
    expect(byName.get('github')?.reason).toBe('gh is not on PATH');
    expect(byName.get('git')?.state).toBe('active');
    expect(activeProviders(states)).toEqual([
      'filesystem',
      'git',
      'stack',
      'tech-signatures',
      'endoflife'
    ]);
  });

  it('says so when configuration turned a provider off', () => {
    const states = resolveProviders((name) => name !== 'github', everything);
    expect(states.find(({ name }) => name === 'github')).toMatchObject({
      enabled: false,
      state: 'disabled',
      reason: 'disabled in configuration'
    });
  });

  it('stands a provider down when what it depends on cannot run', () => {
    const states = resolveProviders((name) => name !== 'stack', everything);
    expect(states.find(({ name }) => name === 'tech-signatures')).toMatchObject({
      state: 'unavailable',
      reason: 'stack is not running'
    });
    expect(activeProviders(states)).not.toContain('endoflife');
  });

  it('registers no fields for a provider that cannot run', () => {
    const active = activeProviders(resolveProviders(() => true, bare));
    const registry = createFieldRegistry([], { providers: active });
    expect(registry.get('git.commits30d')).toBeDefined();
    expect(registry.get('td.open')).toBeUndefined();
    expect(registry.get('loc.code')).toBeUndefined();
    expect(registry.get('github.stars')).toBeUndefined();
    // Catalog-derived fields are facts about the catalog, not measurements, so they stay.
    expect(registry.get('views')).toBeDefined();
    expect(registry.get('tech')).toBeDefined();
    expect(fieldsForProviders(active).some(({ key }) => key === 'td.open')).toBe(false);
  });

  it('refuses a dependency cycle rather than looping', () => {
    const cyclic: ProviderManifest[] = [
      {
        name: 'a',
        kinds: ['project'],
        fields: [],
        schedule: 'every-scan',
        dependsOn: ['b'],
        description: 'a'
      },
      {
        name: 'b',
        kinds: ['project'],
        fields: [],
        schedule: 'every-scan',
        dependsOn: ['a'],
        description: 'b'
      }
    ];
    expect(() => orderProviders(cyclic)).toThrow(/cycle/);
  });

  it('reports several missing requirements in one sentence', () => {
    const manifest: ProviderManifest = {
      name: 'invented',
      kinds: ['project'],
      fields: [],
      requires: { commands: ['nope', 'nor'], env: ['ABSENT'] },
      schedule: 'daily',
      description: 'invented'
    };
    expect(
      resolveProviderAvailability(manifest, true, { commands: new Set(), env: new Set() }).reason
    ).toBe('nope, nor are not on PATH; ABSENT is not set');
  });
});
