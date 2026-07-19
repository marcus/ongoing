<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>ongoing — project attention</title>
</svelte:head>

<header>
  <div class="wordmark">ongoing<span>.</span></div>
  <div class="status"><i></i>{data.status}</div>
</header>

<main>
  <p class="eyebrow">Local project intelligence</p>
  <h1>Choose what deserves your attention next.</h1>
  <p class="lede">
    The application shell is ready. Project discovery, local metrics, and provider enrichment will
    arrive in the next implementation stages.
  </p>
  <div class="empty-state">
    <span>0 projects indexed</span>
    <span>catalog not initialized</span>
  </div>
</main>

<footer>Bun + SvelteKit · loopback only</footer>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    min-height: 57px;
    padding: 12px 20px;
    border-bottom: 1px solid #383026;
  }

  .wordmark {
    color: #f0a63c;
    font-family: Fraunces, Georgia, serif;
    font-size: 26px;
    font-style: italic;
    font-weight: 600;
    letter-spacing: -0.5px;
    line-height: 1;
  }

  .wordmark span {
    color: #e9e1d2;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #9a8d78;
    font-size: 11px;
  }

  .status i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #8fd06a;
    box-shadow: 0 0 6px #8fd06a;
  }

  main {
    width: min(720px, calc(100% - 40px));
    margin: clamp(80px, 18vh, 180px) auto 0;
  }

  .eyebrow {
    margin: 0 0 16px;
    color: #f0a63c;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    max-width: 680px;
    margin: 0;
    color: #e9e1d2;
    font-family: Fraunces, Georgia, serif;
    font-size: clamp(42px, 7vw, 72px);
    font-weight: 400;
    letter-spacing: -0.04em;
    line-height: 0.98;
  }

  .lede {
    max-width: 570px;
    margin: 28px 0 34px;
    color: #9a8d78;
    font-size: 15px;
    line-height: 1.65;
  }

  .empty-state {
    display: flex;
    justify-content: space-between;
    padding: 13px 15px;
    border: 1px solid #26211a;
    border-radius: 3px;
    color: #5f574a;
    background: #161310;
    font-size: 11px;
  }

  footer {
    position: fixed;
    right: 20px;
    bottom: 12px;
    color: #5f574a;
    font-family: Fraunces, Georgia, serif;
    font-size: 11px;
    font-style: italic;
  }

  @media (max-width: 520px) {
    .empty-state {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }
  }
</style>
