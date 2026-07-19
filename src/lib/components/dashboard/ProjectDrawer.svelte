<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import { compactNumber, fullDate, oldestAge, relativeAge } from '$lib/dashboard/format';
  import ActivityBars from './ActivityBars.svelte';

  let {
    project,
    noteEditable = true,
    onnote,
    onhide,
    onaction,
    hideLabel = 'Hide'
  } = $props<{
    project: DashboardProject;
    noteEditable?: boolean;
    onnote?: (note: string) => Promise<void>;
    onhide?: () => void;
    onaction?: (action: 'finder' | 'terminal') => Promise<void>;
    hideLabel?: string;
  }>();
  let metrics = $derived(project.metrics);
  let editedNote = $state<string | undefined>();
  let persistedNote = $state<string | undefined>();
  let note = $derived(editedNote ?? project.note);
  let savedNote = $derived(persistedNote ?? project.note);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('saved');
  let saveMessage = $state('saved locally');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let githubUrl = $derived(
    metrics?.githubOwner && metrics.githubName
      ? `https://github.com/${metrics.githubOwner}/${metrics.githubName}`
      : null
  );

  async function saveNote() {
    clearTimeout(timer);
    if (!onnote || note === savedNote) return;
    saveState = 'saving';
    saveMessage = 'saving…';
    const value = note;
    try {
      await onnote(value);
      persistedNote = value;
      saveState = 'saved';
      saveMessage = 'saved locally';
    } catch (error) {
      saveState = 'error';
      saveMessage = error instanceof Error ? error.message : 'save failed';
    }
  }
  function editNote(event: Event) {
    editedNote = (event.currentTarget as HTMLTextAreaElement).value;
    saveState = 'idle';
    saveMessage = `${500 - note.length} characters remaining`;
    clearTimeout(timer);
    timer = setTimeout(() => void saveNote(), 500);
  }
  async function localAction(action: 'finder' | 'terminal') {
    if (!onaction) return;
    saveMessage = `opening ${action}…`;
    try {
      await onaction(action);
      saveMessage = `${action} opened`;
    } catch (error) {
      saveState = 'error';
      saveMessage = error instanceof Error ? error.message : `unable to open ${action}`;
    }
  }
</script>

<section class="drawer" id={`details-${project.id}`} aria-label={`${project.name} details`}>
  <div class="drawer-column note-column">
    <p class="path">
      ~/{project.relativePath}{#if metrics?.branch}
        · {metrics.branch}{/if}{#if metrics?.dirtyFiles}
        · {metrics.dirtyFiles} dirty{/if}{#if metrics?.aheadCount || metrics?.behindCount}
        · ↑{metrics.aheadCount ?? 0} ↓{metrics.behindCount ?? 0}{/if}
    </p>
    <h3>Note</h3>
    <textarea
      maxlength="500"
      readonly={!noteEditable}
      value={note}
      aria-label={`Note for ${project.name}`}
      oninput={editNote}
      onblur={() => void saveNote()}></textarea>
    <p class="saved" class:error-save={saveState === 'error'} role="status">
      {noteEditable ? saveMessage : 'saved locally · read only while hidden'}
    </p>
    <div class="actions" aria-label="Project actions">
      {#if onaction}<button type="button" onclick={() => void localAction('finder')}
          >Open in Finder</button
        ><button type="button" onclick={() => void localAction('terminal')}>Terminal</button>{/if}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      {#if githubUrl}<a class="button" href={githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a
        >{/if}
      {#if onhide}<button class="danger" type="button" onclick={onhide}>{hideLabel}</button>{/if}
    </div>
    {#if project.errors.length}<div class="error-list" role="status">
        {#each project.errors as error (error.collector)}<p>
            <b>{error.collector}</b> · {error.message} · {relativeAge(error.occurredAt)} ago
          </p>{/each}
      </div>{/if}
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
      <dt>td in progress / stale</dt>
      <dd>{metrics?.tdInProgressCount ?? '—'} / {metrics?.tdStaleCount ?? '—'}</dd>
      <dt>td collected</dt>
      <dd>{metrics?.tdScannedAt ? `${relativeAge(metrics.tdScannedAt)} ago` : 'unavailable'}</dd>
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
    {#if metrics?.githubRepoId}<dl class="kv">
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
      </dl>{:else}<dl class="kv">
        <dt>remote</dt>
        <dd>
          {metrics?.githubAvailability === 'unauthenticated'
            ? 'authentication needed'
            : 'none — local only'}
        </dd>
      </dl>{/if}
  </div>
</section>
