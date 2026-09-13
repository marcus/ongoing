<script lang="ts">
  import Badge from './Badge.svelte';
  import { githubUrl } from './catalog.svelte';
  import { getCatalogContext } from './context';
  import EntryFacts from './EntryFacts.svelte';
  import FieldEditor from './FieldEditor.svelte';
  import Icon from './Icon.svelte';
  import { attentionTone, ringTone, VIEW_LABELS } from './views';

  /**
   * The fact sheet. Identity at the top, then everything `EntryFacts` renders: decisions, why the
   * entry appears in an attention view with the thresholds behind it, relations, the trend, and
   * one panel per provider that left data. Every field is editable in place.
   */
  let { kind, slug }: { kind: string; slug: string } = $props();

  const catalog = getCatalogContext();

  let entry = $derived(catalog.bySlug(kind, slug) ?? null);
  let showEmpty = $state(false);

  // The palette runs its commands against whatever is focused; on a fact sheet that is this entry.
  $effect(() => {
    catalog.focused = entry;
  });
  let editingName = $state(false);
  let nameField = $derived(catalog.registry.get('name')!);
</script>

<svelte:head><title>{entry ? entry.name : slug} — ongoing</title></svelte:head>

{#if !entry}
  <p class="missing" role="alert">
    No <code class="u-mono">{kind}</code> with the slug <code class="u-mono">{slug}</code> is in the
    catalog. <a href="/">Back to the inventory</a>.
  </p>
{:else}
  <header class="head">
    <div class="identity">
      {#if editingName}
        <FieldEditor
          definition={nameField}
          value={entry.name}
          ariaLabel={`Name for ${entry.name}`}
          onsave={(value) => {
            editingName = false;
            void catalog.setField(entry!, 'name', value);
          }}
          oncancel={() => (editingName = false)}
        />
      {:else}
        <h1>
          <button
            type="button"
            aria-label={`Edit name for ${entry.name}`}
            onclick={() => (editingName = true)}
          >
            {entry.name}
          </button>
        </h1>
      {/if}
      <p class="handle u-mono">{entry.kind}/{entry.slug}</p>
    </div>

    <div class="badges">
      {#if entry.fields.ring}
        <Badge tone={ringTone(String(entry.fields.ring))} dot>{entry.fields.ring}</Badge>
      {/if}
      {#each entry.views as view (view)}
        <Badge tone={attentionTone(view)} dot>{VIEW_LABELS[view] ?? view}</Badge>
      {/each}
      {#each entry.tags as tag (tag)}
        <Badge tone="neutral">#{tag}</Badge>
      {/each}
    </div>

    <div class="actions">
      <a class="button" href="/">
        <Icon name="list" size={12} /> inventory
      </a>
      {#if entry.kind === 'project' && entry.path}
        <button class="button" type="button" onclick={() => void catalog.open(entry!, 'terminal')}>
          <Icon name="terminal" size={12} /> terminal
        </button>
      {/if}
      {#if githubUrl(entry)}
        <a class="button" href={githubUrl(entry)} target="_blank" rel="noreferrer">
          <Icon name="github" size={12} /> github
        </a>
      {/if}
      <button
        class="button"
        type="button"
        aria-pressed={entry.isFavorite}
        onclick={() => void catalog.setField(entry!, 'is_favorite', !entry!.isFavorite)}
      >
        <Icon name="star" size={12} /> favorite
      </button>
    </div>
  </header>

  <div class="sheet">
    <EntryFacts {entry} {catalog} bind:showEmpty />
  </div>
{/if}

<style>
  .missing {
    padding: var(--space-8);
    color: var(--text-tertiary);
    text-align: center;
  }

  .missing a {
    color: var(--accent);
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-strong);
  }

  .identity {
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: -0.01em;
  }

  h1 button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: text;
  }

  h1 button:hover {
    color: var(--accent);
  }

  .handle {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    flex: 1;
    padding-top: var(--space-1);
  }

  .actions {
    display: flex;
    gap: var(--space-1);
  }

  .sheet {
    flex: 1;
    overflow-y: auto;
    max-width: 760px;
  }

  @media (max-width: 640px) {
    .head {
      flex-direction: column;
    }

    .identity,
    .badges,
    .actions {
      width: 100%;
    }

    .badges,
    .actions {
      flex: none;
    }

    .actions {
      flex-wrap: wrap;
    }
  }
</style>
