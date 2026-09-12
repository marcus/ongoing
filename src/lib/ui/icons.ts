/**
 * Icon glyphs taken from roc (`dist/svg/outline`), the house icon set.
 *
 * roc is not published to a registry, so the glyphs this UI uses are vendored here as their inner
 * SVG markup rather than pulled in as a dependency: that keeps Ongoing installable by a stranger
 * (Phase 6) and keeps 400-odd unused icons out of the bundle. Every glyph is the 24x24 outline
 * style and strokes `currentColor`. To add one, copy the inner markup of the matching file in roc.
 */
export const icons = {
  activity:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2 12h4l2-8 4 16 2-12 2 4h6"/>',
  'alert-triangle':
    '<path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M12 9.5v4"/><circle cx="12" cy="16.5" r=".75" fill="currentColor"/>',
  check:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m4.5 12.75 6 6 9-13.5"/>',
  'chevron-down':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m6 9 6 6 6-6"/>',
  'chevron-right':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m9 5 7 7-7 7"/>',
  'chevron-up':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m6 15 6-6 6 6"/>',
  clock:
    '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.5v6l4 2.5"/>',
  code: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m8 18-6-6 6-6M16 6l6 6-6 6"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m14.5 4-5 16"/>',
  columns:
    '<rect width="8" height="18" x="3" y="3" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/><rect width="8" height="18" x="13" y="3" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/>',
  database:
    '<ellipse cx="12" cy="5.5" stroke="currentColor" stroke-width="1.5" rx="7" ry="2.5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 5.5v13c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-13"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 11c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5"/>',
  'external-link':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 13.5v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h5M15 3h6v6M10 14 21 3"/>',
  eye: '<path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M2.5 12C4.3 7.5 7.8 5 12 5s7.7 2.5 9.5 7c-1.8 4.5-5.3 7-9.5 7s-7.7-2.5-9.5-7Z"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>',
  'eye-off':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.73 5.08A11 11 0 0 1 12 5c4.97 0 8.5 4.5 9.5 7a12.5 12.5 0 0 1-2.12 3.27M6.61 6.61C4.62 7.96 3.18 9.93 2.5 12c1 2.5 4.53 7 9.5 7a9.74 9.74 0 0 0 5.39-1.61"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m2 2 20 20"/>',
  filter:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 4.5h18l-6.75 8.25v6.75l-4.5 2.25V13.5z"/>',
  folder:
    '<path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M3 6a1 1 0 0 1 1-1h5.59a1 1 0 0 1 .7.29L12 7h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  'git-branch':
    '<circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="9" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M12 7v10"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 13c0-2.21 1.79-4 4-4"/>',
  github:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.47.09.64-.2.64-.46v-1.6c-2.63.57-3.18-1.27-3.18-1.27a2.5 2.5 0 0 0-1.05-1.38c-.86-.59.06-.58.06-.58a1.98 1.98 0 0 1 1.45.97 2.01 2.01 0 0 0 2.75.78 2.02 2.02 0 0 1 .6-1.26c-2.1-.24-4.31-1.05-4.31-4.68A3.67 3.67 0 0 1 6.93 9a3.4 3.4 0 0 1 .09-2.5s.8-.26 2.61.97a9 9 0 0 1 4.74 0c1.81-1.23 2.61-.97 2.61-.97a3.4 3.4 0 0 1 .09 2.5 3.67 3.67 0 0 1 .97 2.54c0 3.64-2.21 4.44-4.32 4.67a2.26 2.26 0 0 1 .64 1.75v2.6c0 .26.17.56.65.46A9.5 9.5 0 0 0 12 2.5"/>',
  home: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.5 10.25v9.25a1 1 0 0 0 1 1H9v-5.25a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.25h4.5a1 1 0 0 0 1-1v-9.25a1 1 0 0 0-.36-.77L12.39 3.1a.6.6 0 0 0-.78 0L3.86 9.48a1 1 0 0 0-.36.77"/>',
  list: '<circle cx="4" cy="6" r="1.25" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M9 6h12"/><circle cx="4" cy="12" r="1.25" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M9 12h12"/><circle cx="4" cy="18" r="1.25" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M9 18h12"/>',
  orbit:
    '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><ellipse cx="12" cy="12" stroke="currentColor" stroke-width="1.5" rx="10" ry="4.5" transform="rotate(-30 12 12)"/><circle cx="19.5" cy="7.67" r="1.75" stroke="currentColor" stroke-width="1.5"/>',
  package:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.5 9.4 7.55 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  pencil:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.47 3.53a2.5 2.5 0 0 1 3.54 0l.46.46a2.5 2.5 0 0 1 0 3.54L8.03 19.97l-4.5 1.5 1.5-4.5zM14.5 5.5l4 4"/>',
  plug: '<path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M8 2v4m8-4v4"/><rect width="14" height="7" x="5" y="6" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="1"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 13v2.5a2 2 0 0 0 4 0V13"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M12 17.5V22"/>',
  plus: '<path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M12 5v14m-7-7h14"/>',
  refresh:
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 12a8 8 0 0 1-14.93 4M4 12a8 8 0 0 1 14.93-4"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 4v4h-4M4 20v-4h4"/>',
  scan: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  search:
    '<circle cx="11" cy="11" r="6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m15.25 15.25 4.25 4.25"/>',
  sort: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 5v14M8 5 4.5 8.5M8 5l3.5 3.5M16 19V5m0 14-3.5-3.5M16 19l3.5-3.5"/>',
  star: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m12 3 2.24 5.93 6.32.52-4.78 4.24 1.38 6.19L12 16.5l-5.16 3.38 1.38-6.19-4.78-4.24 6.32-.52z"/>',
  tag: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.5 12.78V4.5a2 2 0 0 1 2-2h8.28a2 2 0 0 1 1.41.59l7.22 7.22a2 2 0 0 1 0 2.83l-7.1 7.1a2 2 0 0 1-2.83 0l-8.39-8.05a2 2 0 0 1-.59-1.41Z"/><circle cx="7" cy="7" r="1" stroke="currentColor" stroke-width="1.5"/>',
  target:
    '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r=".75" fill="currentColor"/>',
  terminal:
    '<rect width="19" height="17" x="2.5" y="3.5" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" rx="2"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m6.5 9 3.5 3-3.5 3"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M13 16h4.5"/>',
  trash:
    '<path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M4 6.5h16M9 3.5h6"/><path stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="m5.5 6.5 1 13.5a1 1 0 0 0 1 .5h9a1 1 0 0 0 1-.5l1-13.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M9.5 10.5v6m5-6v6"/>',
  'trending-up':
    '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m3 17 5-5 4 2 9-9"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 5h4v4"/>',
  undo: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 9h11a5 5 0 0 1 0 10h-4"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7.5 5.5 4 9l3.5 3.5"/>',
  users:
    '<circle cx="9" cy="7.5" r="3.5" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1M16 7.13a3.5 3.5 0 0 1 0 6.5m3.5 6.87v-1a5 5 0 0 0-3-4.58"/>',
  x: '<path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 6 6 18M6 6l12 12"/>'
} as const;

export type IconName = keyof typeof icons;
