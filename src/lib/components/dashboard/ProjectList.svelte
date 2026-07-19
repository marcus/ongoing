<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import ProjectRow from './ProjectRow.svelte';

  let { projects, openId, activeId, ontoggle, onplaceholder } = $props<{
    projects: DashboardProject[];
    openId: string | null;
    activeId: string | null;
    ontoggle: (id: string) => void;
    onplaceholder: (action: string) => void;
  }>();
</script>

<div class="catalog-list" role="list" aria-label="Projects">
  <div class="column-head" aria-hidden="true">
    <span>★</span><span>project</span><span>branch</span><span>commit</span><span>activity</span
    ><span class="number">loc</span><span class="number">td</span><span class="number">github</span
    ><span></span>
  </div>
  {#each projects as project (project.id)}
    <div role="listitem">
      <ProjectRow
        {project}
        open={openId === project.id}
        active={activeId === project.id}
        ontoggle={() => ontoggle(project.id)}
        {onplaceholder}
      />
    </div>
  {/each}
</div>
