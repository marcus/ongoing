<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import { compactNumber, fullDate, oldestAge, relativeAge } from '$lib/dashboard/format';
  import ActivityBars from './ActivityBars.svelte';

  let { project, onplaceholder } = $props<{
    project: DashboardProject;
    onplaceholder: (action: string) => void;
  }>();
  let metrics = $derived(project.metrics);
  let githubUrl = $derived(
    metrics?.githubOwner && metrics.githubName
      ? `https://github.com/${metrics.githubOwner}/${metrics.githubName}`
      : null
  );
</script>

<section class="drawer" id={`details-${project.id}`} aria-label={`${project.name} details`}>
  <div class="drawer-column note-column">
    <p class="path">
      ~/{project.relativePath}
      {#if metrics?.branch}
        · {metrics.branch}{/if}
      {#if metrics?.dirtyFiles}
        · {metrics.dirtyFiles} dirty{/if}
      {#if metrics?.aheadCount || metrics?.behindCount}
        · ↑{metrics.aheadCount ?? 0} ↓{metrics.behindCount ?? 0}{/if}
    </p>
    <h3>Note</h3>
    <textarea
      readonly
      maxlength="500"
      value={project.note}
      aria-label={`Note for ${project.name}`}
      title="Note editing arrives in the next dashboard story"
      onclick={() => onplaceholder('note editing')}></textarea>
    <p class="saved">cached locally · editing arrives next</p>
    <div class="actions" aria-label="Project actions">
      <button type="button" onclick={() => onplaceholder('Open in Finder')}>Open in Finder</button>
      <button type="button" onclick={() => onplaceholder('Open in Terminal')}>Terminal</button>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      {#if githubUrl}<a class="button" href={githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a
        >{/if}
      <button class="danger" type="button" onclick={() => onplaceholder('hide project')}
        >Hide</button
      >
    </div>
    {#if project.errors.length}
      <div class="error-list" role="status">
        {#each project.errors as error (error.collector)}
          <p><b>{error.collector}</b> · {error.message} · {relativeAge(error.occurredAt)} ago</p>
        {/each}
      </div>
    {/if}
  </div>

  <div class="drawer-column">
    <h3>Repository</h3>
    <dl class="kv">
      <dt>head</dt>
      <dd>
        {metrics?.branch ?? '—'}{#if metrics?.latestCommitShortSha}
          · {metrics.latestCommitShortSha}{/if}
      </dd>
      <dt>last commit</dt>
      <dd title={fullDate(metrics?.latestCommitAt ?? null)}>
        {relativeAge(metrics?.latestCommitAt ?? null)} ago
      </dd>
      <dt>lifetime commits</dt>
      <dd>{compactNumber(metrics?.commitCount ?? null)}</dd>
      <dt>active days 30d</dt>
      <dd>{metrics?.activeDays30d ?? '—'}</dd>
      <dt>churn 30d</dt>
      <dd>
        +{compactNumber(metrics?.churnAdded30d ?? null)} −{compactNumber(
          metrics?.churnDeleted30d ?? null
        )}
      </dd>
      <dt>contributors</dt>
      <dd>
        {metrics?.contributorCount ??
          '—'}{#if metrics?.localAuthorCommitShare30d !== null && metrics?.localAuthorCommitShare30d !== undefined}
          · you {Math.round(metrics.localAuthorCommitShare30d * 100)}%{/if}
      </dd>
      <dt>last tag</dt>
      <dd>
        {metrics?.latestTag ??
          '—'}{#if metrics?.commitsSinceLatestTag !== null && metrics?.commitsSinceLatestTag !== undefined}
          · {metrics.commitsSinceLatestTag} commits ago{/if}
      </dd>
      <dt>loc</dt>
      <dd>
        {compactNumber(metrics?.locCode ?? null)} code · {compactNumber(
          metrics?.locComment ?? null
        )} comment
      </dd>
      <dt>td open / blocked / review</dt>
      <dd>
        {metrics?.tdTotalNonClosedCount ?? '—'} / {metrics?.tdBlockedCount ?? '—'} / {metrics?.tdReviewCount ??
          '—'}
      </dd>
    </dl>
  </div>

  <div class="drawer-column">
    <h3>Trend · commits · 7 / 30 / 90d</h3>
    <ActivityBars
      seven={metrics?.commits7d}
      thirty={metrics?.commits30d}
      ninety={metrics?.commits90d}
      width={240}
      height={34}
    />
    <h3 class="section-heading">GitHub · cached</h3>
    {#if metrics?.githubRepoId}
      <dl class="kv">
        <dt>★ trend 30d</dt>
        <dd class="up">
          {project.githubStarsGained30d === null
            ? '—'
            : `${project.githubStarsGained30d >= 0 ? '+' : ''}${project.githubStarsGained30d}`}
        </dd>
        <dt>stars / forks</dt>
        <dd>{compactNumber(metrics.githubStars)} / {compactNumber(metrics.githubForks)}</dd>
        <dt>issues / prs</dt>
        <dd>{metrics.githubOpenIssues ?? '—'} / {metrics.githubOpenPrs ?? '—'}</dd>
        <dt>external prs</dt>
        <dd>
          {metrics.githubExternalPrs ?? '—'} · oldest {oldestAge(metrics.githubOldestExternalPrAt)}
        </dd>
        <dt>traffic views / clones</dt>
        <dd>
          {compactNumber(metrics.githubTrafficViews)} / {compactNumber(metrics.githubTrafficClones)}
        </dd>
        <dt>last release</dt>
        <dd>
          {metrics.githubLatestReleaseTag ?? '—'}{#if metrics.githubLatestReleaseAt}
            · {relativeAge(metrics.githubLatestReleaseAt)} ago{/if}
        </dd>
        <dt>collected</dt>
        <dd>{relativeAge(metrics.githubScannedAt)} ago</dd>
      </dl>
    {:else}
      <dl class="kv">
        <dt>remote</dt>
        <dd>
          {metrics?.githubAvailability === 'unauthenticated'
            ? 'authentication needed'
            : 'none — local only'}
        </dd>
      </dl>
    {/if}
  </div>
</section>
