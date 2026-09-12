<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import type { EntryView } from '$lib/domain/entry-view';
  import { TECHNOLOGY_KIND } from '$lib/domain/technology';
  import { Catalog, githubUrl } from '$lib/ui/catalog.svelte';
  import { setCatalogContext } from '$lib/ui/context';
  import Icon from '$lib/ui/Icon.svelte';
  import type { PaletteItem } from '$lib/ui/palette';
  import Palette from '$lib/ui/Palette.svelte';
  import Rail from '$lib/ui/Rail.svelte';
  import type { RailSection } from '$lib/ui/rail';
  import { readInventoryState } from '$lib/ui/query-state';
  import { relativeAge } from '$lib/ui/format';
  import { VIEW_LABELS, viewIcon } from '$lib/ui/views';
  import '$lib/ui/tokens.css';

  let { data, children } = $props();

  // The store is constructed once from the first payload and adopts every later one below.
  // svelte-ignore state_referenced_locally
  const catalog = setCatalogContext(new Catalog(data));
  // Adopt only a genuinely new payload. A client-side navigation hands the layout the same rows
  // again, and replacing the arrays would rebuild every row the list is showing — detaching the
  // panel someone is reading mid-click.
  $effect(() => {
    if (data.generatedAt !== catalog.generatedAt) catalog.adopt(data);
  });

  const THEMES = ['system', 'dark', 'light'] as const;

  let paletteOpen = $state(false);
  let theme = $state<(typeof THEMES)[number]>('system');
  let pendingPrefix = $state<string | null>(null);
  let now = Date.now();

  let inventory = $derived(readInventoryState(page.url.searchParams, catalog.views));
  let projects = $derived(catalog.entries.filter((entry) => entry.kind === 'project'));
  let technologies = $derived(catalog.entries.filter((entry) => entry.kind === TECHNOLOGY_KIND));

  function count(query: string): number {
    return projects.filter((entry) => entry.views.includes(query)).length;
  }

  let sections = $derived<RailSection[]>([
    {
      title: 'Catalog',
      items: [
        {
          label: 'Projects',
          href: '/',
          icon: 'folder',
          count: projects.filter((entry) => !entry.isHidden).length,
          active: page.url.pathname === '/' && inventory.kind === 'project' && !inventory.saved
        },
        {
          label: 'Technologies',
          href: '/?q=kind%3Atechnology',
          icon: 'package',
          count: technologies.length,
          active:
            page.url.pathname === '/' && inventory.kind === TECHNOLOGY_KIND && !inventory.saved
        }
      ]
    },
    {
      title: 'Attention',
      items: Object.keys(VIEW_LABELS).map((key) => ({
        label: VIEW_LABELS[key],
        href: `/?saved=${key}`,
        icon: 'target' as const,
        count: count(key),
        active: inventory.saved === key
      }))
    },
    {
      title: 'Saved views',
      items: catalog.views
        .filter((view) => !(view.name in VIEW_LABELS))
        .map((view) => ({
          label: view.name,
          href: `/?saved=${encodeURIComponent(view.name)}`,
          icon: viewIcon(view.name),
          active: inventory.saved === view.name
        }))
    },
    {
      title: 'Screens',
      items: [
        {
          label: 'Radar',
          href: '/radar',
          icon: 'orbit',
          active: page.url.pathname === '/radar'
        },
        {
          label: 'Providers',
          href: '/providers',
          icon: 'plug',
          active: page.url.pathname === '/providers'
        }
      ]
    }
  ]);

  function entryHref(entry: EntryView): string {
    return `/${entry.kind === TECHNOLOGY_KIND ? 't' : 'p'}/${entry.slug}`;
  }

  let paletteItems = $derived.by<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    const target = catalog.focused;
    if (target) {
      const intent = catalog.registry.get('intent');
      for (const option of intent?.options?.values ?? [])
        if (target.kind === 'project')
          items.push({
            id: `intent-${option}`,
            group: `${target.name}`,
            label: `Set intent ${option}`,
            hint: `ongoing set ${target.slug} intent ${option}`,
            icon: 'target',
            run: () => void catalog.setField(target, 'intent', option)
          });
      items.push(
        {
          id: 'favorite',
          group: target.name,
          label: target.isFavorite ? 'Remove from favorites' : 'Add to favorites',
          hint: `ongoing favorite ${target.slug}`,
          icon: 'star',
          run: () => void catalog.setField(target, 'is_favorite', !target.isFavorite)
        },
        {
          id: 'hide',
          group: target.name,
          label: target.isHidden ? 'Unhide' : 'Hide',
          hint: `ongoing ${target.isHidden ? 'unhide' : 'hide'} ${target.slug}`,
          icon: 'eye-off',
          run: () => void catalog.setField(target, 'is_hidden', !target.isHidden)
        },
        {
          id: 'reorder',
          group: target.name,
          label: 'Reorder — set manual rank',
          hint: `ongoing set ${target.slug} manual_rank <n>`,
          icon: 'sort',
          run: () => {
            const current = target.fields.manual_rank;
            const answer = window.prompt(
              `Manual rank for ${target.name} (ranks are sparse; 1000, 2000, …)`,
              current === undefined || current === null ? '' : String(current)
            );
            if (answer === null) return;
            void catalog.setField(target, 'manual_rank', answer.trim() ? Number(answer) : null);
          }
        }
      );
      if (target.kind === 'project' && target.path)
        items.push({
          id: 'terminal',
          group: target.name,
          label: 'Open in Terminal',
          hint: `ongoing open ${target.slug} --terminal`,
          icon: 'terminal',
          run: () => void catalog.open(target, 'terminal')
        });
      const github = githubUrl(target);
      if (github)
        items.push({
          id: 'github',
          group: target.name,
          label: 'Open on GitHub',
          hint: `ongoing open ${target.slug} --github`,
          icon: 'github',
          run: () => window.open(github, '_blank', 'noreferrer')
        });
    }

    for (const view of catalog.views)
      items.push({
        id: `view-${view.id}`,
        group: 'Switch view',
        label: VIEW_LABELS[view.name] ?? view.name,
        hint: `ongoing list --saved ${view.name}`,
        icon: viewIcon(view.name),
        terms: `${view.name} ${view.query}`,
        run: () => void goto(`/?saved=${encodeURIComponent(view.name)}`)
      });

    items.push(
      {
        id: 'go-projects',
        group: 'Go',
        label: 'Projects',
        hint: 'g p',
        icon: 'folder',
        run: () => void goto('/?q=kind%3Aproject')
      },
      {
        id: 'go-technologies',
        group: 'Go',
        label: 'Technologies',
        hint: 'g t',
        icon: 'package',
        run: () => void goto('/?q=kind%3Atechnology')
      },
      {
        id: 'go-radar',
        group: 'Go',
        label: 'Radar',
        hint: 'g r',
        icon: 'orbit',
        run: () => void goto('/radar')
      },
      {
        id: 'go-providers',
        group: 'Go',
        label: 'Providers',
        hint: '',
        icon: 'plug',
        run: () => void goto('/providers')
      }
    );

    for (const entry of catalog.entries)
      items.push({
        id: `entry-${entry.id}`,
        group: 'Jump to',
        label: entry.name,
        hint: `${entry.kind === TECHNOLOGY_KIND ? 't' : 'p'}/${entry.slug}`,
        icon: entry.kind === TECHNOLOGY_KIND ? 'package' : 'folder',
        terms: `${entry.slug} ${entry.path ?? ''}`,
        run: () => void goto(entryHref(entry))
      });
    return items;
  });

  function applyTheme(next: (typeof THEMES)[number]) {
    theme = next;
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ongoing-theme', next);
    } catch {
      /* a browser with storage disabled still gets the theme for this session */
    }
  }

  onMount(() => {
    document.documentElement.dataset.hydrated = 'true';
    let stored: string | null;
    try {
      stored = localStorage.getItem('ongoing-theme');
    } catch {
      // A browser with site data blocked still gets the system theme.
      stored = null;
    }
    if (stored === 'dark' || stored === 'light') applyTheme(stored);
  });

  function typingInto(target: EventTarget | null): boolean {
    const node = target as HTMLElement | null;
    if (!node) return false;
    return (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement ||
      node.isContentEditable
    );
  }

  function onkeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      paletteOpen = true;
      return;
    }
    if (paletteOpen || event.metaKey || event.ctrlKey || event.altKey) return;
    if (typingInto(event.target)) return;
    if (pendingPrefix === 'g') {
      pendingPrefix = null;
      if (event.key === 'p') void goto('/?q=kind%3Aproject');
      else if (event.key === 't') void goto('/?q=kind%3Atechnology');
      else if (event.key === 'r') void goto('/radar');
      else if (event.key === 'i') void goto('/');
      return;
    }
    if (event.key === 'g') {
      pendingPrefix = 'g';
      setTimeout(() => (pendingPrefix = null), 1200);
      return;
    }
    if (event.key === 'u' && catalog.message?.undo) {
      event.preventDefault();
      catalog.message.undo();
    }
  }
