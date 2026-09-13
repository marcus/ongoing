import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  AttachmentConflictError,
  richFieldAdapter,
  type ArtifactRef,
  type RichFieldValue
} from '$lib/domain/rich-fields';
import type { CatalogRepository } from '$lib/server/catalog/repository';

export const LOGO_FIELD = 'identity.logo';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_POSTER_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_REQUEST_BYTES = 16 * 1024 * 1024;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Buffer): void {
  if (bytes.length > MAX_POSTER_BYTES || !bytes.subarray(0, 8).equals(PNG))
    throw new Error('poster is not a valid PNG or exceeds 10 MiB');
  let offset = 8,
    width = 0,
    height = 0,
    sawHeader = false,
    sawEnd = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length && !sawEnd) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('poster PNG is truncated');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(chunk) !== bytes.readUInt32BE(offset + 8 + length))
      throw new Error('poster PNG checksum is invalid');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('poster PNG header is invalid');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        data[8] !== 8 ||
        data[9] !== 6 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new Error('poster PNG must be a non-interlaced 8-bit RGBA image up to 4096px');
      sawHeader = true;
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') {
      if (length !== 0) throw new Error('poster PNG end marker is invalid');
      sawEnd = true;
    }
    offset = end;
  }
  if (!sawEnd || offset !== bytes.length || !compressed.length)
    throw new Error('poster PNG is incomplete');
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(compressed));
  } catch {
    throw new Error('poster PNG image data is invalid');
  }
  if (pixels.length !== height * (1 + width * 4))
    throw new Error('poster PNG pixel data has the wrong size');
}

export function attachmentError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unable to handle attachment';
  if (error instanceof AttachmentConflictError)
    return {
      status: 409,
      body: { error: message, conflict: true, revision: error.currentRevision }
    };
  return {
    status: message.startsWith('Unknown project') ? 404 : 400,
    body: { error: message, conflict: false }
  };
}

export interface AttachmentBundle {
  kind: string;
  version: number;
  document: unknown;
  poster: { mediaType: string; base64: string };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class FileArtifactRepository {
  readonly root: string;
  constructor(databasePath: string) {
    this.root = join(dirname(databasePath), 'artifacts', 'sha256');
  }
  path(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid artifact hash');
    return join(this.root, digest.slice(0, 2), digest);
  }
  async put(bytes: Uint8Array, mediaType: string): Promise<ArtifactRef> {
    const digest = hash(bytes);
    const target = this.path(digest);
    await mkdir(dirname(target), { recursive: true });
    let valid = false;
    try {
      const stored = await readFile(target);
      valid = stored.byteLength === bytes.byteLength && hash(stored) === digest;
    } catch {
      // Missing files are written below.
    }
    if (!valid) {
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, target);
    }
    return { hash: digest, mediaType, size: bytes.byteLength };
  }
  read(digest: string): Promise<Buffer> {
    return readFile(this.path(digest));
  }
}

export class AttachmentService {
  readonly artifacts: FileArtifactRepository;
  constructor(
    private repository: CatalogRepository,
    databasePath: string
  ) {
    this.artifacts = new FileArtifactRepository(databasePath);
  }

  async ensureLogoField(): Promise<void> {
    const existing = this.repository.registry().get(LOGO_FIELD);
    const expected = {
      key: LOGO_FIELD,
      kinds: ['project'],
      type: 'json',
      label: 'Logo',
      description: 'Portable project identity artwork',
      sortable: false,
      filterable: false,
      editable: true,
      required: false,
      presentation: { adapter: 'impressions.logo.v1', role: 'identity' }
    };
    if (!existing) {
      await this.repository.addUserField(expected);
      return;
    }
    if (
      existing.owner !== 'user' ||
      existing.type !== 'json' ||
      existing.presentation?.adapter !== 'impressions.logo.v1' ||
      existing.presentation.role !== 'identity'
    )
      throw new Error(`${LOGO_FIELD} is already registered with an incompatible definition`);
  }

  async set(entryId: string, field: string, input: unknown, expected: string | null) {
    const entry = this.repository.getEntry(entryId);
    if (!entry || entry.kind !== 'project') throw new Error(`Unknown project ID: ${entryId}`);
    if (field === LOGO_FIELD) await this.ensureLogoField();
    const definition = this.repository.registry().get(field);
    if (!definition?.presentation) throw new Error(`Field ${field} is not a rich attachment field`);
    const adapter = richFieldAdapter(definition.presentation.adapter);
    if (!adapter)
      throw new Error(`Rich field adapter is unavailable: ${definition.presentation.adapter}`);
    const bundle = input as Partial<AttachmentBundle>;
    if (!bundle || bundle.kind !== adapter.bundleKind || bundle.version !== 1 || !bundle.poster)
      throw new Error(`bundle must be ${adapter.bundleKind} version 1`);
    adapter.validateDocument(bundle.document);
    if (bundle.poster.mediaType !== 'image/png' || typeof bundle.poster.base64 !== 'string')
      throw new Error('poster must contain base64 image/png');
    const poster = Buffer.from(bundle.poster.base64, 'base64');
    validatePng(poster);
    const manifestBytes = Buffer.from(canonical(bundle.document));
    const manifest = await this.artifacts.put(manifestBytes, adapter.manifestMediaType);
    const posterRef = await this.artifacts.put(poster, 'image/png');
    const revision = hash(Buffer.from(`${manifest.hash}:${posterRef.hash}`));
    const value: RichFieldValue = {
      kind: adapter.referenceKind,
      version: 1,
      revision,
      manifest,
      poster: posterRef
    };
    const latest = this.repository.getEntry(entryId)?.attributes[field] as
      Record<string, unknown> | undefined;
    if (latest?.revision === revision)
      return { entry: entryId, field, revision, value: latest as RichFieldValue };
    const updated = await this.repository.setAttributeIfRevision(entryId, field, value, expected);
    return { entry: updated.id, field, revision, value };
  }

  async get(entryId: string, field: string) {
    const entry = this.repository.getEntry(entryId);
    if (!entry || entry.kind !== 'project') throw new Error(`Unknown project ID: ${entryId}`);
    const value = entry.attributes[field] as unknown as RichFieldValue | undefined;
    const definition = this.repository.registry().get(field);
    const adapter = definition?.presentation
      ? richFieldAdapter(definition.presentation.adapter)
      : undefined;
    if (!value || !adapter || value.kind !== adapter.referenceKind)
      return { entry: entry.id, field, revision: null, value: null, document: null, poster: null };
    const document = JSON.parse((await this.artifacts.read(value.manifest.hash)).toString('utf8'));
    const poster = await this.artifacts.read(value.poster.hash);
    return {
      entry: entry.id,
      field,
      revision: value.revision,
      value,
      document,
      poster: { mediaType: value.poster.mediaType, base64: poster.toString('base64') },
      bundleKind: adapter.bundleKind
    };
  }
}
