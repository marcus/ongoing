# ADR 0004: Judge declared toolchains against a cached upstream release baseline

## Status

Accepted

## Decision

Ongoing records the toolchain versions a project _declares_ in its root manifests (`go.mod`, `.nvmrc`, `Cargo.toml`, `.tool-versions`, and the rest of the table in `src/lib/server/collectors/stack.ts`), not the versions installed on the machine. Declarations are the project's own commitment and are stable, inspectable, and diffable; installed versions describe the host, not the repository.

Deciding whether a declaration is out of date requires knowing what upstream still supports. That knowledge comes from a release-baseline provider — endoflife.date today, behind the `ReleaseBaselineProvider` interface — refreshed at most once a day for only the toolchains projects actually declare, and cached in `toolchain_releases`.

The comparison is recomputed on every catalog read rather than persisted. A project's `stacks` are therefore resolved data, which keeps `classifyAttentionViews` a pure function of the project and lets the browser re-run it after an optimistic edit without repository access.

`cyclesBehind` counts only the _supported_ cycles newer than a project's own, so a project on the previous LTS reads as one behind rather than being charged for every short-lived release in between.

## Consequences

A refresh failure never discards cached cycles; it records `availability` on `toolchain_baseline_status` and leaves `toolchain_releases` intact. Baseline failures are catalog-wide rather than any project's fault, so they do not write `collection_errors` and do not fail a scan.

Cached release data older than `ATTENTION_THRESHOLDS.releaseBaselineMaxAgeDays` stops satisfying the Upgrade view's freshness gate. Ongoing then reports nothing rather than asserting that a version is behind when it no longer knows what "current" means — the same rule the other attention views already follow for stale provider data.

Toolchains with no upstream product (`java`, `swift`) are still detected and filterable, but resolve to `unknown` and never produce an upgrade reason.

Swapping the provider means writing one adapter. Neither the catalog schema nor the domain rules name endoflife.date.
