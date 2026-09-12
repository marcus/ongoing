<script lang="ts">
  import { icons, type IconName } from './icons';

  let {
    name,
    size = 14,
    class: className = ''
  }: { name: IconName; size?: number; class?: string } = $props();
</script>

<svg
  class={className}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  focusable="false"
>
  <!--
    The glyph is a compile-time constant vendored from roc (see `icons.ts`); no value from the
    catalog, a provider, or a URL reaches it, so there is nothing here for an injection to enter.
  -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html icons[name]}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
