<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import { ageTone, compactNumber, fullDate, relativeAge } from '$lib/dashboard/format';
  import ActivityBars from './ActivityBars.svelte';
  import ProjectDrawer from './ProjectDrawer.svelte';

  let { project, open, active, ontoggle, onplaceholder } = $props<{
    project: DashboardProject;
    open: boolean;
    active: boolean;
    ontoggle: () => void;
    onplaceholder: (action: string) => void;
  }>();
  let metrics = $derived(project.metrics);
  let oldExternalPr = $derived(
    metrics?.githubOldestExternalPrAt
      ? (Date.now() - Date.parse(metrics.githubOldestExternalPrAt)) / 86_400_000 >= 30
      : false
  );
  let staleGit = $derived(
    metrics?.gitScannedAt ? Date.now() - Date.parse(metrics.gitScannedAt) > 15 * 60_000 : false
  );

  function rowKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      ontoggle();
    }
  }
</script>

<div
  class="project-row"
  class:favorite={project.isFavorite}
  class:open-row={open}
  class:active-row={active}
  role="button"
  tabindex={active ? 0 : -1}
  aria-expanded={open}
  aria-controls={`details-${project.id}`}
  aria-label={`${project.name}, ${metrics?.branch ?? 'no branch'}, last commit ${relativeAge(metrics?.latestCommitAt ?? null)} ago`}
  data-project-row={project.id}
  onclick={ontoggle}
  onkeydown={rowKeydown}
>
  <button
    type="button"
    class="star"
    class:on={project.isFavorite}
    aria-label={`${project.isFavorite ? 'Unfavorite' : 'Favorite'} ${project.name}; available in the next story`}
    title="Favorite changes arrive in the next dashboard story"
    onclick={(event) => {
      event.stopPropagation();
      onplaceholder('favorite');
    }}>{project.isFavorite ? '★' : '☆'}</button
  >
  <div
    class="project-name"
    data-label="project"
    title={`${project.name} · ~/${project.relativePath}${project.note ? ` · ${project.note}` : ''}`}
  >
    <strong>{project.name}</strong>
    {#if project.note}<span>{project.note}</span>{/if}
  </div>
  <div class="branch" data-label="branch" title={metrics?.branch ?? 'No branch collected'}>
    {metrics?.branch ?? '—'}
    {#if metrics?.dirtyFiles}<span class="dirty">●{metrics.dirtyFiles}</span>{/if}
    {#if metrics?.aheadCount || metrics?.behindCount}<span class="sync"
        >↑{metrics.aheadCount ?? 0} ↓{metrics.behindCount ?? 0}</span
      >{/if}
  </div>
  <div
    class={`commit age-${ageTone(metrics?.latestCommitAt ?? null)}`}
    data-label="commit"
    title={`${metrics?.latestCommitSubject ?? 'No commit subject'} · ${fullDate(metrics?.latestCommitAt ?? null)}`}
  >
    {relativeAge(metrics?.latestCommitAt ?? null)}
  </div>
  <div class="activity" data-label="activity">
    <ActivityBars
      seven={metrics?.commits7d}
      thirty={metrics?.commits30d}
      ninety={metrics?.commits90d}
    />
    <span>{metrics?.commits30d ?? '—'}</span>
  </div>
  <div class="loc" data-label="loc">
    <span class="language"><i></i>{metrics?.dominantLanguage ?? 'unknown'}</span>
    <strong>{compactNumber(metrics?.locCode ?? null)}</strong>
  </div>
  <div
    class="td"
    data-label="td"
    aria-label={`${metrics?.tdTotalNonClosedCount ?? 'no'} open TD issues, ${metrics?.tdBlockedCount ?? 'no'} blocked`}
  >
    <strong>{metrics?.tdTotalNonClosedCount ?? '—'}</strong>
    {#if metrics?.tdBlockedCount}<span>{metrics.tdBlockedCount}blk</span>{/if}
  </div>
  <div class="github" data-label="github">
    {#if metrics?.githubRepoId}
      <i
        class={`ci ${metrics.githubCiState ?? 'unknown'}`}
        title={`CI ${metrics.githubCiState ?? 'unknown'}`}
      ></i>
      <span><strong>{compactNumber(metrics.githubStars)}</strong><small>★</small></span>
      <span class="up"
        >{project.githubStarsGained30d === null
          ? '—'
          : `${project.githubStarsGained30d >= 0 ? '+' : ''}${project.githubStarsGained30d}`}</span
      >
      <span><strong>{metrics.githubOpenIssues ?? '—'}</strong><small>iss</small></span>
      <span
        ><strong>{metrics.githubOpenPrs ?? '—'}</strong><small
          >pr{#if metrics.githubExternalPrs}·{metrics.githubExternalPrs}e{/if}</small
        ></span
      >
    {:else}<span class="none"
        >{metrics?.githubAvailability === 'unauthenticated' ? 'auth needed' : 'no remote'}</span
      >{/if}
  </div>
  <div class="tail" data-label="warnings">
    <span class="flags" aria-label="Warnings">
      {#if project.isMissing}<span title="Missing from disk">ø</span>{/if}
      {#if metrics?.githubCiState === 'failure'}<span title="CI failing">▲</span>{/if}
      {#if oldExternalPr}<span class="warn" title="External pull request older than 30 days">»</span
        >{/if}
      {#if metrics?.tdStaleCount}<span
          class="warn"
          title={`${metrics.tdStaleCount} stale TD issues`}>~</span
        >{/if}
      {#if staleGit}<span class="warn" title="Local Git metrics are stale">◷</span>{/if}
      {#each project.errors as error (error.collector)}<span
          class="warn"
          title={`${error.collector}: ${error.message}`}>!</span
        >{/each}
    </span>
    <button
      type="button"
      class="menu"
      aria-label={`Actions for ${project.name}; available in next story`}
      onclick={(event) => {
        event.stopPropagation();
        onplaceholder('project actions');
      }}>⋮</button
    >
  </div>
</div>
{#if open}<ProjectDrawer {project} {onplaceholder} />{/if}
