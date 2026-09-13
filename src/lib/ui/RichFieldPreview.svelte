<script lang="ts">
  import type { EntryView } from '$lib/domain/entry-view';
  import type { FieldDefinition } from '$lib/domain/fields';
  import { artifactHash } from './rich-fields';
  import { richFieldUiAdapter } from './rich-field-adapters';

  let {
    entry,
    field,
    compact = false,
    interactive = false
  }: {
    entry: EntryView;
    field: FieldDefinition;
    compact?: boolean;
    interactive?: boolean;
  } = $props();
  let poster = $derived(artifactHash(entry, field, 'poster'));
  let manifest = $derived(artifactHash(entry, field, 'manifest'));
  let adapter = $derived(richFieldUiAdapter(field));
  let host = $state<HTMLDivElement>();
  let ready = $state(false);
  let activeViewer = $state<{ dispose(): void; reset(): void }>();

  $effect(() => {
    let viewer: { dispose(): void; reset(): void } | undefined;
    let disposed = false;
    ready = false;
    if (
      interactive &&
      adapter?.mount &&
      manifest &&
      host &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      void (async () => {
        try {
          const response = await fetch(`/api/artifacts/${manifest}`);
          if (!response.ok) throw new Error('Logo document is unavailable');
          const document = await response.json();
          if (disposed) return;
          const mounted = await adapter.mount!(
            host,
            document,
            () => (ready = true),
            () => (ready = false)
          );
          if (disposed) mounted.dispose();
          else {
            viewer = mounted;
            activeViewer = mounted;
          }
        } catch {
          ready = false;
        }
      })();
    }
    return () => {
      disposed = true;
      viewer?.dispose();
      if (activeViewer === viewer) activeViewer = undefined;
    };
  });
</script>

{#if adapter && poster}
  <div class="preview" class:compact class:interactive>
    <img class:hidden={ready} src={`/api/artifacts/${poster}`} alt="" loading="lazy" />
    {#if interactive}<div class="viewer" class:ready bind:this={host}></div>{/if}
    {#if interactive && ready}
      <button class="button button-ghost reset" type="button" onclick={() => activeViewer?.reset()}
        >Reset view</button
      >
    {/if}
  </div>
{:else if !compact}
  <pre>{JSON.stringify(entry.fields[field.key], null, 2)}</pre>
{/if}

<style>
  .preview {
    position: relative;
    width: 100%;
    height: var(--rich-preview-height);
    background: var(--bg-inset);
  }
  .preview.compact {
    width: var(--space-5);
    height: var(--space-5);
    background: transparent;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  img.hidden {
    visibility: hidden;
  }
  .viewer {
    position: absolute;
    inset: 0;
    visibility: hidden;
  }
  .viewer.ready {
    visibility: visible;
  }
  .reset {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
  }
  pre {
    margin: 0;
    overflow: auto;
    color: var(--text-secondary);
    font: var(--text-xs)/var(--leading-normal) var(--font-mono);
  }
</style>
