<script lang="ts">
  import type { EntryView } from '$lib/domain/entry-view';
  import { technologyRings, TECHNOLOGY_KIND } from '$lib/domain/technology';
  import Badge from '$lib/ui/Badge.svelte';
  import { getCatalogContext } from '$lib/ui/context';
  import FieldEditor from '$lib/ui/FieldEditor.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { RING_LABELS, ringTone } from '$lib/ui/views';

  /**
   * The radar: four rings as rows, technologies as chips carrying how many projects use them.
   * A chip links through to the inventory filtered to that technology, and the ring is editable on
   * the chip itself — the same `PATCH /api/entries/technology/<slug>` `ongoing tech set` calls.
   */
  const catalog = getCatalogContext();

  let editing = $state<string | null>(null);
  let ringField = $derived(catalog.registry.get('ring'));

  let technologies = $derived(catalog.entries.filter((entry) => entry.kind === TECHNOLOGY_KIND));

  function inRing(ring: string): EntryView[] {
    return technologies
      .filter((entry) => (entry.fields.ring ?? null) === ring)
      .sort(
        (left, right) =>
          Number(right.fields.used_by ?? 0) - Number(left.fields.used_by ?? 0) ||
          left.name.localeCompare(right.name, 'en')
      );
  }

  let unrated = $derived(
    technologies.filter((entry) => !technologyRings.includes(entry.fields.ring as never))
  );
</script>

<svelte:head><title>radar — ongoing</title></svelte:head>

<header class="bar">
  <h1><Icon name="orbit" size={14} /> Radar</h1>
  <p class="note">
    {technologies.length} technologies. A stale ring — one past its
    <code class="u-mono">review_after</code>
    — puts its users into <a href="/?saved=attention">needs attention</a>.
  </p>
</header>

<div class="scroll">
  {#each technologyRings as ring (ring)}
    {@const members = inRing(ring)}
    <section class="ring" data-ring={ring}>
      <div class="ring-head">
        <h2>{ring}</h2>
        <span class="u-dim">{RING_LABELS[ring]}</span>
        <span class="u-mono count">{members.length}</span>
      </div>
      {#if members.length}
        <ul class="chips">
          {#each members as technology (technology.id)}
            <li class="chip" data-stale={technology.fields.ring_stale === true}>
              <a href={`/?q=${encodeURIComponent(`tech:${technology.slug}`)}`} class="chip-name">
                {technology.name}
                <span class="u-mono uses">{Number(technology.fields.used_by ?? 0)}</span>
              </a>
              {#if editing === technology.id && ringField}
                <FieldEditor
                  definition={ringField}
                  value={technology.fields.ring}
                  ariaLabel={`Ring for ${technology.name}`}
                  onsave={(value) => {
                    editing = null;
                    void catalog.setField(technology, 'ring', value);
                  }}
                  oncancel={() => (editing = null)}
                />
              {:else}
                <button
                  class="ring-button"
                  type="button"
                  aria-label={`Edit ring for ${technology.name}`}
                  onclick={() => (editing = technology.id)}
                >
                  <Badge tone={ringTone(ring)} dot>{ring}</Badge>
                </button>
              {/if}
              {#if technology.fields.ring_stale === true}
                <Badge tone="warn" title="review_after has passed">stale</Badge>
              {/if}
              <a
                class="sheet"
                href={`/t/${technology.slug}`}
                aria-label={`${technology.name} facts`}
              >
                <Icon name="chevron-right" size={12} />
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">Nothing in this ring.</p>
      {/if}
    </section>
  {/each}

  {#if unrated.length}
    <section class="ring">
      <div class="ring-head">
        <h2>unrated</h2>
        <span class="u-dim">no ring set — `ongoing tech set &lt;slug&gt; --ring &lt;ring&gt;`</span>
        <span class="u-mono count">{unrated.length}</span>
      </div>
      <ul class="chips">
        {#each unrated as technology (technology.id)}
          <li class="chip">
            <a href={`/t/${technology.slug}`} class="chip-name">{technology.name}</a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    min-height: var(--header-height);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-strong);
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
  }

  .note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .note a {
    color: var(--accent);
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
  }

  .ring {
    border-bottom: 1px solid var(--border-subtle);
  }

  .ring-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-inset);
    border-bottom: 1px solid var(--border-subtle);
  }

  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ring-head span {
    font-size: var(--text-2xs);
  }

  .count {
    margin-left: auto;
    color: var(--text-tertiary);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    list-style: none;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
  }

  .chip[data-stale='true'] {
    border-color: var(--status-warn);
  }

  .chip-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
  }

  .chip-name:hover {
    color: var(--accent);
  }

  .uses {
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .ring-button {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  .sheet {
    color: var(--text-tertiary);
  }

  .sheet:hover {
    color: var(--text-primary);
  }

  .empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }
</style>
