import type { EntryView } from '$lib/domain/entry-view';
import type { FieldDefinition, FieldRegistry } from '$lib/domain/fields';

export function roleField(
  registry: FieldRegistry,
  kind: string,
  role: string
): FieldDefinition | null {
  return (
    registry.fields.find(
      (field) =>
        field.presentation?.role === role &&
        (field.kinds.includes('*') || field.kinds.includes(kind))
    ) ?? null
  );
}

export function artifactHash(
  entry: EntryView,
  field: FieldDefinition | null,
  part: string
): string | null {
  if (!field) return null;
  const value = entry.fields[field.key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const artifact = (value as Record<string, unknown>)[part];
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const hash = (artifact as Record<string, unknown>).hash;
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}
