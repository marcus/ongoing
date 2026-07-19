import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ActivityBars from './ActivityBars.svelte';

describe('ActivityBars', () => {
  it('renders a labeled, compact three-period activity graphic', () => {
    const { body } = render(ActivityBars, {
      props: { seven: 3, thirty: 8, ninety: 12, width: 84, height: 16 }
    });
    expect(body).toContain('3 commits in 7 days, 8 in 30 days, 12 in 90 days');
    expect(body.match(/<rect/g)).toHaveLength(3);
  });
});