</script>

<svelte:window {onkeydown} />
<svelte:head><title>ongoing — software inventory</title></svelte:head>

<div class="shell">
  <Rail {sections}>
    {#snippet footer()}
      <div class="footer-row">
        <span
          >{data.scan
            ? `scanned ${relativeAge(data.scan.finishedAt, now)} ago`
            : 'no scan yet'}</span
        >
        <span class="themes" role="group" aria-label="Theme">
          {#each THEMES as option (option)}
            <button
              class="button button-ghost"
              type="button"
              aria-pressed={theme === option}
              aria-label={`${option} theme`}
              onclick={() => applyTheme(option)}>{option[0]}</button
            >
          {/each}
        </span>
      </div>
      <button
        class="button button-ghost palette-hint"
        type="button"
        onclick={() => (paletteOpen = true)}
      >
        <Icon name="search" size={12} /> palette <kbd class="kbd">⌘K</kbd>
      </button>
    {/snippet}
  </Rail>

  <div class="main">
    {#if catalog.loadError}
      <p class="load-error" role="alert">{catalog.loadError}</p>
    {/if}
    {@render children()}
  </div>
</div>

{#if catalog.message}
  <div class="status" data-tone={catalog.message.tone} role="status">
    <span>{catalog.message.text}</span>
    {#if catalog.message.undo}
      <button class="button button-ghost" type="button" onclick={() => catalog.message?.undo?.()}>
        <Icon name="undo" size={12} /> undo <kbd class="kbd">u</kbd>
      </button>
    {/if}
    <button
      class="button button-ghost"
      type="button"
      aria-label="Dismiss message"
      onclick={() => (catalog.message = null)}
    >
      <Icon name="x" size={12} />
    </button>
  </div>
{/if}

{#if paletteOpen}
  <Palette items={paletteItems} onclose={() => (paletteOpen = false)} />
{/if}

<style>
  .shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .load-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--status-error-tint);
    color: var(--status-error);
    font-size: var(--text-xs);
  }

  .footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .themes {
    display: flex;
    gap: 2px;
  }

  .themes .button {
    padding: 0 var(--space-1);
    text-transform: uppercase;
  }

  .palette-hint {
    margin-top: var(--space-1);
    width: 100%;
    justify-content: flex-start;
  }

  .status {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    font-size: var(--text-xs);
  }

  .status[data-tone='error'] {
    border-color: var(--status-error);
    color: var(--status-error);
  }
</style>
