<script lang="ts">
  let {
    seven = null,
    thirty = null,
    ninety = null,
    width = 84,
    height = 16
  } = $props<{
    seven?: number | null;
    thirty?: number | null;
    ninety?: number | null;
    width?: number;
    height?: number;
  }>();
  let values = $derived([
    Math.max(0, (ninety ?? 0) - (thirty ?? 0)),
    Math.max(0, (thirty ?? 0) - (seven ?? 0)),
    seven ?? 0
  ]);
  let maximum = $derived(Math.max(...values, 1));
  let label = $derived(
    `${seven ?? 0} commits in 7 days, ${thirty ?? 0} in 30 days, ${ninety ?? 0} in 90 days`
  );
</script>

<svg {width} {height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
  {#each values as value, index (index)}
    {@const barWidth = width / values.length - 2}
    {@const barHeight = value === 0 ? 1.5 : Math.max(2, (value / maximum) * height)}
    <rect
      x={index * (width / values.length)}
      y={height - barHeight}
      width={barWidth}
      height={barHeight}
      rx="1"
      class:empty={value === 0}
    />
  {/each}
</svg>
