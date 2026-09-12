<script lang="ts">
  import { resolve } from '$app/paths';
  import '$lib/ui/tokens.css';
  let { data, form } = $props();
</script>

<svelte:head><title>Sign in · Ongoing</title></svelte:head>

<main class="login">
  <section aria-labelledby="login-title">
    <a class="wordmark" href={resolve('/')}>ongoing<span>.</span></a>
    <h1 id="login-title">Private catalog · trusted LAN</h1>
    <p class="copy">Enter the shared access secret configured on this machine.</p>
    <form method="POST" action={`?returnTo=${encodeURIComponent(data.returnTo)}`}>
      <label for="secret">Access secret</label>
      <input
        id="secret"
        class="input"
        name="secret"
        type="password"
        autocomplete="current-password"
        required
        maxlength="256"
      />
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      <button class="button button-primary" type="submit">Open the inventory</button>
    </form>
  </section>
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: var(--space-6);
  }

  section {
    width: min(100%, 360px);
    padding: var(--space-6);
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
  }

  .wordmark {
    color: var(--text-primary);
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: -0.02em;
  }

  .wordmark span {
    color: var(--accent);
  }

  h1 {
    margin: var(--space-5) 0 var(--space-2);
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .copy {
    margin: 0 0 var(--space-5);
    color: var(--text-secondary);
  }

  form {
    display: grid;
    gap: var(--space-2);
  }

  label {
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .button {
    justify-content: center;
    padding: var(--space-2);
  }

  .error {
    margin: 0;
    color: var(--status-error);
    font-size: var(--text-xs);
  }
</style>
