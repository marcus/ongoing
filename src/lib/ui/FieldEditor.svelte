<script lang="ts">
  import type { AttributeValue } from '$lib/domain/entry';
  import {
    coerceFieldValue,
    FieldValidationError,
    parseFieldInput,
    type FieldDefinition
  } from '$lib/domain/fields';
  import { editableValue } from './format';

  /**
   * One editor per registered field type — text, number, integer, boolean, date, url, enum,
   * multi_enum, json. The registry decides which appears, so a field added by `ongoing field add`
   * is editable in the browser with no frontend change (ADR 0008).
   *
   * Values are coerced by the same pure functions the API and the CLI run, so a value this editor
   * accepts is a value the server accepts, and the error text is identical on all three surfaces.
   */
  let {
    definition,
    value,
    onsave,
    oncancel,
    autofocus = true,
    ariaLabel
  }: {
    definition: FieldDefinition;
    value: AttributeValue | undefined;
    onsave: (next: AttributeValue) => void;
    oncancel?: () => void;
    autofocus?: boolean;
    ariaLabel?: string;
  } = $props();

  // An editor deliberately starts from the value at the moment it opened; later changes to the
  // row must not overwrite what someone is typing.
  // svelte-ignore state_referenced_locally
  let draft = $state(editableValue(definition, value));
  let error = $state<string | null>(null);
  let label = $derived(ariaLabel ?? definition.label);

  function commit(raw: string) {
    try {
      onsave(parseFieldInput(definition, raw));
      error = null;
    } catch (failure) {
      error = failure instanceof FieldValidationError ? failure.message : String(failure);
    }
  }

  function commitBoolean(next: boolean) {
    try {
      onsave(coerceFieldValue(definition, next));
      error = null;
    } catch (failure) {
      error = failure instanceof FieldValidationError ? failure.message : String(failure);
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      oncancel?.();
      return;
    }
    if (event.key === 'Enter' && (!longText || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      commit(draft);
    }
  }

  /* `autofocus` is the point of an inline editor: the cell is already the user's focus. */
  function focusOnMount(node: HTMLElement) {
    if (!autofocus) return;
    node.focus();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) node.select();
  }

  let longText = $derived(definition.type === 'json' || (definition.options?.maxLength ?? 0) > 200);
</script>

<div class="editor" data-type={definition.type}>
  {#if definition.type === 'boolean'}
    <select
      class="input"
      aria-label={label}
      value={value === null || value === undefined ? '' : value ? 'true' : 'false'}
      use:focusOnMount
      {onkeydown}
      onchange={(event) => {
        const next = event.currentTarget.value;
        if (next === '') onsave(null);
        else commitBoolean(next === 'true');
      }}
    >
      <option value="">not set</option>
      <option value="true">yes</option>
      <option value="false">no</option>
    </select>
  {:else if definition.type === 'enum'}
    <select
      class="input"
      aria-label={label}
      value={draft}
      use:focusOnMount
      {onkeydown}
      onchange={(event) => commit(event.currentTarget.value)}
    >
      <option value="">not set</option>
      {#each definition.options?.values ?? [] as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  {:else if definition.type === 'multi_enum' && definition.options?.values?.length}
    <div class="checks" role="group" aria-label={label}>
      {#each definition.options.values as option (option)}
        {@const selected = Array.isArray(value) ? value.includes(option) : false}
        <label class="check">
          <input
            type="checkbox"
            checked={selected}
            onchange={(event) => {
              const current = Array.isArray(value) ? [...(value as string[])] : [];
              const next = event.currentTarget.checked
                ? [...current, option]
                : current.filter((item) => item !== option);
              commit(next.join(','));
            }}
          />
          {option}
        </label>
      {/each}
      <button class="button button-ghost" type="button" onclick={() => oncancel?.()}>done</button>
    </div>
  {:else if longText}
    <textarea
      class="input"
      rows={definition.type === 'json' ? 6 : 3}
      aria-label={label}
      bind:value={draft}
      use:focusOnMount
      {onkeydown}
      onblur={() => commit(draft)}></textarea>
    <p class="hint">⌘↵ to save, esc to cancel</p>
  {:else}
    <input
      class="input"
      type={definition.type === 'date'
        ? 'date'
        : definition.type === 'number' || definition.type === 'integer'
          ? 'number'
          : definition.type === 'url'
            ? 'url'
            : 'text'}
      min={definition.options?.min}
      max={definition.options?.max}
      step={definition.type === 'integer' ? 1 : undefined}
      maxlength={definition.options?.maxLength}
      aria-label={label}
      bind:value={draft}
      use:focusOnMount
      {onkeydown}
      onblur={() => commit(draft)}
    />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .hint {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .error {
    margin: 0;
    color: var(--status-error);
    font-size: var(--text-2xs);
  }
</style>
