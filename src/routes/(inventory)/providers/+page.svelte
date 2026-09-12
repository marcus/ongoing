<script lang="ts">
  import Badge from '$lib/ui/Badge.svelte';
  import { getCatalogContext } from '$lib/ui/context';
  import { relativeAge } from '$lib/ui/format';
  import Icon from '$lib/ui/Icon.svelte';
  import { loadProviders, type ProviderStatus } from '$lib/ui/providers';

  /**
   * Providers: what contributes to the catalog, whether it can run here, and when it last did.
   * The data comes from `GET /api/providers` when that route exists (Phase 5) and from the field
   * registry otherwise — see `$lib/ui/providers.ts`, which names the route and the fallback.
   */
  const catalog = getCatalogContext();

  let providers = $state<ProviderStatus[]>([]);
  let live = $state(false);
  let now = Date.now();

  $effect(() => {
    const registry = catalog.registry;
    void loadProviders(registry).then((result) => {
      providers = result.providers;
      live = result.live;
    });
  });

  function tone(provider: ProviderStatus) {
    if (provider.enabled === false) return 'neutral' as const;
    if (provider.available === false) return 'error' as const;
    if (provider.available === true) return 'ok' as const;
    return 'neutral' as const;
  }

  function label(provider: ProviderStatus): string {
    if (provider.enabled === false) return 'disabled';
    if (provider.available === false) return 'unavailable';
    if (provider.available === true) return 'available';
    return 'unknown';
  }
</script>

<svelte:head><title>providers — ongoing</title></svelte:head>

<header class="bar">
  <h1><Icon name="plug" size={14} /> Providers</h1>
  {#if !live}
    <p class="note">
      Read from the field registry. <code class="u-mono">GET /api/providers</code> lands with the provider
      manifests in Phase 5; availability and last run are unknown until then.
    </p>
  {/if}
</header>

<div class="scroll">
  {#each providers as provider (provider.name)}
    <section class="provider">
      <div class="head">
        <h2>{provider.name}</h2>
        <Badge tone={tone(provider)} dot>{label(provider)}</Badge>
        {#if provider.schedule}<Badge tone="neutral">{provider.schedule}</Badge>{/if}
        <span class="u-dim last-run">
          {provider.lastRun
            ? `last run ${relativeAge(provider.lastRun, now)} ago`
            : 'last run unknown'}
        </span>
      </div>
      {#if provider.detail}<p class="detail">{provider.detail}</p>{/if}
      <ul class="fields">
        {#each provider.fields as field (field)}
          <li class="u-mono">{field}</li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="empty">No providers contribute to this catalog.</p>
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

  .note {
    margin: 0;
    color: var(--text-tertiary);
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

  .detail {
    margin: var(--space-1) 0 0;
    color: var(--status-error);
    font-size: var(--text-xs);
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
</style>
