<script lang="ts">
  let { visible, total, hidden } = $props<{ visible: number; total: number; hidden: number }>();
</script>

<footer class="keyboard-footer" aria-label="Keyboard shortcuts">
  <span><kbd>j</kbd><kbd>k</kbd>navigate</span>
  <span><kbd>↵</kbd>details</span>
  <span><kbd>s</kbd>star</span>
  <span><kbd>n</kbd>note</span>
  <span><kbd>h</kbd>hide</span>
  <span><kbd>f</kbd>sort &amp; filter</span>
  <span><kbd>/</kbd>search</span>
  <span><kbd>1</kbd>–<kbd>9</kbd>sort</span>
  <span class="footer-note">{visible} shown · {total} projects · {hidden} hidden · aerie.local</span
  >
</footer>
