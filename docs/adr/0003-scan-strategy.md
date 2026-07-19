# ADR 0003: Use cache-first, bounded scanning

## Status

Accepted

## Decision

Scanning begins with cheap, bounded filesystem discovery and uses cached enrichment whenever its inputs have not changed. Git metadata, the tracked-working-tree fingerprint, provider freshness, and explicit refresh requests determine which expensive collectors run.

Scans use configured roots and concurrency limits. They do not continuously watch every file. Hidden projects receive discovery checks but skip expensive enrichment. A failed collector retains its last successful result and records a warning instead of failing the full scan.

## Consequences

The dashboard remains responsive across roughly one hundred repositories, repeat scans are cheap, and unavailable tools or providers degrade gracefully.
