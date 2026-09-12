import type { AttributeValue } from '$lib/domain/entry';
import type { FieldDefinition } from '$lib/domain/fields';

/** Presentation only. Nothing here decides anything; the domain owns every rule. */

export const EM_DASH = '—';

export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  if (Math.abs(value) < 1_000) return String(value);
  return `${(value / 1_000).toFixed(Math.abs(value) < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

export function relativeAge(value: string | null | undefined, now = Date.now()): string {
  if (!value) return 'never';
  const milliseconds = now - Date.parse(value);
  if (!Number.isFinite(milliseconds)) return 'unknown';
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 43_200) return `${Math.round(minutes / 1_440)}d`;
  return `${Math.round(minutes / 43_200)}mo`;
}

export function fullDate(value: string | null | undefined): string {
  if (!value) return 'not collected';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toLocaleString();
}

export function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  return `${value >= 0 ? '+' : ''}${value}`;
}

/** ISO timestamps live in `text` fields (`git.latestCommit`); they read as ages, not as strings. */
const TIMESTAMP_KEYS = new Set([
  'git.latestCommit',
  'github.oldestExternalPr',
  'created_at',
  'updated_at'
]);

export function isTimestampField(definition: FieldDefinition | undefined): boolean {
  return Boolean(definition && definition.type === 'text' && TIMESTAMP_KEYS.has(definition.key));
}

/** One value, rendered the way its registered type asks to be read. */
export function formatValue(
  definition: FieldDefinition | undefined,
  value: AttributeValue | undefined,
  now = Date.now()
): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  if (Array.isArray(value)) return value.length ? value.join(', ') : EM_DASH;
  if (isTimestampField(definition)) return `${relativeAge(String(value), now)} ago`;
  switch (definition?.type) {
    case 'boolean':
      return value ? 'yes' : 'no';
    case 'number':
    case 'integer':
      return compactNumber(Number(value));
    case 'json':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/** The value an editor starts from: always a string, except booleans and multi-value fields. */
export function editableValue(
  definition: FieldDefinition,
  value: AttributeValue | undefined
): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (definition.type === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
