<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <meta
    name="description"
    content="A private dashboard for deciding where project attention matters most."
  />
  <meta name="theme-color" content="#0f0d0a" />
</svelte:head>

{@render children()}
