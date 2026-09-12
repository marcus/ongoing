<script lang="ts">
  import Icon from './Icon.svelte';
  import { rankPalette, type PaletteItem } from './palette';

  /**
   * `Cmd+K`. One list of everything: jump to an entry, run a command against the entry the list is
   * on, switch view, navigate. Every command here has a CLI verb behind the same endpoint, which
   * is the parity rule this phase owes (AGENTS.md).
   */
  let {
    items,
    placeholder = 'Jump to an entry, or run a command…',
    onclose
  }: { items: PaletteItem[]; placeholder?: string; onclose: () => void } = $props();

  let query = $state('');
  let index = $state(0);
  let ranked = $derived(rankPalette(items, query).slice(0, 60));

  $effect(() => {
    if (index >= ranked.length) index = Math.max(0, ranked.length - 1);
  });

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onclose();
    item.run();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      index = Math.min(index + 1, ranked.length - 1);
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      index = Math.max(index - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(ranked[index]);
    }
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
  <div class="field">
    <Icon name="search" size={14} />
    <input
      type="text"
      aria-label="Command palette"
      autocomplete="off"
      spellcheck="false"
      {placeholder}
      bind:value={query}
      use:focusOnMount
      {onkeydown}
    />
    <kbd class="kbd">esc</kbd>
  </div>
  <ul class="results" role="listbox" aria-label="Palette results">
    {#each ranked as item, position (item.id)}
      {@const heading = position === 0 || ranked[position - 1].group !== item.group}
      {#if heading}<li class="group" role="presentation">{item.group}</li>{/if}
      <li>
        <button
          type="button"
          role="option"
          aria-selected={position === index}
          data-active={position === index}
          onmousemove={() => (index = position)}
          onclick={() => choose(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={13} />{/if}
          <span class="label">{item.label}</span>
          {#if item.hint}<span class="hint">{item.hint}</span>{/if}
        </button>
      </li>
    {:else}
      <li class="empty">Nothing matches “{query}”.</li>
    {/each}
  </ul>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: lch(0% 0 0 / 0.45);
  }

  .palette {
    position: fixed;
    top: 12vh;
    left: 50%;
    z-index: 41;
    width: min(560px, calc(100vw - var(--space-8)));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-tertiary);
  }

  .field input {
    flex: 1;
    border: 0;
    background: none;
    color: var(--text-primary);
    font-size: var(--text-md);
    outline: none;
  }

  .results {
    margin: 0;
    padding: var(--space-1) 0;
    max-height: 52vh;
    overflow-y: auto;
    list-style: none;
  }

  .group {
    padding: var(--space-2) var(--space-3) var(--space-1);
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .results button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .results button[data-active='true'] {
    background: var(--bg-selected);
    color: var(--text-primary);
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  .empty {
    padding: var(--space-4) var(--space-3);
    color: var(--text-tertiary);
    text-align: center;
  }
</style>
