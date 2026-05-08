# Architecture Enforcement Tiers

## P0
- Runtime dependency cycles.
- Direct DB writes outside repositories in services, domains, queues, jobs, schedulers, auth, and integration execution paths.
- Duplicate orchestration owners.
- Unsafe any propagation.
- Frontend/backend imports.
- Deprecated active routes.
- Variant contamination.

## P1
- Mixed-runtime oversized files.
- Unsafe unknown boundaries without narrowing or schema validation.

## P2
- Type-only cycles.
- Schema bridges.
- Serialization unknowns.
- Isolated oversized files.
