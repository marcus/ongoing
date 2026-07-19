<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onDestroy, onMount } from 'svelte';
  import CatalogTicker from '$lib/components/dashboard/CatalogTicker.svelte';
  import FilterFlyout from '$lib/components/dashboard/FilterFlyout.svelte';
  import KeyboardFooter from '$lib/components/dashboard/KeyboardFooter.svelte';
  import ProjectList from '$lib/components/dashboard/ProjectList.svelte';
  import ThemePicker from '$lib/components/dashboard/ThemePicker.svelte';
  import type { DashboardQuery } from '$lib/dashboard/catalog';
  import { relativeAge } from '$lib/dashboard/format';
  import { sortOptions, viewOptions } from '$lib/dashboard/options';
  import '$lib/components/dashboard/dashboard.css';

  let { data } = $props();
  let flyoutOpen = $state(false);
  let openId = $state<string | null>(null);
  let activeIndex = $state(0);
  let favoriteOverrides = $state<Record<string, boolean>>({});
  let noteOverrides = $state<Record<string, string>>({});
  let hiddenIds = $state<string[]>([]);
  let manualOrder = $state<string[] | null>(null);
  let projects = $derived.by(() => {
    let visible = data.visibleProjects
      .filter((project) => !hiddenIds.includes(project.id))
      .map((project) => ({
        ...project,
        isFavorite: favoriteOverrides[project.id] ?? project.isFavorite,
        note: noteOverrides[project.id] ?? project.note
      }));
    if (manualOrder) {
      const positions = new Map(manualOrder.map((id, index) => [id, index]));
      visible = [...visible].sort(
        (left, right) =>
          (positions.get(left.id) ?? Infinity) - (positions.get(right.id) ?? Infinity)
      );
    }
    return visible;
  });
  let manualEnabled = $derived(
    data.query.sort === 'manual' &&
      data.query.direction === 'asc' &&
      !data.query.search &&
      data.query.filter === 'all' &&
      !data.query.view &&
      data.query.group === 'none'
  );
  let activeId = $derived(projects[activeIndex]?.id ?? null);
  let searchValue = $state('');
  let announcement = $state('');
  let scanLabel = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let scanEvents: EventSource | undefined;

  let selectedSort = $derived(sortOptions.find(({ key }) => key === data.query.sort)!);
  let selectedView = $derived(viewOptions.find(({ key }) => key === data.query.view));

  $effect(() => {
    searchValue = data.query.search;
    const ids = projects.map(({ id }) => id);
    if (activeIndex >= ids.length) activeIndex = Math.max(0, ids.length - 1);
    if (openId && !ids.includes(openId)) openId = null;
  });

  function queryUrl(patch: Partial<DashboardQuery>): URL {
    const next = { ...data.query, ...patch };
    const url = new URL(window.location.href);
    url.searchParams.set('sort', next.sort);
    url.searchParams.set('dir', next.direction);
    if (next.search) url.searchParams.set('q', next.search);
    else url.searchParams.delete('q');
    url.searchParams.set('filter', next.filter);
    if (next.view) url.searchParams.set('view', next.view);
    else url.searchParams.delete('view');
    url.searchParams.set('group', next.group);
    return url;
  }

  function changeQuery(patch: Partial<DashboardQuery>, replaceState = false) {
    const url = queryUrl(patch);
    const target = `/?${url.searchParams.toString()}` as `/?${string}`;
    void goto(resolve(target), {
      keepFocus: true,
      noScroll: true,
      replaceState
    });
  }

  function search(event: Event) {
    searchValue = (event.currentTarget as HTMLInputElement).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => changeQuery({ search: searchValue }, true), 180);
  }

  function toggleDetails(id: string) {
    const index = projects.findIndex((project) => project.id === id);
    if (index >= 0) activeIndex = index;
    openId = openId === id ? null : id;
  }

  async function apiMutation(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Unable to save change');
  }
  async function toggleFavorite(id: string, favorite: boolean) {
    const previous = projects.find((project) => project.id === id)?.isFavorite ?? !favorite;
    favoriteOverrides = { ...favoriteOverrides, [id]: favorite };
    announcement = favorite ? 'Project favorited.' : 'Project unfavorited.';
    try {
      await apiMutation(`/api/projects/${encodeURIComponent(id)}/favorite`, { favorite });
    } catch (error) {
      favoriteOverrides = { ...favoriteOverrides, [id]: previous };
      announcement = error instanceof Error ? error.message : 'Unable to update favorite';
    }
  }
  async function saveNote(id: string, note: string) {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note })
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Unable to save note');
    noteOverrides = { ...noteOverrides, [id]: note };
  }
  async function hideProject(id: string) {
    hiddenIds = [...hiddenIds, id];
    openId = null;
    announcement = 'Project hidden. Manage hidden projects to restore it.';
    try {
      await apiMutation(`/api/projects/${encodeURIComponent(id)}/hide`, { hidden: true });
    } catch (error) {
      hiddenIds = hiddenIds.filter((candidate) => candidate !== id);
      announcement = error instanceof Error ? error.message : 'Unable to hide project';
    }
  }
  async function projectAction(id: string, action: 'finder' | 'terminal') {
    await apiMutation(`/api/projects/${encodeURIComponent(id)}`, { action });
    announcement = `${action} opened.`;
  }
  async function reorderProjects(orderedIds: string[]) {
    if (!manualEnabled) return;
    const previous = manualOrder ?? projects.map((project) => project.id);
    manualOrder = orderedIds;
    announcement = 'Saving manual order…';
    try {
      await apiMutation('/api/projects/reorder', { orderedIds });
      announcement = 'Manual order saved.';
    } catch (error) {
      manualOrder = previous;
      announcement = error instanceof Error ? error.message : 'Unable to save manual order';
    }
  }

  function focusProject(id: string) {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-project-row="${CSS.escape(id)}"]`)?.focus();
    });
  }

  function moveSelection(delta: number) {
    const ids = projects.map(({ id }) => id);
    if (!ids.length) return;
    activeIndex = (activeIndex + delta + ids.length) % ids.length;
    const nextId = ids[activeIndex];
    focusProject(nextId);
  }

  function closeFlyoutOutside(event: MouseEvent) {
    if (!(event.target as Element).closest('.filter-wrap')) flyoutOpen = false;
  }

  function chooseShortcut(index: number) {
    const option = sortOptions[index];
    if (!option) return;
    changeQuery({
      sort: option.key,
      ...(option.key === 'manual' ? { group: 'none' as const } : {}),
      direction:
        option.key === 'manual'
          ? 'asc'
          : data.query.sort === option.key
            ? data.query.direction === 'asc'
              ? 'desc'
              : 'asc'
            : option.defaultDirection
    });
  }

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const typing = target.matches('input, textarea, select, [contenteditable="true"]');
    if (event.key === 'Escape') {
      flyoutOpen = false;
      if (typing) target.blur();
      else openId = null;
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') {
      event.preventDefault();
      document.querySelector<HTMLInputElement>('#project-search')?.focus();
    } else if (event.key === 'f') {
      event.preventDefault();
      flyoutOpen = !flyoutOpen;
    } else if (event.key === 'j') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'k') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter' && activeId) {
      event.preventDefault();
      toggleDetails(activeId);
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      chooseShortcut(Number(event.key) - 1);
    } else if (['s', 'n', 'h'].includes(event.key) && activeId) {
      event.preventDefault();
      const project = projects.find(({ id }) => id === activeId);
      if (event.key === 'n') openId = activeId;
      else if (event.key === 's' && project) void toggleFavorite(project.id, !project.isFavorite);
      else if (event.key === 'h') void hideProject(activeId);
    }
  }

  function watchScan(runId: string) {
    scanEvents?.close();
    scanEvents = new EventSource(`/api/scan/events?runId=${encodeURIComponent(runId)}`);
    scanEvents.onmessage = (event) => {
      const progress = JSON.parse(event.data) as {
        discoveredCount?: number;
        updatedCount?: number;
      };
      scanLabel = `scanning… ${progress.updatedCount ?? 0}/${progress.discoveredCount ?? 0}`;
    };
    for (const terminal of ['completed', 'failed', 'cancelled']) {
      scanEvents.addEventListener(terminal, () => {
        scanLabel = terminal === 'completed' ? 'scan complete' : `scan ${terminal}`;
        scanEvents?.close();
        void invalidateAll();
      });
    }
  }

  async function rescan() {
    scanLabel = 'starting scan…';
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh: 'full' })
      });
      const body = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok && response.status !== 409) throw new Error(body.error ?? 'Unable to scan');
      if (body.runId) watchScan(body.runId);
    } catch (error) {
      scanLabel = error instanceof Error ? error.message : 'Unable to scan';
    }
  }

  onMount(() => {
    document.documentElement.dataset.hydrated = 'true';
  });

  onDestroy(() => {
    clearTimeout(searchTimer);
    scanEvents?.close();
  });
</script>

<svelte:head>
  <title>ongoing — project attention</title>
</svelte:head>
<svelte:window onkeydown={keydown} onclick={closeFlyoutOutside} />

<a class="skip-link" href="#project-catalog">Skip to project catalog</a>
<header class="app-header">
  <a class="wordmark" href={resolve('/')} aria-label="ongoing home">ongoing<span>.</span></a>
  <div class="scanline" role="status" aria-live="polite">
    <span
      ><i class:running={data.scan?.status === 'running' || scanLabel.includes('scanning')}
      ></i>{scanLabel ||
        (data.scan?.status === 'running'
          ? `scanning… ${data.scan.updatedCount}/${data.scan.discoveredCount}`
          : data.scan
            ? data.scan.status
            : 'not scanned')}</span
    >
    <span
      >last scan <b
        >{data.scan
          ? `${relativeAge(data.scan.finishedAt ?? data.scan.startedAt)} ago`
          : 'never'}</b
      ></span
    >
  </div>
  <div class="header-spacer"></div>
  <div class="filter-wrap">
    <button
      class="button filter-trigger"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={flyoutOpen}
      onclick={() => {
        flyoutOpen = !flyoutOpen;
      }}
    >
      <span>sort</span> <b>{selectedSort.label} {data.query.direction === 'desc' ? '↓' : '↑'}</b>
      {#if selectedView}<span>·</span> <b>{selectedView.label}</b>{/if}
    </button>
    {#if flyoutOpen}
      <FilterFlyout
        query={data.query}
        viewCounts={data.viewCounts}
        hiddenCount={data.hiddenCount}
        onchange={(patch) => changeQuery(patch)}
      />
    {/if}
  </div>
  <label class="search-label" for="project-search"
    ><span class="sr-only">Filter projects</span><input
      id="project-search"
      class="search"
      type="search"
      placeholder="/ filter projects…"
      value={searchValue}
      oninput={search}
    /></label
  >
  <button class="button" type="button" onclick={rescan}>rescan</button>
  <ThemePicker />
</header>

<CatalogTicker projects={data.projects} />

<main id="project-catalog" tabindex="-1">
  {#if data.loadError}
    <section class="state-panel error-state" role="alert">
      <strong>Catalog unavailable</strong><span>{data.loadError}</span><button
        class="button"
        type="button"
        onclick={() => invalidateAll()}>retry</button
      >
    </section>
  {:else if data.projects.length === 0}
    <section class="state-panel">
      <strong>No projects cached yet.</strong><span
        >Run a scan to discover repositories beneath the configured roots. Existing cached data will
        remain visible during later scans.</span
      ><button class="button" type="button" onclick={rescan}>scan now</button>
    </section>
  {:else if projects.length === 0}
    <section class="state-panel">
      <strong>No projects match this view.</strong><span
        >Clear search, attention view, or filters to return to the catalog.</span
      ><button
        class="button"
        type="button"
        onclick={() => changeQuery({ search: '', filter: 'all', view: null })}>clear filters</button
      >
    </section>
  {:else}
    <ProjectList
      {projects}
      {openId}
      {activeId}
      manual={manualEnabled}
      ontoggle={toggleDetails}
      onfavorite={(id, favorite) => void toggleFavorite(id, favorite)}
      onnote={saveNote}
      onhide={(id) => void hideProject(id)}
      onaction={projectAction}
      onreorder={(ids) => void reorderProjects(ids)}
    />
    {#if data.query.sort === 'manual' && !manualEnabled}<p class="manual-hint" role="status">
        Clear search, filters, views, and favorite grouping to edit the complete manual order.
      </p>{/if}
  {/if}
</main>

<p class="sr-only" aria-live="polite">{announcement}</p>
<KeyboardFooter visible={projects.length} total={data.totalCount} hidden={data.hiddenCount} />
