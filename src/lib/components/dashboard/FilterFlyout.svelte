<script lang="ts">
  import type { DashboardQuery, ViewKey } from '$lib/dashboard/catalog';
  import { filterOptions, groupOptions, sortOptions, viewOptions } from '$lib/dashboard/options';
  import type { SortKey } from '$lib/domain/sorting';
  import type { Toolchain } from '$lib/domain/stack';
  import { resolve } from '$app/paths';

  let { query, viewCounts, stacks, hiddenCount, onchange } = $props<{
    query: DashboardQuery;
    viewCounts: Record<ViewKey, number>;
    stacks: { key: Toolchain; count: number }[];
    hiddenCount: number;
    onchange: (patch: Partial<DashboardQuery>) => void;
  }>();

  function chooseSort(key: SortKey) {
    const option = sortOptions.find((candidate) => candidate.key === key)!;
    onchange({
      sort: key,
      ...(key === 'manual' ? { direction: 'asc' as const, group: 'none' as const } : {}),
      direction:
        key === 'manual'
          ? 'asc'
          : query.sort === key
            ? query.direction === 'asc'
              ? 'desc'
              : 'asc'
            : option.defaultDirection
    });
  }
</script>

<div class="flyout" role="dialog" aria-label="Sort and filter projects" tabindex="-1">
  <h2>Sort</h2>
  <div class="sort-list">
    {#each sortOptions as option, index (option.key)}
      <button
        type="button"
        class:active={query.sort === option.key}
        aria-pressed={query.sort === option.key}
        onclick={() => chooseSort(option.key)}
      >
        <span class="shortcut">{index < 9 ? index + 1 : '·'}</span>
        {option.label}
        {#if query.sort === option.key}<span class="direction"
            >{query.direction === 'desc' ? '↓' : '↑'}</span
          >{/if}
      </button>
    {/each}
  </div>

  <h2>Attend to</h2>
  <div class="chips">
    {#each viewOptions as option (option.key)}
      <button
        type="button"
        class={`chip ${option.className}`}
        class:active={query.view === option.key}
        aria-pressed={query.view === option.key}
        onclick={() => onchange({ view: query.view === option.key ? null : option.key })}
        >{option.label} <b>{viewCounts[option.key]}</b></button
      >
    {/each}
  </div>

  {#if stacks.length > 0}
    <h2>Stack</h2>
    <div class="chips">
      {#each stacks as option (option.key)}
        <button
          type="button"
          class="chip cyan"
          class:active={query.stack === option.key}
          aria-pressed={query.stack === option.key}
          onclick={() => onchange({ stack: query.stack === option.key ? null : option.key })}
          >{option.key} <b>{option.count}</b></button
        >
      {/each}
    </div>
  {/if}

  <h2>Show</h2>
  <div class="option-grid">
    {#each filterOptions as option (option.key)}
      <button
        type="button"
        class:active={query.filter === option.key}
        onclick={() => onchange({ filter: option.key })}
      >
        {option.label}
      </button>
    {/each}
  </div>

  <h2>Group</h2>
  <div class="option-grid">
    {#each groupOptions as option (option.key)}
      <button
        type="button"
        class:active={query.group === option.key}
        onclick={() => onchange({ group: option.key })}
      >
        {option.label}
      </button>
    {/each}
    <a class="flyout-link" href={resolve('/hidden')}
      >show hidden <span class="count">{hiddenCount}</span></a
    >
  </div>
</div>
