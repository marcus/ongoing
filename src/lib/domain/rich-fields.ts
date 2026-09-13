export interface ArtifactRef extends Record<string, unknown> {
  hash: string;
  mediaType: string;
  size: number;
}
export interface RichFieldValue extends Record<string, unknown> {
  kind: string;
  version: number;
  revision: string;
  manifest: ArtifactRef;
  poster: ArtifactRef;
}

export interface RichFieldAdapter {
  id: string;
  bundleKind: string;
  referenceKind: string;
  manifestMediaType: string;
  validateDocument(value: unknown): void;
}

export class AttachmentConflictError extends Error {
  constructor(
    readonly currentRevision: string | null,
    readonly expectedRevision: string | null
  ) {
    super(
      `Attachment conflict: expected ${expectedRevision ?? 'none'}, current ${currentRevision ?? 'none'}`
    );
    this.name = 'AttachmentConflictError';
  }
}

export const impressionsLogoAdapter: RichFieldAdapter = {
  id: 'impressions.logo.v1',
  bundleKind: 'impressions.logo.bundle',
  referenceKind: 'impressions.logo.ref',
  manifestMediaType: 'application/vnd.impressions.logo+json',
  validateDocument(value) {
    parseLogoDocument(value);
  }
};

export const portableJsonAdapter: RichFieldAdapter = {
  id: 'portable.json.v1',
  bundleKind: 'ongoing.portable-json.bundle',
  referenceKind: 'ongoing.portable-json.ref',
  manifestMediaType: 'application/json',
  validateDocument(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('portable JSON document must be an object');
  }
};

const adapters = new Map(
  [impressionsLogoAdapter, portableJsonAdapter].map((adapter) => [adapter.id, adapter])
);
export function richFieldAdapter(id: string): RichFieldAdapter | undefined {
  return adapters.get(id);
}
export function hasRichFieldAdapter(id: string): boolean {
  return adapters.has(id);
}
import { parseLogoDocument } from '@impressions/logo/document';
