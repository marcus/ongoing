<script lang="ts">
  import type { AttributeValue } from '$lib/domain/entry';
  import type { EntryView } from '$lib/domain/entry-view';
  import type { FieldDefinition } from '$lib/domain/fields';
  import type { SortKey } from '$lib/domain/query';
  import FieldEditor from './FieldEditor.svelte';
  import Icon from './Icon.svelte';
  import { formatValue, isTimestampField } from './format';
  import RichFieldPreview from './RichFieldPreview.svelte';

  /**
   * The inventory table. Columns are field definitions, so every cell knows its type and every
   * editable cell gets the editor for that type — there is no per-field component and no list of
   * known columns anywhere in the view layer (ADR 0008).
   */
  let {
    columns,
    rows,
    sort = [],
    activeIndex = 0,
    editing = null,
    pending = {},
    onactivate,
    onopen,
    onedit,
    onsave,
    oncancel,
    onsort,
    caption = 'Inventory',
    identityField = null
  }: {
    columns: FieldDefinition[];
    rows: EntryView[];
    sort?: SortKey[];
    activeIndex?: number;
    editing?: { id: string; key: string } | null;
    /** Rows with an optimistic edit in flight, so the cell can say so without a spinner. */
    pending?: Record<string, string[]>;
    onactivate?: (index: number) => void;
    onopen?: (row: EntryView) => void;
    onedit?: (row: EntryView, key: string) => void;
    onsave?: (row: EntryView, key: string, value: AttributeValue) => void;
    oncancel?: () => void;
    onsort?: (key: string) => void;
    caption?: string;
    identityField?: FieldDefinition | null;
  } = $props();

  let now = Date.now();

  function direction(key: string): 'asc' | 'desc' | null {
    return sort.find((entry) => entry.field === key)?.direction ?? null;
  }

  function isNumeric(definition: FieldDefinition): boolean {
    return (
      (definition.type === 'number' || definition.type === 'integer') &&
      !isTimestampField(definition)
    );
  }
</script>

<div class="table-scroll">
  <table class="table">
    <caption class="sr-only">{caption}</caption>
    <thead>
      <tr>
        {#each columns as column (column.key)}
          <th scope="col" data-numeric={isNumeric(column)} title={column.description ?? column.key}>
            <button
              type="button"
              class="head"
              disabled={!column.sortable}
              aria-label={`Sort by ${column.label}`}
              onclick={() => onsort?.(column.key)}
            >
              <span>{column.label}</span>
              {#if direction(column.key)}
                <Icon
                  name={direction(column.key) === 'asc' ? 'chevron-up' : 'chevron-down'}
                  size={12}
                />
              {/if}
            </button>
          </th>
        {/each}
        <!-- A spacer that absorbs the slack, so every real column is the width of its content
             rather than a share of the viewport. -->
        <th class="spacer" scope="col"><span class="sr-only">Spacer</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index (row.id)}
        <tr
          data-entry-row={row.slug}
          data-active={index === activeIndex}
          onmousedown={() => onactivate?.(index)}
        >
          {#each columns as column (column.key)}
            {@const busy = pending[row.id]?.includes(column.key)}
            <td data-numeric={isNumeric(column)} data-pending={busy}>
              {#if editing && editing.id === row.id && editing.key === column.key}
                <FieldEditor
                  definition={column}
                  value={row.fields[column.key]}
                  ariaLabel={`${column.label} for ${row.name}`}
                  onsave={(value) => onsave?.(row, column.key, value)}
                  oncancel={() => oncancel?.()}
                />
              {:else if column.key === 'name'}
                <button
                  type="button"
                  class="cell cell-name"
                  onclick={() => onopen?.(row)}
                  title={String(row.fields.path ?? row.name)}
                >
                  {#if row.fields.is_favorite}<Icon name="star" size={11} />{/if}
                  {#if identityField}<RichFieldPreview
                      entry={row}
                      field={identityField}
                      compact
                    />{/if}
                  <span>{row.name}</span>
                </button>
              {:else if column.editable && column.storage !== 'projected'}
                <button
                  type="button"
                  class="cell cell-editable"
                  aria-label={`Edit ${column.label} for ${row.name}`}
                  onclick={() => onedit?.(row, column.key)}
                >
                  {formatValue(column, row.fields[column.key], now)}
                </button>
              {:else}
                <span class="cell">{formatValue(column, row.fields[column.key], now)}</span>
              {/if}
            </td>
          {/each}
          <td class="spacer"></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-scroll {
    overflow: auto;
    height: 100%;
  }

  .table {
    width: 100%;
    table-layout: auto;
    border-collapse: collapse;
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0;
    background: var(--bg-inset);
    border-bottom: 1px solid var(--border-strong);
    text-align: left;
    font-weight: var(--weight-medium);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: var(--header-height);
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
  }

  .head:disabled {
    cursor: default;
  }

  .head:not(:disabled):hover {
    color: var(--text-primary);
  }

  th[data-numeric='true'] .head {
    justify-content: flex-end;
  }

  tbody tr {
    border-bottom: 1px solid var(--border-subtle);
  }

  tbody tr:hover {
    background: var(--bg-hover);
  }

  tbody tr[data-active='true'] {
    background: var(--bg-selected);
  }

  .spacer {
    width: 100%;
    padding: 0;
  }

  td {
    padding: 0;
    height: var(--row-height);
    max-width: 380px;
    vertical-align: middle;
  }

  td[data-numeric='true'] {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  td[data-pending='true'] .cell {
    opacity: 0.55;
  }

  .cell {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    text-align: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td[data-numeric='true'] .cell {
    justify-content: flex-end;
  }

  .cell-name {
    color: var(--text-primary);
    font-weight: var(--weight-medium);
    cursor: pointer;
  }

  .cell-editable {
    cursor: text;
  }

  /* An outline rather than a shadow: hovering a cell is an affordance, not an elevation. */
  .cell-editable:hover {
    color: var(--text-primary);
    outline: 1px solid var(--border-default);
    outline-offset: -1px;
  }
</style>
