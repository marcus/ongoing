<script lang="ts">
  import { onMount } from 'svelte';

  const themes = [
    { key: 'ember', accent: '#f0a63c', background: '#0f0d0a' },
    { key: 'ink', accent: '#6fa8ff', background: '#0f1216' },
    { key: 'paper', accent: '#b0491c', background: '#f5f0e5' },
    { key: 'moss', accent: '#b1d554', background: '#0e120c' },
    { key: 'port', accent: '#ff7a63', background: '#0e1120' }
  ] as const;
  type Theme = (typeof themes)[number]['key'];
  let theme = $state<Theme>('ember');

  function apply(next: Theme) {
    theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ongoing-theme', next);
  }

  onMount(() => {
    const saved = localStorage.getItem('ongoing-theme');
    if (themes.some(({ key }) => key === saved)) apply(saved as Theme);
  });
</script>

<div class="themes" role="group" aria-label="Color theme">
  {#each themes as option (option.key)}
    <button
      class:on={theme === option.key}
      class="swatch"
      type="button"
      aria-label={`${option.key} theme`}
      aria-pressed={theme === option.key}
      onclick={() => apply(option.key)}
    >
      <i style={`--swatch-accent:${option.accent};--swatch-bg:${option.background}`}></i>
    </button>
  {/each}
</div>
