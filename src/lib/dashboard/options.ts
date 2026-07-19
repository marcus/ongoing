import type { SortDirection, SortKey } from '$lib/domain/sorting';
import type { FilterKey, GroupKey, ViewKey } from './catalog';

export const sortOptions: { key: SortKey; label: string; defaultDirection: SortDirection }[] = [
  { key: 'latestCommit', label: 'latest commit', defaultDirection: 'desc' },
  { key: 'commits30d', label: 'commits 30d', defaultDirection: 'desc' },
  { key: 'activeDays30d', label: 'active days', defaultDirection: 'desc' },
  { key: 'linesOfCode', label: 'lines of code', defaultDirection: 'desc' },
  { key: 'lifetimeCommits', label: 'lifetime commits', defaultDirection: 'desc' },
  { key: 'openTdIssues', label: 'td open', defaultDirection: 'desc' },
  { key: 'githubStars', label: 'github stars', defaultDirection: 'desc' },
  { key: 'githubStarsGained30d', label: '★ gained 30d', defaultDirection: 'desc' },
  { key: 'githubOpenPrs', label: 'open prs', defaultDirection: 'desc' },
  { key: 'githubOldestExternalPr', label: 'oldest external pr', defaultDirection: 'asc' },
  { key: 'githubTraffic', label: 'github traffic', defaultDirection: 'desc' },
  { key: 'name', label: 'name', defaultDirection: 'asc' },
  { key: 'manual', label: 'manual', defaultDirection: 'asc' }
];

export const viewOptions: { key: ViewKey; label: string; className: string }[] = [
  { key: 'attention', label: 'needs attention', className: 'red' },
  { key: 'rising', label: 'rising', className: 'green' },
  { key: 'quickwin', label: 'quick wins', className: 'accent' },
  { key: 'opportunity', label: 'opportunity', className: 'cyan' },
  { key: 'momentum', label: 'momentum', className: 'green' },
  { key: 'dormant', label: 'dormant', className: 'dim' }
];

export const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'all projects' },
  { key: 'favorites', label: 'favorites' },
  { key: 'warnings', label: 'warnings' },
  { key: 'missing', label: 'missing' },
  { key: 'local', label: 'local only' }
];

export const groupOptions: { key: GroupKey; label: string }[] = [
  { key: 'favorites', label: 'favorites first' },
  { key: 'none', label: 'no grouping' }
];
