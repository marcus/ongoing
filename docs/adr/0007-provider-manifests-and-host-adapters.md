# ADR 0007: Declare every collector as a provider, and every host assumption as an adapter

## Status

Accepted

## Decision

ADR 0002 put TD and GitHub behind domain-owned interfaces. This extends that to every collector and every environmental assumption, and makes each one declarative.

A **provider** ships a manifest:

```ts
interface ProviderManifest {
  name: string; // 'filesystem' | 'git' | 'loc' | 'td' | 'stack' | 'github' | 'endoflife' | 'tech-signatures' | …
  kinds: EntryKind[]; // what it discovers or enriches
  fields: FieldDefinition[]; // namespaced, read-only, registered on load
  relations?: RelationKindDefinition[];
  requires?: { commands?: string[]; env?: string[]; network?: boolean };
  schedule: 'every-scan' | 'when-changed' | 'daily';
  dependsOn?: string[]; // added when Phase 5 built it; see below
  description: string;
}
```

`dependsOn` was not in the shape this decision first wrote down. It was added when the scanner
started iterating manifests, because "in dependency order" has to be derived from something: the
alternative was the array's own order, which is the hard-coded sequence the manifest exists to
replace. A provider whose dependency cannot run is reported unavailable for that reason rather than
left to fail — `tech-signatures` without `stack` writes nothing instead of deleting every detected
edge. `network` is declared rather than probed: being offline makes a fetch fail and leaves cached
data in place (ADR 0002, ADR 0003), which is not the same as the provider being unavailable.

The scanner iterates the enabled providers rather than running a fixed sequence. A disabled or unavailable provider registers no fields, so rules that read them find nothing and stay inert rather than becoming wrong — the freshness gate the attention views already apply to stale data. `ongoing providers` and `GET /api/providers` report each provider's availability, last run, and contributed fields.

Assumptions that exist today only by convention each become a named adapter with a default: repository discovery (`filesystem`), hosting (`github`), issues (`td`), release baselines (`endoflife`), lines of code (`cloc`), website export (`opentangle`), and the intent and ring vocabularies (enum options in the field registry).

A **host adapter** sits behind `serve`, `scan`, `restart`, `stop`, and `logs`. `launchd` is the first implementation and `foreground` the second. Deployment stops being part of the core: the aerie constants and `scripts/release-*.ts` move to `deploy/aerie/`, which the core never imports, and the core gains `ongoing init`, `ongoing serve --data-dir`, and `ongoing scan` as everything a new install needs.

Configuration is one TOML file, `~/.config/ongoing/config.toml` unless `--config` says otherwise, with a `[providers]` section. Environment variables remain overrides and keep carrying secrets.

## Consequences

Ongoing can run on a machine that is not aerie: no `td`, no `cloc`, no GitHub token, no launchd, and a scan still completes with those providers reported unavailable. That is the precondition for open-sourcing the project without forking it per machine, and it is checkable rather than aspirational, because the manifest states what a provider needs.

Declaring fields in the manifest rather than in code means a provider's contribution is visible before it runs, so the registry, the query grammar, and the UI's column chooser all know about `github.stars` whether or not GitHub answered today. It also means a provider cannot quietly write a field it never declared.

The cost is one more indirection in the scanner and a manifest to keep truthful; a manifest that drifts from what the provider actually writes is a new class of bug, which is why registration is the only way a provider field enters the registry.

Choosing TOML over environment variables is a deliberate break from the current `.env`-only configuration: a list of enabled providers, each with settings, is not something environment variables express without inventing a serialization inside a string.
