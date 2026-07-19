# Registry Explorer Guide

Read-only exploration of the governance registries. The authoritative catalog is derived from `MANIFEST.json` (every runtime that maintains a registry: census, evidence, version-graph, constitutional, active-constitution, execution, admission, supervision, closure). Where a registry is materialized as an immutable file, its records are shown; otherwise the catalog entry shows the declared registry with zero materialized records.

## Capabilities

- **Filter / search** — type in the search box to filter rows across all columns (case-insensitive substring).
- **Pagination** — 12 rows per page with ‹ / › controls and a row count.
- **Export** — "⬇ export JSON" downloads the full (unfiltered) row set as JSON.

## Columns

`registry` · `runtime` (WP id) · `module` · `materializedRecords`.

## Guarantees

Registries are **immutable and additive** (per the runtime design: active/historical views are derived, never mutated). The explorer is strictly read-only — there is no edit, delete, or add control. It reads published catalog + any materialized registry files only.
