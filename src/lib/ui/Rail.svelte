<script lang="ts">
  import Icon from './Icon.svelte';
  import type { RailSection } from './rail';

  /** The left rail: kinds, attention views, saved views, and the two opinionated screens. */
  let { sections, footer }: { sections: RailSection[]; footer?: import('svelte').Snippet } =
    $props();
</script>

<nav class="rail" aria-label="Inventory navigation">
  <a class="wordmark" href="/" aria-label="ongoing home">ongoing<span>.</span></a>
  {#each sections as section (section.title)}
    <section>
      <h2>{section.title}</h2>
      <ul>
        {#each section.items as item (item.href + item.label)}
          <li>
            <a
              href={item.href}
              class="item"
              data-active={item.active === true}
              aria-current={item.active ? 'page' : undefined}
            >
              {#if item.icon}<Icon name={item.icon} size={13} />{/if}
              <span class="label">{item.label}</span>
              {#if item.count !== undefined && item.count !== null}
                <span class="count u-mono">{item.count}</span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
  {#if footer}<div class="footer">{@render footer()}</div>{/if}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: var(--rail-width);
    padding: var(--space-3) 0 var(--space-3) 0;
    overflow-y: auto;
    background: var(--bg-inset);
    border-right: 1px solid var(--border-strong);
  }

  .wordmark {
    padding: 0 var(--space-3);
    color: var(--text-primary);
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: -0.02em;
  }

  .wordmark span {
    color: var(--accent);
  }

  h2 {
    margin: 0 0 var(--space-1);
    padding: 0 var(--space-3);
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .item[data-active='true'] {
    background: var(--bg-selected);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
  }

  .item[data-active='true']::before {
    content: '';
    position: absolute;
    inset-block: 4px;
    left: 0;
    width: 2px;
    background: var(--accent);
  }

  @media (max-width: 640px) {
    .rail {
      flex: none;
      flex-direction: row;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      padding: var(--space-2);
      overflow-x: auto;
      overflow-y: hidden;
      border-right: 0;
      border-bottom: 1px solid var(--border-strong);
    }

    .wordmark {
      padding: 0 var(--space-1);
    }
    section {
      flex: none;
    }
    section h2 {
      display: none;
    }
    section ul {
      display: flex;
    }
    .item {
      padding: var(--space-1) var(--space-2);
    }
    .item .count {
      display: none;
    }
    .footer {
      flex: none;
      margin: 0;
      padding: 0;
      border: 0;
    }
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }

  .footer {
    margin-top: auto;
    padding: var(--space-2) var(--space-3) 0;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-tertiary);
    font-size: var(--text-2xs);
  }
</style>
