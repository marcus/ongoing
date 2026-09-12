<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <meta
    name="description"
    content="A private software inventory: what exists, what it is built with, and what deserves attention."
  />
  <meta name="theme-color" content="#17161c" />
</svelte:head>

{@render children()}
