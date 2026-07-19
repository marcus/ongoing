<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <meta
    name="description"
    content="A private dashboard for deciding where project attention matters most."
  />
</svelte:head>

{@render children()}

<style>
  :global(:root) {
    font-family: Archivo, Inter, ui-sans-serif, system-ui, sans-serif;
    font-synthesis: none;
    color: #e9e1d2;
    background: #0f0d0a;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    background: #0f0d0a;
  }

  :global(body) {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    background:
      radial-gradient(1200px 500px at 70% -10%, rgb(240 166 60 / 5%), transparent 60%), #0f0d0a;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }
</style>
