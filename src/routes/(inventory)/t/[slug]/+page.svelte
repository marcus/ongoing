<script lang="ts">
  import { page } from '$app/state';
  import { TECHNOLOGY_KIND } from '$lib/domain/technology';
  import EntryPage from '$lib/ui/EntryPage.svelte';
</script>

<EntryPage kind={TECHNOLOGY_KIND} slug={page.params.slug ?? ''} />
