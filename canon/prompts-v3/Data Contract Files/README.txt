# Reverse Mechanics Contracts (lean, integrity-first)

This folder freezes the minimal shapes for:

- ContextEnvelope (descriptive memory: summaries + last 1–2 runs)
- PromptCard (Option B: stores preselected projection refs)
- Projections (authoritative truth: CODEBASE, INDEX, ISSUES)
- Collectibles (K1/K2 and facets ANCHOR/PROOF/PROGRESS)
- ProjectionPatch ops (declarative CRUD)

## Contract versioning

Persisted top-level artifacts include `contract_version: "v1"` so future schema changes can be migrated safely.

## Drift prevention

- Projection INDEX summaries (`file_summary`, shard `summary`) are required so selectors can query meaningfully without guessing.
- Collectibles bundles are gated by runtime invariants (K1 required + first; max one of each; facet id↔type mapping).
- PromptCard `selected_projection_refs` are persisted in canonical order (dedupe + stable sort).

No external schema libs. Use `assert.ts` to fail fast on drift.
