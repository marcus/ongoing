<script lang="ts">
  import { page } from '$app/state';
  import EntryPage from '$lib/ui/EntryPage.svelte';
</script>

<EntryPage kind="project" slug={page.params.slug ?? ''} />
