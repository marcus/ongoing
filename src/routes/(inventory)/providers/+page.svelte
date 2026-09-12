<script lang="ts">
  import Badge from '$lib/ui/Badge.svelte';
  import { relativeAge } from '$lib/ui/format';
  import Icon from '$lib/ui/Icon.svelte';
  import {
    loadProviders,
    requirementList,
    stateTone,
    type ProviderStatus,
    type ProvidersResponse
  } from '$lib/ui/providers';

  /**
   * Providers: what contributes to the catalog, whether it can run here, when it last did, and why
   * not when it cannot. Every value on this screen comes from `GET /api/providers`, the same
   * payload `ongoing providers` prints — see `$lib/ui/providers.ts`.
   */
  let page = $state<ProvidersResponse>({
    providers: [],
    host: null,
    configPath: null,
    error: null
  });
  let loaded = $state(false);
  const now = Date.now();

  $effect(() => {
    void loadProviders().then((result) => {
      page = result;
      loaded = true;
    });
  });

  function lastRun(provider: ProviderStatus): string {
    if (!provider.lastRun) return 'never run';
    const status = provider.lastRunStatus ? ` · ${provider.lastRunStatus}` : '';
    return `${relativeAge(provider.lastRun, now)} ago${status}`;
  }
</script>

<svelte:head><title>providers — ongoing</title></svelte:head>

<header class="bar">
  <h1><Icon name="plug" size={14} /> Providers</h1>
  <span class="meta u-dim">
    {#if page.host}host <code class="u-mono">{page.host}</code>{/if}
    {#if page.configPath}· config <code class="u-mono">{page.configPath}</code>{:else if page.host}·
      no config file{/if}
  </span>
</header>

<div class="scroll">
  {#if page.error}
    <p class="empty error">{page.error}</p>
  {/if}
  {#each page.providers as provider (provider.name)}
    <section class="provider" data-provider={provider.name} data-state={provider.state}>
      <div class="head">
        <h2>{provider.name}</h2>
        <Badge tone={stateTone(provider.state)} dot>{provider.state}</Badge>
        <Badge tone="neutral">{provider.schedule}</Badge>
        <span class="u-dim last-run">{lastRun(provider)}</span>
      </div>
      <p class="description u-dim">{provider.description}</p>
      {#if provider.reason}<p class="reason">{provider.reason}</p>{/if}
      {#if provider.lastRunDetail && provider.lastRunDetail !== provider.reason}
        <p class="detail u-dim">last run: {provider.lastRunDetail}</p>
      {/if}
      <dl class="facts">
        <dt>kinds</dt>
        <dd class="u-mono">{provider.kinds.join(', ') || '—'}</dd>
        {#if provider.dependsOn.length}
          <dt>depends on</dt>
          <dd class="u-mono">{provider.dependsOn.join(', ')}</dd>
        {/if}
        <dt>requires</dt>
        <dd class="u-mono">{requirementList(provider).join(', ') || 'nothing'}</dd>
        {#if provider.relations.length}
          <dt>relations</dt>
          <dd class="u-mono">{provider.relations.join(', ')}</dd>
        {/if}
        {#if Object.keys(provider.settings).length}
          <dt>settings</dt>
          <dd class="u-mono">{JSON.stringify(provider.settings)}</dd>
        {/if}
      </dl>
      <ul class="fields">
        {#each provider.fields as field (field)}
          <li class="u-mono">{field}</li>
        {:else}
          <li class="u-dim">contributes no fields</li>
        {/each}
      </ul>
    </section>
  {:else}
    {#if loaded && !page.error}
      <p class="empty">No providers contribute to this catalog.</p>
    {/if}
  {/each}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
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

  .meta {
    font-size: var(--text-2xs);
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
  }

  .provider {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .last-run {
    margin-left: auto;
    font-size: var(--text-2xs);
  }

  .description {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
  }

  .reason {
    margin: var(--space-1) 0 0;
    color: var(--status-warn);
    font-size: var(--text-xs);
  }

  .detail {
    margin: var(--space-1) 0 0;
    font-size: var(--text-2xs);
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0 var(--space-3);
    margin: var(--space-2) 0 0;
    font-size: var(--text-2xs);
  }

  dt {
    color: var(--text-tertiary);
  }

  dd {
    margin: 0;
    color: var(--text-secondary);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .empty {
    padding: var(--space-8);
    color: var(--text-tertiary);
    text-align: center;
  }

  .error {
    color: var(--status-error);
  }
</style>
