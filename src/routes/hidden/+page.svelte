<script lang="ts">
  import { resolve } from '$app/paths';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import ProjectDrawer from '$lib/components/dashboard/ProjectDrawer.svelte';
  import '$lib/components/dashboard/dashboard.css';

  let { data } = $props();
  let query = $state('');
  let restored = $state<string[]>([]);
  let openId = $state<string | null>(null);
  let status = $state('');
  let visible = $derived(
    data.projects.filter(
      (project) =>
        !restored.includes(project.id) &&
        `${project.name}\n${project.relativePath}\n${project.note}`
          .toLocaleLowerCase('en')
          .includes(query.trim().toLocaleLowerCase('en'))
    )
  );

  onMount(() => {
    document.documentElement.dataset.hydrated = 'true';
  });

  async function restoreProject(id: string, name: string) {
    restored = [...restored, id];
    status = `Restoring ${name}…`;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/hide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hidden: false })
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to restore project');
      status = `${name} restored; enrichment scheduled.`;
      void invalidateAll();
    } catch (error) {
      restored = restored.filter((candidate) => candidate !== id);
      status = error instanceof Error ? error.message : 'Unable to restore project';
    }
  }
</script>

<svelte:head><title>hidden projects — ongoing</title></svelte:head>

<header class="app-header hidden-header">
  <a class="wordmark" href={resolve('/')} aria-label="ongoing home">ongoing<span>.</span></a>
  <span class="hidden-title">hidden projects</span>
  <div class="header-spacer"></div>
  <label class="search-label" for="hidden-search">
    <span class="sr-only">Search hidden projects</span>
    <input
      id="hidden-search"
      class="search"
      type="search"
      placeholder="filter hidden…"
      bind:value={query}
    />
  </label>
  <a class="button" href={resolve('/')}>back to dashboard</a>
</header>

<main class="hidden-catalog">
  {#if data.loadError}
    <section class="state-panel error-state" role="alert">
      <strong>Catalog unavailable</strong><span>{data.loadError}</span>
    </section>
  {:else if visible.length === 0}
    <section class="state-panel">
      <strong>{data.projects.length ? 'No hidden projects match.' : 'No hidden projects.'}</strong
      ><span>Hidden projects preserve notes, metrics, history, and their manual rank.</span>
    </section>
  {:else}
    <div class="hidden-list" role="list" aria-label="Hidden projects">
      {#each visible as project (project.id)}
        <article class="hidden-project" role="listitem">
          <div class="hidden-project-summary">
            <button
              class="hidden-inspect"
              type="button"
              aria-expanded={openId === project.id}
              onclick={() => (openId = openId === project.id ? null : project.id)}
            >
              <strong>{project.name}</strong><span>~/{project.relativePath}</span>
              {#if project.note}<em>{project.note}</em>{/if}
            </button>
            <span class="hidden-rank">rank {project.manualRank}</span>
            <button
              class="button"
              type="button"
              aria-label={`Restore ${project.name}`}
              onclick={() => restoreProject(project.id, project.name)}>restore</button
            >
          </div>
          {#if openId === project.id}
            <ProjectDrawer
              {project}
              noteEditable={false}
              onhide={() => restoreProject(project.id, project.name)}
              hideLabel="Restore"
              hideAccessibleLabel={`Restore ${project.name}`}
            />
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</main>
<p class="sr-only" aria-live="polite">{status}</p>
