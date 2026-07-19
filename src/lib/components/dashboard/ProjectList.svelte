<script lang="ts">
  import type { DashboardProject } from '$lib/dashboard/catalog';
  import ProjectRow from './ProjectRow.svelte';

  let {
    projects,
    openId,
    activeId,
    manual = false,
    ontoggle,
    onfavorite,
    onnote,
    onhide,
    onaction,
    onreorder
  } = $props<{
    projects: DashboardProject[];
    openId: string | null;
    activeId: string | null;
    manual?: boolean;
    ontoggle: (id: string) => void;
    onfavorite: (id: string, favorite: boolean) => void;
    onnote: (id: string, note: string) => Promise<void>;
    onhide: (id: string) => void;
    onaction: (id: string, action: 'finder' | 'terminal') => Promise<void>;
    onreorder: (orderedIds: string[]) => void;
  }>();
  let draggedId = $state<string | null>(null);

  function move(id: string, destination: number) {
    const ids = projects.map((project: DashboardProject) => project.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(destination, ids.length)), 0, id);
    onreorder(ids);
  }
  function drop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    move(
      draggedId,
      projects.findIndex((project: DashboardProject) => project.id === targetId)
    );
    draggedId = null;
  }
</script>

<div class="catalog-list" role="list" aria-label="Projects">
  <div class="column-head" aria-hidden="true">
    <span>{manual ? '↕' : '★'}</span><span>project</span><span>branch</span><span>commit</span><span
      >activity</span
    ><span class="number">loc</span><span class="number">td</span><span class="number">github</span
    ><span></span>
  </div>
  {#each projects as project (project.id)}
    <div
      role="listitem"
      ondragover={(event) => {
        if (manual) event.preventDefault();
      }}
      ondrop={() => drop(project.id)}
    >
      <ProjectRow
        {project}
        {manual}
        open={openId === project.id}
        active={activeId === project.id}
        ontoggle={() => ontoggle(project.id)}
        ondragstart={() => (draggedId = project.id)}
        onfavorite={(favorite) => onfavorite(project.id, favorite)}
        onnote={(note) => onnote(project.id, note)}
        onhide={() => onhide(project.id)}
        onaction={(action) => onaction(project.id, action)}
        onmove={(where) => {
          const index = projects.findIndex(
            (candidate: DashboardProject) => candidate.id === project.id
          );
          move(
            project.id,
            where === 'top'
              ? 0
              : where === 'bottom'
                ? projects.length - 1
                : index + (where === 'up' ? -1 : 1)
          );
        }}
      />
    </div>
  {/each}
</div>
