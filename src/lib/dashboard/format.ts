export function compactNumber(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

export function relativeAge(value: string | null, now = Date.now()): string {
  if (!value) return 'never';
  const milliseconds = now - Date.parse(value);
  if (!Number.isFinite(milliseconds)) return 'unknown';
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 43_200) return `${Math.round(minutes / 1_440)}d`;
  return `${Math.round(minutes / 43_200)}mo`;
}

export function ageTone(value: string | null, now = Date.now()): string {
  if (!value) return 'cold';
  const days = (now - Date.parse(value)) / 86_400_000;
  if (days < 1) return 'hot';
  if (days < 7) return 'warm';
  if (days < 45) return 'cool';
  return 'cold';
}

export function fullDate(value: string | null): string {
  if (!value) return 'not collected';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toLocaleString();
}

export function oldestAge(value: string | null): string {
  return value ? relativeAge(value) : '—';
}
