import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentService } from './attachments';
import { CatalogDatabase } from './catalog/database';
import { CatalogRepository } from './catalog/repository';
import { transparentPng } from '../../../tests/fixtures/png';

const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'ongoing-attachment-'));
  directories.push(directory);
  const databasePath = join(directory, 'catalog.sqlite');
  const database = new CatalogDatabase(databasePath);
  const repository = new CatalogRepository(database);
  return { database, repository, service: new AttachmentService(repository, databasePath) };
}

async function project(repository: CatalogRepository) {
  return repository.upsertDiscovered({
    canonicalPath: '/code/ongoing',
    relativePath: 'ongoing',
    name: 'Ongoing',
    scanRoot: '/code'
  });
}

const document = {
  kind: 'impressions.logo',
  version: 1,
  recipe: {
    shape: 'vibes',
    count: 48,
    size: 0.04,
    palette: 'vibes',
    treatment: 'halftone',
    surface: 'none',
    thickness: 0.012,
    extrusion: 0
  },
  camera: { yaw: 0, pitch: 0, roll: 0, scale: 1, distance: 4 },
  renderer: {
    profile: 'impressions.point-study',
    version: 1,
    canvas: { width: 1024, height: 1024 },
    background: 'transparent'
  },
  snapshot: {
    generator: 'test-v1',
    version: 1,
    positions: [
      [0, 0, 0],
      [0.5, 0, 0]
    ],
    contours: [
      [0, 0, 0],
      [0.5, 0, 0]
    ],
    color: '#ffffff',
    radius: 0.04,
    treatment: 'halftone',
    surface: 'none',
    thickness: 0.012
  }
};
const png = transparentPng().toString('base64');
const bundle = {
  kind: 'impressions.logo.bundle',
  version: 1,
  document,
  poster: { mediaType: 'image/png', base64: png }
};

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('rich attachment operation', () => {
  it('stores immutable bytes, registers metadata, reads the complete bundle, and retries idempotently', async () => {
    const { database, repository, service } = setup();
    const entry = await project(repository);
    expect(await service.get(entry.id, 'identity.logo')).toMatchObject({
      revision: null,
      document: null
    });
    const first = await service.set(entry.id, 'identity.logo', bundle, null);
    const second = await service.set(entry.id, 'identity.logo', bundle, null);
    expect(second.revision).toBe(first.revision);
    expect(await service.get(entry.id, 'identity.logo')).toMatchObject({
      revision: first.revision,
      document
    });
    expect(repository.registry().get('identity.logo')).toMatchObject({
      type: 'json',
      sortable: false,
      filterable: false,
      presentation: { adapter: 'impressions.logo.v1', role: 'identity' }
    });
    await expect(
      repository.patchEntry(entry.id, {
        'identity.logo': { kind: 'impressions.logo.ref', revision: 'fabricated' }
      })
    ).rejects.toThrow(/attachment API/);
    expect((await service.get(entry.id, 'identity.logo')).revision).toBe(first.revision);
    database.close();
  });

  it('imports another trusted rich field without attachment-service field conditionals', async () => {
    const { database, repository, service } = setup();
    const entry = await project(repository);
    await repository.addUserField({
      key: 'x.portable',
      kinds: ['project'],
      type: 'json',
      presentation: { adapter: 'portable.json.v1', role: 'preview' }
    });
    const generic = {
      kind: 'ongoing.portable-json.bundle',
      version: 1,
      document: { hello: 'world' },
      poster: { mediaType: 'image/png', base64: png }
    };
    const saved = await service.set(entry.id, 'x.portable', generic, null);
    expect(await service.get(entry.id, 'x.portable')).toMatchObject({
      revision: saved.revision,
      document: { hello: 'world' },
      bundleKind: generic.kind
    });
    database.close();
  });

  it('preserves the selected value on conflict and malformed input', async () => {
    const { database, repository, service } = setup();
    const entry = await project(repository);
    const first = await service.set(entry.id, 'identity.logo', bundle, null);
    const changed = {
      ...bundle,
      document: { ...document, recipe: { ...document.recipe, size: 0.05 } }
    };
    await expect(service.set(entry.id, 'identity.logo', changed, 'stale')).rejects.toThrow(
      /Attachment conflict/
    );
    await expect(
      service.set(
        entry.id,
        'identity.logo',
        { ...bundle, poster: { mediaType: 'image/png', base64: 'bad' } },
        first.revision
      )
    ).rejects.toThrow(/valid PNG/);
    expect((await service.get(entry.id, 'identity.logo')).revision).toBe(first.revision);
    database.close();
  });
});
