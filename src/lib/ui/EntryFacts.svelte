<script lang="ts">
  import { attentionViewKeys } from '$lib/domain/attention';
  import { describeMissing, entryCompleteness } from '$lib/domain/completeness';
  import type { EntryView } from '$lib/domain/entry-view';
  import type { FieldDefinition } from '$lib/domain/fields';
  import Badge from './Badge.svelte';
  import type { Catalog } from './catalog.svelte';
  import { decisionFields, hasValue, providerPanels } from './facts';
  import FieldEditor from './FieldEditor.svelte';
  import { formatValue, relativeAge } from './format';
  import Icon from './Icon.svelte';
  import Sparkline from './Sparkline.svelte';
  import { attentionTone, providerLabel, VIEW_LABELS } from './views';

  /**
   * The fact sheet, used whole by the entry pages and by the inventory's detail panel. Every field
   * is editable in place, provider panels appear only where the provider left data, and the
   * attention reasons keep the drawer's "reason, input, comparison, threshold" display — the
   * strongest thing in the old UI (ADR 0008).
   */
  let {
    entry,
    catalog,
    showEmpty = $bindable(false)
  }: { entry: EntryView; catalog: Catalog; showEmpty?: boolean } = $props();

  let editing = $state<string | null>(null);
  let now = Date.now();

  let decisions = $derived(decisionFields(catalog.registry, entry.kind));
  let visibleDecisions = $derived(
    showEmpty ? decisions : decisions.filter((field) => hasValue(entry, field.key))
  );
  let panels = $derived(providerPanels(catalog.registry, entry, showEmpty));
  let emptyCount = $derived(
    decisions.length -
      decisions.filter((field) => hasValue(entry, field.key)).length +
      providerPanels(catalog.registry, entry, true).reduce(
        (total, panel) =>
          total + panel.fields.filter((field) => !hasValue(entry, field.key)).length,
        0
      )
  );

  let completeness = $derived(entryCompleteness(catalog.registry, entry.kind, entry.fields));

  /** A remote-only entry: discovered by a provider that is not the filesystem, so it has no path. */
  let remoteSource = $derived(
    entry.path ? null : (entry.sources.find((source) => source.provider !== 'filesystem') ?? null)
  );

  let activeViews = $derived(
    entry.attention ? attentionViewKeys.filter((key) => entry.attention![key].member) : []
  );

  function save(field: FieldDefinition, value: Parameters<Catalog['setField']>[2]) {
    editing = null;
    void catalog.setField(entry, field.key, value);
  }
</script>

