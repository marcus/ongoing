<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import { viewOptions } from '$lib/dashboard/options';
  import {
    projectIntents,
    type ProjectDecisionUpdate,
    type ProjectIntent
  } from '$lib/domain/project';
  import { compactNumber, fullDate, oldestAge, relativeAge } from '$lib/dashboard/format';
  import type { ResolvedStack, StackStatus } from '$lib/domain/stack';
  import ActivityBars from './ActivityBars.svelte';

  const STACK_CLASS: Record<StackStatus, string> = {
    current: 'up',
    behind: 'lag',
    eol: 'eol',
    unknown: 'none'
  };

  /** The cramped `kv` row shows the verdict; the full evidence lives in the tooltip. */
  function stackTitle(stack: ResolvedStack): string {
    const parts = [`declared ${stack.raw || 'no version'} in ${stack.sourceFile}`];
    if (stack.matchedCycle) parts.push(`cycle ${stack.matchedCycle}`);
    if (stack.cycleLatestRelease) parts.push(`latest in cycle ${stack.cycleLatestRelease}`);
    if (stack.latestRelease) parts.push(`newest supported ${stack.latestRelease}`);
    if (stack.eolFrom) parts.push(`end of life ${stack.eolFrom}`);
    parts.push(
      stack.baselineFetchedAt
        ? `release data ${relativeAge(stack.baselineFetchedAt)} old`
        : 'no release data cached'
    );
    return parts.join(' · ');
  }

  let {
    project,
    noteEditable = true,
    onnote,
    ondecision,
    onhide,
    onaction,
    hideLabel = 'Hide',
    hideAccessibleLabel
  } = $props<{
    project: DashboardProject;
    noteEditable?: boolean;
    onnote?: (note: string) => Promise<void>;
    ondecision?: (update: ProjectDecisionUpdate) => Promise<void>;
    onhide?: () => void;
    onaction?: (action: 'finder' | 'terminal') => Promise<void>;
    hideLabel?: string;
    hideAccessibleLabel?: string;
  }>();
  let metrics = $derived(project.metrics);
  let stacks: ResolvedStack[] = $derived(project.stacks);
  let editedNote = $state<string | undefined>();
  let persistedNote = $state<string | undefined>();
  let note = $derived(editedNote ?? project.note);
  let savedNote = $derived(persistedNote ?? project.note);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('saved');
  let saveMessage = $state('saved locally');
  let decisionMessage = $state('saved locally');
  let editedIntent = $state<ProjectIntent | '' | undefined>();
  let editedExcitement = $state<string | undefined>();
  let editedStrategicImportance = $state<string | undefined>();
  let editedNextAction = $state<string | undefined>();
  let editedReviewAfter = $state<string | undefined>();
  let intent = $derived(editedIntent ?? project.intent ?? '');
  let excitement = $derived(editedExcitement ?? project.excitement?.toString() ?? '');
  let strategicImportance = $derived(
    editedStrategicImportance ?? project.strategicImportance?.toString() ?? ''
  );
  let nextAction = $derived(editedNextAction ?? project.nextAction ?? '');
  let reviewAfter = $derived(editedReviewAfter ?? project.reviewAfter ?? '');
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
  async function saveDecision(update: ProjectDecisionUpdate) {
    if (!ondecision) return;
    decisionMessage = 'saving…';
    try {
      await ondecision(update);
      decisionMessage = 'saved locally';
    } catch (error) {
      decisionMessage = error instanceof Error ? error.message : 'save failed';
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
    {#if ondecision}<div class="decision-fields">
        <h3>Decision</h3>
        <div class="decision-grid">
          <label
            >Intent<select
              aria-label={`Intent for ${project.name}`}
              value={intent}
              onchange={(event) => {
                editedIntent = event.currentTarget.value as ProjectIntent | '';
                void saveDecision({ intent: editedIntent || null });
              }}
              ><option value="">not set</option>{#each projectIntents as option (option)}<option
                  value={option}>{option}</option
                >{/each}</select
            ></label
          >
          <label
            >Excitement<select
              aria-label={`Excitement for ${project.name}`}
              value={excitement}
              onchange={(event) => {
                editedExcitement = event.currentTarget.value;
                void saveDecision({
                  excitement: editedExcitement ? Number(editedExcitement) : null
                });
              }}
              ><option value="">—</option>{#each [1, 2, 3, 4, 5] as value (value)}<option
                  value={value.toString()}>{value}</option
                >{/each}</select
            ></label
          >
          <label
            >Strategic<select
              aria-label={`Strategic importance for ${project.name}`}
              value={strategicImportance}
              onchange={(event) => {
                editedStrategicImportance = event.currentTarget.value;
                void saveDecision({
                  strategicImportance: strategicImportance ? Number(strategicImportance) : null
                });
              }}
              ><option value="">—</option>{#each [1, 2, 3, 4, 5] as value (value)}<option
                  value={value.toString()}>{value}</option
                >{/each}</select
            ></label
          >
          <label
            >Review after<input
              aria-label={`Review after for ${project.name}`}
              type="date"
              value={reviewAfter}
              onchange={(event) => {
                editedReviewAfter = event.currentTarget.value;
                void saveDecision({ reviewAfter: editedReviewAfter || null });
              }}
            /></label
          >
        </div>
        <label class="next-action"
          >Next action<textarea
            maxlength="500"
            aria-label={`Next action for ${project.name}`}
            value={nextAction}
            oninput={(event) => (editedNextAction = event.currentTarget.value)}
            onblur={() => void saveDecision({ nextAction: nextAction || null })}></textarea></label
        >
        <p class="saved" role="status">{decisionMessage}</p>
      </div>{/if}
    <div class="actions" aria-label="Project actions">
      {#if onaction}<button type="button" onclick={() => void localAction('finder')}
          >Open in Finder</button
        ><button type="button" onclick={() => void localAction('terminal')}>Terminal</button>{/if}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      {#if githubUrl}<a class="button" href={githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a
        >{/if}
      {#if onhide}<button
          class="danger"
          type="button"
          aria-label={hideAccessibleLabel}
          onclick={onhide}>{hideLabel}</button
        >{/if}
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
    <h3 class="section-heading">Toolchain</h3>
    {#if stacks.length}
      <dl class="kv">
        {#each stacks as stack (`${stack.toolchain}/${stack.sourceFile}`)}
          <dt>{stack.toolchain}</dt>
          <dd class={STACK_CLASS[stack.status]} title={stackTitle(stack)}>
            {stack.declared || 'unpinned'}
            {#if stack.status === 'eol'}· eol{:else if stack.status === 'behind'}→ {stack.latestCycle}{:else if stack.status === 'current'}·
              current{/if}
          </dd>
        {/each}
        <dt>collected</dt>
        <dd>
          {metrics?.stackScannedAt ? `${relativeAge(metrics.stackScannedAt)} ago` : 'unavailable'}
        </dd>
      </dl>
    {:else}
      <p class="empty-note">No toolchain declared in any root manifest.</p>
    {/if}
  </div>
  <div class="drawer-column">
    {#if project.views.length}<h3>Why this project appears</h3>
      <div class="attention-reasons">
        {#each project.views as key (key)}
          {@const view = viewOptions.find((option) => option.key === key)}
          <section aria-label={`${view?.label ?? key} reasons`}>
            <h4>{view?.label ?? key}</h4>
            <ul>
              {#each project.attention[key].reasons as item (item.input)}
                <li>
                  <span>{item.message}</span><code
                    >{item.input}: {String(item.value)}
                    {item.comparison}
                    {String(item.threshold)}</code
                  >
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
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
        <dt>watchers / contributors</dt>
        <dd>
          {compactNumber(metrics.githubWatchers)} / {compactNumber(metrics.githubContributorCount)}
        </dd>
        <dt>issues / prs (draft · ready)</dt>
        <dd>
          {metrics.githubOpenIssues ?? '—'} / {metrics.githubOpenPrs ?? '—'} ({metrics.githubDraftPrs ??
            '—'} · {metrics.githubReadyPrs ?? '—'})
        </dd>
        <dt>external prs</dt>
        <dd>
          {metrics.githubExternalPrs ?? '—'} · oldest {oldestAge(metrics.githubOldestExternalPrAt)}
        </dd>
        <dt>traffic views / clones</dt>
        <dd>
          {compactNumber(metrics.githubTrafficViews)} / {compactNumber(metrics.githubTrafficClones)}
          {#if project.githubTrafficViewsDelta30d !== null}
            · Δ {project.githubTrafficViewsDelta30d >= 0
              ? '+'
              : ''}{project.githubTrafficViewsDelta30d}{/if}
        </dd>
        <dt>unique visitors / cloners</dt>
        <dd>
          {compactNumber(metrics.githubTrafficUniqueVisitors)} / {compactNumber(
            metrics.githubTrafficUniqueCloners
          )}
        </dd>
        <dt>merged prs 30 / 90d</dt>
        <dd>{metrics.githubMergedPrs30d ?? '—'} / {metrics.githubMergedPrs90d ?? '—'}</dd>
        <dt>external issues 30 / 90d</dt>
        <dd>{metrics.githubExternalIssues30d ?? '—'} / {metrics.githubExternalIssues90d ?? '—'}</dd>
        <dt>owner / external prs</dt>
        <dd>{metrics.githubOwnerPrs ?? '—'} / {metrics.githubExternalPrs ?? '—'}</dd>
        <dt>visibility / archive</dt>
        <dd>
          {metrics.githubVisibility ?? '—'}{#if metrics.githubIsArchived}
            · archived{/if}
        </dd>
        <dt>workflow</dt>
        <dd>{metrics.githubCiState ?? 'unknown'}</dd>
        <dt>last release</dt>
        <dd>
          {metrics.githubLatestReleaseTag ?? '—'}{#if metrics.githubLatestReleaseAt}
            · {relativeAge(metrics.githubLatestReleaseAt)} ago{/if}
        </dd>
        <dt>release downloads</dt>
        <dd>{compactNumber(metrics.githubReleaseDownloads)}</dd>
        <dt>traffic status</dt>
        <dd>
          {metrics.githubTrafficAvailability ?? 'unavailable'}{#if metrics.githubTrafficScannedAt}
            · {relativeAge(metrics.githubTrafficScannedAt)} ago{/if}
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
