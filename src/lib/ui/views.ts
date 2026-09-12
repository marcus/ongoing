import type { AttentionViewKey } from '$lib/domain/attention';
import type { IconName } from './icons';
import type { BadgeTone } from './tones';

/**
 * Labels and tones for the attention views and the radar rings. Presentation only: the membership
 * rules live in `domain/attention.ts` and the ring vocabulary in `domain/technology.ts`.
 */
export const VIEW_LABELS: Readonly<Record<string, string>> = {
  attention: 'needs attention',
  rising: 'rising',
  quickwin: 'quick wins',
  opportunity: 'opportunity',
  momentum: 'momentum',
  dormant: 'dormant',
  upgrade: 'upgrade'
};

const VIEW_TONES: Readonly<Record<string, BadgeTone>> = {
  attention: 'error',
  rising: 'ok',
  quickwin: 'accent',
  opportunity: 'info',
  momentum: 'ok',
  dormant: 'neutral',
  upgrade: 'warn'
};

export function attentionTone(view: AttentionViewKey | string): BadgeTone {
  return VIEW_TONES[view] ?? 'neutral';
}

export const RING_LABELS: Readonly<Record<string, string>> = {
  hot: 'hot — the default choice',
  warm: 'warm — fine where it already is',
  cool: 'cool — not for new work',
  out: 'out — move off it'
};

export function ringTone(ring: string | null | undefined): BadgeTone {
  if (ring === 'hot') return 'ok';
  if (ring === 'warm') return 'info';
  if (ring === 'cool') return 'neutral';
  if (ring === 'out') return 'error';
  return 'neutral';
}

/** An icon for a saved view, chosen by name so the rail reads at a glance. */
export function viewIcon(name: string): IconName {
  if (name in VIEW_LABELS) return 'target';
  if (name.startsWith('stack-')) return 'code';
  if (name === 'favorites') return 'star';
  if (name === 'hidden') return 'eye-off';
  if (name === 'missing') return 'alert-triangle';
  if (name === 'warnings') return 'alert-triangle';
  if (name === 'technologies') return 'package';
  return 'list';
}

/**
 * Provider names as a fact sheet says them. The read model projects derived values under pseudo
 * providers (`relations`, `radar`, `attention`, `collector`, `filesystem`) so the query grammar
 * cannot tell them from collected ones; a panel heading should still say which is which — and a
 * panel called "relations" sitting under the Relations section reads like a mistake.
 */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  attention: 'derived · attention',
  collector: 'derived · collector warnings',
  filesystem: 'derived · discovery',
  radar: 'derived · radar',
  relations: 'derived · relation roll-ups',
  stack: 'stack (toolchains)'
};

export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}