<div class="facts">
  <section class="block">
    <h3>Identity</h3>
    <dl class="kv">
      <dt>kind</dt>
      <dd>{entry.kind}</dd>
      <dt>slug</dt>
      <dd class="u-mono">{entry.slug}</dd>
      {#if entry.path}
        <dt>path</dt>
        <dd class="u-mono" title={entry.path}>{entry.path}</dd>
      {:else if remoteSource}
        <!-- No local checkout: name the provider that found it rather than leaving a blank row,
             so "there is no path" reads as a fact instead of as missing data. -->
        <dt>source</dt>
        <dd class="u-mono" title={`${remoteSource.provider}:${remoteSource.locator}`}>
          {remoteSource.provider} · {remoteSource.locator}
        </dd>
      {/if}
      <dt>updated</dt>
      <dd>{relativeAge(entry.updatedAt, now)} ago</dd>
      <dt title="Share of this kind’s required fields that carry a value">complete</dt>
      <dd data-complete={completeness.complete}>
        {completeness.complete}%
        {#if completeness.missing.length}
          <span class="u-dim"
            >· missing {describeMissing(catalog.registry, completeness.missing)}</span
          >
        {/if}
      </dd>
    </dl>
    {#if entry.isMissing || entry.isHidden || entry.isFavorite}
      <div class="badges">
        {#if entry.isFavorite}<Badge tone="accent" dot>favorite</Badge>{/if}
        {#if entry.isHidden}<Badge tone="neutral" dot>hidden</Badge>{/if}
        {#if entry.isMissing}<Badge tone="error" dot>missing from disk</Badge>{/if}
      </div>
    {/if}
  </section>

  <section class="block">
    <h3>Decisions</h3>
    <dl class="kv">
      {#each visibleDecisions as field (field.key)}
        <dt title={field.description ?? field.key}>{field.label}</dt>
        <dd>
          {#if editing === field.key}
            <FieldEditor
              definition={field}
              value={entry.fields[field.key]}
              ariaLabel={`${field.label} for ${entry.name}`}
              onsave={(value) => save(field, value)}
              oncancel={() => (editing = null)}
            />
          {:else}
            <button
              type="button"
              class="edit"
              aria-label={`Edit ${field.label} for ${entry.name}`}
              onclick={() => (editing = field.key)}
            >
              {formatValue(field, entry.fields[field.key], now)}
            </button>
          {/if}
        </dd>
      {/each}
    </dl>
    {#if emptyCount > 0 || showEmpty}
      <button class="button button-ghost" type="button" onclick={() => (showEmpty = !showEmpty)}>
        <Icon name={showEmpty ? 'eye-off' : 'eye'} size={12} />
        {showEmpty ? 'hide empty fields' : `${emptyCount} empty fields`}
      </button>
    {/if}
  </section>

  {#if activeViews.length}
    <section class="block">
      <h3>Why it appears</h3>
      {#each activeViews as key (key)}
        <div class="reason-group">
          <h4><Badge tone={attentionTone(key)} dot>{VIEW_LABELS[key] ?? key}</Badge></h4>
          <ul class="reasons">
            {#each entry.attention![key].reasons as item (item.input)}
              <li>
                <span>{item.message}</span>
                <code class="u-mono"
                  >{item.input}: {String(item.value)}
                  {item.comparison}
                  {String(item.threshold)}</code
                >
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </section>
  {/if}

  {#if entry.technologies.length || entry.relations.incoming.length}
    <section class="block">
      <h3>Relations</h3>
      <ul class="relations">
        {#each entry.technologies as used (used.slug)}
          <li>
            <a href={`/t/${used.slug}`}>
              <Icon name="package" size={12} /><span>uses {used.name}</span>
            </a>
            {#if used.version}<span class="u-mono u-dim">{used.version}</span>{/if}
            <Badge tone={used.ring === 'out' ? 'error' : used.ring === 'hot' ? 'ok' : 'neutral'}
              >{used.ring ?? 'unrated'}</Badge
            >
          </li>
        {/each}
        {#each entry.relations.incoming as relation (relation.id)}
          {#if relation.other}
            <li>
              <a href={`/${relation.other.kind === 'project' ? 'p' : 't'}/${relation.other.slug}`}>
                <Icon name="git-branch" size={12} />
                <span>{relation.other.name} {relation.kind} this</span>
              </a>
              <span class="u-dim">{relation.evidence}</span>
            </li>
          {/if}
        {/each}
      </ul>
    </section>
  {/if}

  {#if entry.metrics}
    <section class="block">
      <h3>Trend · commits 7 / 30 / 90d</h3>
      <Sparkline
        values={[entry.metrics.commits7d, entry.metrics.commits30d, entry.metrics.commits90d]}
        labels={['7d', '30d', '90d']}
        label={`Commit trend for ${entry.name}`}
      />
    </section>
  {/if}

  {#each panels as panel (panel.provider)}
    <section class="block">
      <h3>{providerLabel(panel.provider)}</h3>
      <dl class="kv">
        {#each panel.fields as field (field.key)}
          <dt title={field.description ?? field.key}>{field.label}</dt>
          <dd>{formatValue(field, entry.fields[field.key], now)}</dd>
        {/each}
      </dl>
    </section>
  {/each}

  {#if entry.errors.length}
    <section class="block">
      <h3>Collector warnings</h3>
      <ul class="reasons">
        {#each entry.errors as error (error.collector + error.occurredAt)}
          <li>
            <span><strong>{error.collector}</strong> · {error.message}</span>
            <code class="u-mono">{relativeAge(error.occurredAt, now)} ago</code>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .facts {
    display: flex;
    flex-direction: column;
  }

  .block {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .kv {
    display: grid;
    /* A cap rather than a percentage: the same rows read well in the 400px panel and on a
       full fact sheet, instead of stretching a label column across half the page. */
    grid-template-columns: minmax(88px, 200px) 1fr;
    gap: 2px var(--space-2);
    margin: 0;
    font-size: var(--text-xs);
  }

  dt {
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .edit {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit:hover {
    color: var(--accent);
  }

  .badges,
  .reason-group {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .reason-group {
    flex-direction: column;
  }

  .reasons,
  .relations {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
  }

  .reasons li {
    display: flex;
    flex-direction: column;
    color: var(--text-secondary);
  }

  .reasons code {
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .relations li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .relations a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
  }

  .relations a:hover {
    color: var(--accent);
  }

  .relations span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
