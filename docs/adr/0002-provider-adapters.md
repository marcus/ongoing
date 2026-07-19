# ADR 0002: Isolate external providers behind domain adapters

## Status

Accepted

## Decision

TD and GitHub integrations implement application-owned provider interfaces. The core project model consumes normalized issue and hosting metrics rather than TD records, GitHub API responses, or command output.

Provider failures are reported as bounded enrichment failures for an individual project. They must not prevent filesystem discovery or discard the last successful metrics.

## Consequences

Domain logic stays testable without external tools or credentials. Providers can change transport, be replaced, or be unavailable without forcing their data models through the rest of the application.
