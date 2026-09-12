import { fieldHasValue } from '$lib/domain/completeness';
import type { EntryView } from '$lib/domain/entry-view';
import { fieldAppliesTo, type FieldDefinition, type FieldRegistry } from '$lib/domain/fields';

/**
 * What a fact sheet shows, decided from the registry rather than from a list of known fields. A
 * field registered by `ongoing field add` appears here on its next render; a provider that is
 * switched off contributes no values, so its panel disappears rather than showing a column of
 * dashes (ADR 0008).
 */

/** Identity lives in the header, so it is not repeated among the editable decision fields. */
const IDENTITY_KEYS = new Set(['kind', 'name', 'slug']);

export function hasValue(entry: EntryView, key: string): boolean {
  return fieldHasValue(entry.fields[key]);
}

/** The fields a person decides: core and user-defined, editable, stored rather than projected. */
export function decisionFields(registry: FieldRegistry, kind: string): FieldDefinition[] {
  return registry
    .forKind(kind)
    .filter(
      (field) =>
        field.editable &&
        field.storage !== 'projected' &&
        !IDENTITY_KEYS.has(field.key) &&
        (field.owner === 'core' || field.owner === 'user')
    );
}

export interface ProviderPanel {
  provider: string;
  fields: FieldDefinition[];
}

/**
 * Provider-contributed fields, grouped by the provider that owns them. Only providers with at
 * least one value on this entry get a panel unless `includeEmpty` says otherwise, which is the
 * "a fact sheet shows what has a value" rule the plan asks for.
 */
export function providerPanels(
  registry: FieldRegistry,
  entry: EntryView,
  includeEmpty = false
): ProviderPanel[] {
  const groups = new Map<string, FieldDefinition[]>();
  for (const field of registry.fields) {
    if (!field.owner.startsWith('provider:')) continue;
    if (!fieldAppliesTo(field, entry.kind)) continue;
    if (!includeEmpty && !hasValue(entry, field.key)) continue;
    const provider = field.owner.slice('provider:'.length);
    groups.set(provider, [...(groups.get(provider) ?? []), field]);
  }
  return [...groups.entries()]
    .map(([provider, fields]) => ({ provider, fields }))
    .sort((left, right) => left.provider.localeCompare(right.provider, 'en'));
}
