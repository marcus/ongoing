<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import { compactNumber } from '$lib/dashboard/format';

  let { projects } = $props<{ projects: DashboardProject[] }>();
  let stats = $derived.by((): [string, string][] => {
    const source: DashboardProject[] = projects;
    return [
      [String(source.length), 'repos tracked'],
      [
        compactNumber(source.reduce((sum, project) => sum + (project.metrics?.locCode ?? 0), 0)),
        'lines of code'
      ],
      [
        String(source.reduce((sum, project) => sum + (project.metrics?.commits7d ?? 0), 0)),
        'commits this week'
      ],
      [
        String(source.filter((project) => (project.metrics?.dirtyFiles ?? 0) > 0).length),
        'dirty worktrees'
      ],
      [
        String(
          source.reduce((sum, project) => sum + (project.metrics?.tdTotalNonClosedCount ?? 0), 0)
        ),
        'open td issues'
      ],
      [
        compactNumber(
          source.reduce((sum, project) => sum + (project.metrics?.githubStars ?? 0), 0)
        ),
        'github stars'
      ],
      [
        `+${source.reduce((sum, project) => sum + Math.max(0, project.githubStarsGained30d ?? 0), 0)}`,
        '★ gained 30d'
      ],
      [
        compactNumber(
          source.reduce((sum, project) => sum + (project.metrics?.githubTrafficViews ?? 0), 0)
        ),
        'github views'
      ],
      [
        `+${source.reduce((sum, project) => sum + Math.max(0, project.githubTrafficClonesDelta30d ?? 0), 0)}`,
        'clones gained 30d'
      ]
    ];
  });
</script>

<section class="ticker" aria-label="Catalog summary">
  {#each stats as stat (stat[1])}<div><strong>{stat[0]}</strong>{stat[1]}</div>{/each}
</section>
