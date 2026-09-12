<script lang="ts">
  /** A status pill. Tone is the only place colour is allowed to mean something. */
  import type { BadgeTone } from './tones';

  let {
    tone = 'neutral',
    dot = false,
    title,
    children
  }: {
    tone?: BadgeTone;
    dot?: boolean;
    title?: string;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<span class="badge" data-tone={tone} {title}>
  {#if dot}<span class="dot"></span>{/if}
  {@render children?.()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background: var(--tint);
    color: var(--tone);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    line-height: 1.6;
    white-space: nowrap;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: currentcolor;
  }

  .badge[data-tone='neutral'] {
    --tone: var(--text-secondary);
    --tint: var(--status-muted-tint);
  }
  .badge[data-tone='ok'] {
    --tone: var(--status-ok);
    --tint: var(--status-ok-tint);
  }
  .badge[data-tone='warn'] {
    --tone: var(--status-warn);
    --tint: var(--status-warn-tint);
  }
  .badge[data-tone='error'] {
    --tone: var(--status-error);
    --tint: var(--status-error-tint);
  }
  .badge[data-tone='info'] {
    --tone: var(--status-info);
    --tint: var(--status-info-tint);
  }
  .badge[data-tone='accent'] {
    --tone: var(--accent);
    --tint: var(--accent-tint);
  }
</style>
