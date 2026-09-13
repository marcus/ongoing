<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * The right-hand detail panel. It sits inside the grid rather than floating over it, so the list
   * keeps its keyboard focus and `Enter` never takes you off the row you were reading.
   */
  let {
    title,
    subtitle,
    onclose,
    children,
    actions
  }: {
    title: string;
    subtitle?: string;
    onclose?: () => void;
    children: import('svelte').Snippet;
    actions?: import('svelte').Snippet;
  } = $props();
</script>

<aside class="panel" aria-label={`${title} details`}>
  <header>
    <div class="identity">
      <h2>{title}</h2>
      {#if subtitle}<p class="u-dim">{subtitle}</p>{/if}
    </div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
    {#if onclose}
      <button
        class="button button-ghost"
        type="button"
        aria-label="Close details"
        onclick={onclose}
      >
        <Icon name="x" size={13} />
      </button>
    {/if}
  </header>
  <div class="body">
    {@render children()}
  </div>
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    width: var(--panel-width);
    min-width: 0;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-strong);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .identity {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    margin: 0;
    font-size: var(--text-2xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
  }

  .body {
    flex: 1;
    overflow-y: auto;
  }

  @media (max-width: 640px) {
    .panel {
      width: 100%;
    }
  }
</style>
