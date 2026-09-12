import type { AttributeValue } from '$lib/domain/entry';
import type { EntryView } from '$lib/domain/entry-view';
import {
  createFieldRegistry,
  FieldValidationError,
  type FieldDefinition,
  type FieldRegistry
} from '$lib/domain/fields';
import { applyPatch, inversePatch } from '$lib/domain/optimistic';
import type { SavedView } from '$lib/domain/view';

export interface CatalogPayload {
  entries: EntryView[];
  fields: FieldDefinition[];
  views: SavedView[];
  generatedAt: string;
  loadError: string | null;
}

export interface StatusMessage {
  text: string;
  tone: 'info' | 'error';
  undo?: () => void;
}

/**
 * The browser's copy of the catalog, and the one place a mutation happens.
 *
 * Every edit is optimistic: the patch is validated and applied locally with the same pure domain
 * functions the server runs, the row moves immediately, and the server's answer either replaces
 * the row or the old one is put back with the error the API returned. Every mutation here has a
 * CLI verb behind the same endpoint — `ongoing set`, `favorite`, `hide`, `note`, `tag`.
 */
export class Catalog {
  entries = $state<EntryView[]>([]);
  views = $state<SavedView[]>([]);
  /**
   * The row the inventory list is on. It lives here rather than in the page because the palette,
   * which is part of the shell, runs its commands against whatever the list is focused on.
   */
  focused = $state<EntryView | null>(null);
  message = $state<StatusMessage | null>(null);
  /** Field keys with an edit in flight, per entry id, so a cell can look busy without a spinner. */
  pending = $state<Record<string, string[]>>({});
  generatedAt = $state('');
  loadError = $state<string | null>(null);

  #fields = $state<FieldDefinition[]>([]);
  #registry = $derived(createFieldRegistry(this.#fields.filter((field) => field.owner === 'user')));

  constructor(payload: CatalogPayload) {
    this.adopt(payload);
  }

  adopt(payload: CatalogPayload) {
    this.entries = payload.entries;
    this.views = payload.views;
    this.#fields = payload.fields;
    this.generatedAt = payload.generatedAt;
    this.loadError = payload.loadError;
  }

  get registry(): FieldRegistry {
    return this.#registry;
  }

  get fields(): FieldDefinition[] {
    return this.#fields;
  }

  byId(id: string): EntryView | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  bySlug(kind: string, slug: string): EntryView | undefined {
    return this.entries.find((entry) => entry.kind === kind && entry.slug === slug);
  }

  #replace(id: string, entry: EntryView) {
    this.entries = this.entries.map((candidate) => (candidate.id === id ? entry : candidate));
  }

  #markPending(id: string, keys: string[], busy: boolean) {
    const current = this.pending[id] ?? [];
    const next = busy
      ? [...current, ...keys.filter((key) => !current.includes(key))]
      : current.filter((key) => !keys.includes(key));
    this.pending = next.length
      ? { ...this.pending, [id]: next }
      : Object.fromEntries(Object.entries(this.pending).filter(([key]) => key !== id));
  }

  /**
   * Patch one entry. Returns true when the server accepted it. `undoable` is false for the undo
   * itself, so an undo does not offer to undo the undo.
   */
  async patch(
    entry: EntryView,
    patch: Record<string, unknown>,
    options: { undoable?: boolean; describe?: string } = {}
  ): Promise<boolean> {
    const keys = Object.keys(patch);
    const restore = entry;
    const reverse = inversePatch(entry, patch);
    let optimistic: EntryView;
    try {
      optimistic = applyPatch(entry, patch, this.registry);
    } catch (error) {
      this.message = {
        text: error instanceof FieldValidationError ? error.message : String(error),
        tone: 'error'
      };
      return false;
    }

    this.#replace(entry.id, optimistic);
    this.#markPending(entry.id, keys, true);
    try {
      const response = await fetch(
        `/api/entries/${encodeURIComponent(entry.kind)}/${encodeURIComponent(entry.slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch)
        }
      );
      const body = (await response.json()) as EntryView & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The edit was refused');
      this.#replace(entry.id, body);
      this.message = {
        text: options.describe ?? `${entry.name}: ${keys.join(', ')} saved`,
        tone: 'info',
        undo:
          options.undoable === false
            ? undefined
            : () => {
                const current = this.byId(entry.id);
                if (current) void this.patch(current, reverse, { undoable: false });
              }
      };
      return true;
    } catch (error) {
      this.#replace(entry.id, restore);
      this.message = {
        text: error instanceof Error ? error.message : 'The edit was refused',
        tone: 'error'
      };
      return false;
    } finally {
      this.#markPending(entry.id, keys, false);
    }
  }

  /** A convenience over {@link patch} for the single-value edits the table and panel make. */
  setField(entry: EntryView, key: string, value: AttributeValue): Promise<boolean> {
    const definition = this.registry.get(key);
    return this.patch(
      entry,
      { [key]: value },
      { describe: `${entry.name}: ${definition?.label ?? key} saved` }
    );
  }

  /** Re-reads the whole catalog; used after a mutation the read model derives from (a relation). */
  async refresh(): Promise<void> {
    const response = await fetch('/api/entries');
    if (!response.ok) return;
    const body = (await response.json()) as { entries: EntryView[]; generatedAt: string };
    this.entries = body.entries;
    this.generatedAt = body.generatedAt;
  }

  async saveView(input: {
    name: string;
    kind: string | null;
    query: string;
    columns: string[];
  }): Promise<boolean> {
    try {
      const response = await fetch('/api/views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      });
      const body = (await response.json()) as SavedView & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to save view');
      this.views = [...this.views.filter((view) => view.name !== body.name), body].sort(
        (left, right) => left.position - right.position || left.name.localeCompare(right.name, 'en')
      );
      this.message = { text: `Saved view “${body.name}”`, tone: 'info' };
      return true;
    } catch (error) {
      this.message = {
        text: error instanceof Error ? error.message : 'Unable to save view',
        tone: 'error'
      };
      return false;
    }
  }

  /** Opens a project in Finder or Terminal; `ongoing open <project> --terminal` is the same call. */
  async open(entry: EntryView, action: 'finder' | 'terminal'): Promise<void> {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(entry.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Unable to open ${action}`);
      }
      this.message = { text: `${entry.name} opened in ${action}`, tone: 'info' };
    } catch (error) {
      this.message = {
        text: error instanceof Error ? error.message : `Unable to open ${action}`,
        tone: 'error'
      };
    }
  }
}

/** The GitHub page for an entry, when a hosting provider found one. */
export function githubUrl(entry: EntryView): string | null {
  const owner = entry.fields['github.owner'];
  const name = entry.fields['github.name'];
  return typeof owner === 'string' && typeof name === 'string'
    ? `https://github.com/${owner}/${name}`
    : null;
}
