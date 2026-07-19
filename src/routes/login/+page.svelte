<script lang="ts">
  import { resolve } from '$app/paths';
  import '$lib/components/dashboard/dashboard.css';
  let { data, form } = $props();
</script>

<svelte:head><title>Sign in · Ongoing</title></svelte:head>

<main class="login-shell">
  <section class="login-card" aria-labelledby="login-title">
    <a class="wordmark" href={resolve('/')}>on<span>going</span></a>
    <p class="login-kicker">PRIVATE CATALOG · TRUSTED LAN</p>
    <h1 id="login-title">Open your project desk.</h1>
    <p class="login-copy">Enter the shared access secret configured on this machine.</p>
    <form method="POST" action={`?returnTo=${encodeURIComponent(data.returnTo)}`}>
      <label for="secret">Access secret</label>
      <input
        id="secret"
        name="secret"
        type="password"
        autocomplete="current-password"
        required
        maxlength="256"
      />
      {#if form?.error}<p class="login-error" role="alert">{form.error}</p>{/if}
      <button type="submit">Enter dashboard <span aria-hidden="true">→</span></button>
    </form>
  </section>
</main>

<style>
  .login-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .login-card {
    width: min(100%, 420px);
    padding: 34px;
    background: var(--bg-raise);
    border: 1px solid var(--line-strong);
    box-shadow: 0 24px 80px var(--shadow);
  }
  .login-kicker {
    margin: 32px 0 10px;
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
  }
  h1 {
    margin: 0;
    font-family: 'Fraunces Local', Fraunces, Georgia, serif;
    font-size: 34px;
    font-style: italic;
    line-height: 1.05;
  }
  .login-copy {
    margin: 12px 0 28px;
    color: var(--ink-dim);
    font-size: 13px;
    line-height: 1.5;
  }
  form {
    display: grid;
    gap: 9px;
  }
  label {
    color: var(--ink-dim);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  input {
    width: 100%;
    padding: 12px;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  button {
    margin-top: 8px;
    padding: 12px 14px;
    color: var(--bg);
    background: var(--accent);
    border: 0;
    border-radius: 2px;
    cursor: pointer;
    font-weight: 700;
    text-align: left;
  }
  button span {
    float: right;
  }
  .login-error {
    margin: 4px 0 0;
    color: var(--red);
  }
</style>
