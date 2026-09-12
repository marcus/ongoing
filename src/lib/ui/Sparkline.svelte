<script lang="ts">
  /**
   * A trend, where a trend is what the number means. Bars rather than a line: the series Ongoing
   * has are three or four buckets, and a line through four points implies a resolution that is not
   * there.
   */
  let {
    values,
    labels = [],
    width = 132,
    height = 26,
    label = 'Trend'
  }: {
    values: (number | null | undefined)[];
    labels?: string[];
    width?: number;
    height?: number;
    label?: string;
  } = $props();

  let numbers = $derived(values.map((value) => (typeof value === 'number' ? value : 0)));
  let peak = $derived(Math.max(1, ...numbers));
  let slot = $derived(width / Math.max(1, numbers.length));
</script>

<svg
  class="sparkline"
  {width}
  {height}
  viewBox={`0 0 ${width} ${height}`}
  role="img"
  aria-label={`${label}: ${numbers.join(', ')}`}
>
  {#each numbers as value, index (index)}
    {@const barHeight = Math.max(1, Math.round((value / peak) * (height - 2)))}
    <rect
      x={index * slot + 1}
      y={height - barHeight}
      width={Math.max(2, slot - 3)}
      height={barHeight}
    >
      <title>{labels[index] ?? index}: {value}</title>
    </rect>
  {/each}
</svg>

<style>
  .sparkline {
    display: block;
  }

  rect {
    fill: var(--accent);
    opacity: 0.75;
  }
</style>
