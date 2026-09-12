# ADR 0006: Express every list as one query string

## Status

Accepted

## Decision

Filtering, sorting, and column selection are one grammar, parsed and evaluated by pure functions in `src/lib/domain/query.ts`, and shared verbatim by the HTTP API, the CLI, and the browser.

```
filter   := clause (' ' clause)*
clause   := field op value | 'tag:' value | 'view:' attentionView | 'tech:' slug | 'kind:' kind | text
op       := ':' | '!:' | '>' | '>=' | '<' | '<=' | ':~'          (equals-any, not, compare, contains)
value    := token | token ',' token ...                          (comma = any of)
sort     := ['-'] field (',' ['-'] field)*
```

Clauses combine with AND; a comma inside a value is OR. Bare text searches name, slug, path, and note. Every `field` is a key in the registry from ADR 0005, so stored fields, user fields, and provider-projected fields are queryable on the same terms, and an unknown key is an error naming the closest registered key rather than an empty result.

`GET /api/entries?q=&sort=&columns=&saved=` is the single read endpoint. `ongoing list '<query>' --sort … --columns … --saved …` passes the same strings. The browser's filter UI builds the string and puts it in the URL; a saved view is a stored `(query, columns)` pair, which makes it a bookmark rather than a second query language. `ongoing views` and `ongoing stacks` become saved views shipped by default.

The old `view`, `filter`, `stack`, and `search` parameters and their CLI flags map onto clauses and keep working.

## Consequences

A filter is copyable between a shell, a URL, a saved view, and a bug report, and it means the same thing in each. There is no server-side query dialect for the API to translate into, and no client-side filter state the CLI cannot reproduce — which is the parity rule from AGENTS.md applied to reading rather than writing.

Because the parser is pure and shares the registry, the browser can validate and evaluate a query locally: it can re-filter an optimistically edited row without a round trip, and it can show the same error message the CLI shows.

The grammar is deliberately small. There is no OR between clauses, no parentheses, and no nesting; a question that needs them is a saved view or a `jq` pipeline over `--json`, and the absence keeps the parser, its error messages, and the UI that composes it comprehensible. Evaluation runs over the projected read model in memory, which is correct at this catalog's size and will need an index-aware path long before it needs a richer grammar.
