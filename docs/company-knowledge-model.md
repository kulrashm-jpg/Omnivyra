# Company Knowledge Model & Version Lifecycle (CKRE-003)

Company Knowledge is now a first-class immutable domain object. Every knowledge
version is one immutable logical entity — not merely a snapshot of profile
fields. Everything is additive and composes the existing stores
(`company_profiles`, CKRE-001 fingerprints, CKRE-002 versions/history,
ONBOARD-001 provenance, Website Intelligence). No new table, no migration.

All code lives under `backend/services/knowledge/`.

## Canonical Knowledge Model (§1)

`companyKnowledgeModel.ts` organizes the live `company_profiles` row into 14
deterministic domains — `IDENTITY`, `BRAND`, `WEBSITE`, `PRODUCTS`, `SERVICES`,
`AUDIENCE`, `INDUSTRY`, `POSITIONING`, `MARKETING`, `SEO`, `SOCIAL`,
`COMPETITORS`, `COMPANY_INTELLIGENCE`, `METADATA`. `composeKnowledgeDomains(row)`
is pure and **duplicates no stored fields** — each domain projects existing
columns / `report_settings.discovered_metadata`. `domainConfidence` derives a
0–100 confidence per domain from `field_confidence` / `overall_confidence`.

## Knowledge Entity (§2)

`companyKnowledgeEntity.ts` — each version is one immutable (`Object.freeze`)
`KnowledgeEntity` referencing `{ companyId, version, createdAt, createdBy,
refreshReason, refreshPolicy, sourceFingerprints (CKRE-001 ref), provenance
(ONBOARD-001 ref), confidence, dependencies (affected fingerprint types),
lifecycle }`. It does not replace profile storage.

## Version Lifecycle (§3)

`CREATED → VALIDATED → ACTIVE → SUPERSEDED → ROLLED_BACK → ARCHIVED` (plus the
restore edge `SUPERSEDED → ACTIVE` and self-transitions). `canKnowledgeTransition`
/ `assertKnowledgeTransition` make illegal transitions impossible.
`deriveKnowledgeLifecycle(stored, version, currentActive)` derives the effective
state deterministically (explicit ARCHIVED/ROLLED_BACK win; current version =
ACTIVE; else SUPERSEDED) — supports replay.

## Diff Engine (§4)

`knowledgeDiffService.diffKnowledge(prev, next)` — PURE, no AI. Returns
`changedDomains`, `changedFields`, `added`, `removed`, `confidenceChanges`,
`dependencyImpact` (affected fingerprints), `refreshSource`, and `identical`.
Deterministic (sorted outputs); identical inputs → identical diff.

## Snapshot Model (§5)

`knowledgeSnapshotStore.ts` — immutable `{ entity, domains }` snapshots stored
newest-first in `report_settings.knowledge_snapshots`. A new version is
**prepended**, never overwritten in place. Supports current / previous /
historical / comparison / reference reads via the canonical API.

## Retention (§6)

`knowledgeRetention.ts` — configurable (`CKRE_KNOWLEDGE_MAX_VERSIONS` default 10,
`CKRE_KNOWLEDGE_ARCHIVE_DAYS` default 0/off). `applyRetention` is pure and
**never archives or drops the ACTIVE version**. Archived snapshots are returned
for counting (§9), never hard-deleted by the engine.

## Rollback Model (§7)

`companyKnowledgeService.rollbackKnowledge(companyId, targetVersion, reason)` —
deterministic rollback **metadata + validation + history**. Validates the target
exists, is not archived, and differs from the current version; appends a
`RollbackRecord { at, fromVersion, targetVersion, reason, validated }` to
`report_settings.knowledge_rollbacks` (append-only, never overwrites history);
emits `KnowledgeRolledBack`; returns the target snapshot. It does NOT mutate the
live profile — actual field restoration is orchestration (CKRE-004).

## Knowledge Events (§8) & Observability (§9)

`knowledgeEventService.ts` reuses the AUTH-001 envelope/sink/correlation/registry.
Events: `KnowledgeCreated`, `KnowledgeValidated`, `KnowledgeActivated`,
`KnowledgeSuperseded`, `KnowledgeRolledBack`, `KnowledgeArchived`,
`KnowledgeCompared`, `KnowledgeSnapshotCreated`. Metrics (`knowledge.*`):
versions_created / versions_active / versions_archived / rollback_count /
comparison_count / snapshot_count / retention_cleanup.

## Canonical Knowledge API (§10)

`companyKnowledgeService.ts` — the SINGLE service consumers use:
`getCurrentKnowledge`, `getKnowledgeByVersion`, `getKnowledgeHistory`,
`diffKnowledgeVersions`, `getKnowledgeLifecycle`, `captureKnowledgeVersion`,
`rollbackKnowledge`. It composes the model + entity + diff + retention + store +
events + CKRE-001/002 stores — no duplicate API. A version is captured
automatically on each successful refresh (wired into the CKRE-002 orchestrator's
finalize + metadata paths, best-effort).

## Determinism

Model composition, entity building, diff, retention, and lifecycle derivation
are all pure and deterministic (same inputs → same outputs); no timestamps or
random feed any comparison. Snapshots are immutable.

## Future CKRE-004 extension points

- Rollback field-restoration (apply a target snapshot's domains back to the live
  profile) is the orchestration CKRE-004 owns.
- Retention `archiveOlderThanDays` + a cleanup job can move archived snapshots
  to cold storage.
- `getCurrentKnowledge` is the read seam for downstream consumers (planner,
  reports) to depend on Company Knowledge rather than raw profile fields.
