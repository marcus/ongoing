# ADR 0008: Replace the dashboard stylesheet with a token-based, keyboard-first design system

## Status

Accepted

## Decision

The `dashboard.css` monolith and the mockup-derived layout are replaced rather than restyled. The new frontend starts from the `linear-design-patterns` reference and drifts into a house style on purpose, with the drift written down in `DESIGN.md` as it happens.

The system is:

- **Tokens, not per-component values.** Dark-first LCH colour tokens, Inter, a 4px spacing grid, 1px borders, one type scale. No absolute `font-size` declared per component, which is what makes the current stylesheet impossible to adjust as a whole.
- **Components in `src/lib/ui/`** — Table, a cell editor per field type, Palette, Panel, Rail, Badge, Sparkline — driven by the field registry, so a newly registered field renders and edits without a new component.
- **Quiet surfaces.** No nested containers, no shadows on data, colour reserved for status and accent, `roc` icons.
- **Keyboard first.** `j`/`k` to move, `/` to filter, `,` to sort, `c` to choose columns, `Enter` for the detail panel, `Cmd+K` for a palette that jumps to any entry and runs commands against it, `g p` / `g t` / `g r` to navigate.
- **Optimistic edits with undo**, re-running the pure domain rules locally, as the drawer already does for attention classification.

Screens are opinionated per kind — inventory, entry page, radar, providers — rather than one configurable list-of-cards. The drawer's "reason with its input, comparison, and threshold" display is the strongest thing in the current UI and carries over unchanged into the entry page.

Removed: the catalog ticker, the header flyout filter, per-component absolute font sizes, and drag reordering as a primary interaction. `manual_rank` survives as a sort key; reordering moves to the palette and the CLI.

## Consequences

Flexibility lives in the model and the query layer, not in the chrome. This is the explicit refusal of the LeanIX pattern where every screen is the same generic attribute panel: the catalog can grow new kinds and fields without the UI becoming a configuration exercise.

Because components read the registry, a field added by `ongoing field add` is immediately visible, sortable, and editable in the browser with no frontend change. That is the same parity rule the API already enforces, extended to the view layer.

Replacing the stylesheet wholesale invalidates the current Playwright selectors and screenshots, which is accepted as part of Phase 4 rather than absorbed piecemeal. Every browser mutation must have a CLI-equivalent test in that phase, so the redesign cannot quietly introduce a UI-only capability.

Starting from someone else's patterns and drifting is a decision about pace, not taste: it avoids inventing a visual language before there are enough screens to have opinions about, and `DESIGN.md` is the guard that keeps the drift deliberate instead of accidental.
