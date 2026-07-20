# WS-2D — Communication Intelligence Query Profiles

**Workstream:** WS-2D (Agent 2, Intelligence & Egress) · **Builds on:** WS-2A/2B/2B-validate/2C.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** COMPLETE — read-side, additive, **uncommitted**. **Date:** 2026-07-20.

> Elevate the low-level Communication Intelligence primitives into canonical, consumer-oriented **Query
> Profiles** so future modules consume one stable interface instead of composing graph queries.

---

## 1. Query Profile architecture

```
Registry → Communication Graph → Communication Intelligence (WS-2C) → Query Profiles (WS-2D)
                                                                        ├─ Timeline
                                                                        ├─ Continuity
                                                                        ├─ Campaign
                                                                        ├─ Semantic
                                                                        ├─ Analytics
                                                                        └─ Audit
```

New module `backend/services/intelligence/coordination/profiles/` (Zone A2):

| File | Role |
|---|---|
| `queryProfileFramework.ts` | `QueryProfile` interface + `executeProfile` (the ONE execution seam) + `must` |
| `profileModels.ts` | Shared DTOs (`CommunicationSummary`, `DistributionBucket`, `ProfileResponse`, …) |
| `{timeline,continuity,campaign,semantic,analytics,audit}Profile.ts` | The six profiles |
| `index.ts` | `communicationQueryProfiles` facade + re-exports |
| `profileObservability.ts` / `profileFlags.ts` | `ai.coordination.queryprofile.*` + surfacing flag |

Profiles are **thin compositions** — each `run` calls the WS-2C intelligence service (and the
centralized `graphNavigation`) and shapes the result. **Zero traversal logic is re-implemented.**

## 2. Shared execution framework (Phases 1 & 8)

One `executeProfile(profile, deps, companyId, req)` seam wraps every profile: tenant guard → time →
`profile.run` → observability → fail-safe `ProfileResponse` envelope (`meta { profileType, companyId,
resultCount, degraded }` + `data`). Graph traversal stays centralized; profiles are lightweight. Each
`run` is independently testable (a function of injected `deps.intel`).

## 3. The six profiles

- **Timeline** — dashboard timeline: chronological communications with lifecycle progression (via the
  shared `deriveLifecycleProgression`), status/platform/campaign/root, and derived-artifact ids (from
  the same fetched window — no extra query).
- **Continuity** — semantic roots, clusters, repeated intents (duplicates), gaps, **orphan
  communications** (records whose root isn't registered), lineage summary, and a deterministic
  **continuity score** (`0.6·published-root ratio + 0.4·(1 − gap-root ratio)`).
- **Campaign** — per-campaign history, reused intents, platform/lifecycle distribution, cross-campaign
  semantic reuse, derived-asset count, publication coverage. **Generic** — `campaignId` is a param; no
  Campaign-module import.
- **Semantic** — root, ancestors/descendants (via `graphNavigation`), cluster, duplicate history,
  related communications, and a **lineage tree** (centralized `lineageTree` helper).
- **Analytics** — frequency (by day), platform/intent/lifecycle distributions, continuity coverage,
  duplicate rate, velocity/week, semantic-reuse rate. DTOs only, no visualization.
- **Audit** — governance diagnostics: missing semantic roots, broken lineage, orphan artifacts,
  non-canonical lifecycle states, duplicate idempotency keys, stale communications, graph anomalies.

## 4. DTO review (Phase 9)

Common shapes extracted to `profileModels.ts` and reused everywhere: `CommunicationSummary`
(Timeline/Semantic/Continuity/Audit), `DistributionBucket` + `distribution()` (Analytics/Campaign),
`LifecycleProgressionView`, and the `ProfileResponse`/`ProfileResponseMeta` envelope. No profile
redefines these. DRY win beyond profiles: the monotonic **`deriveLifecycleProgression`** helper was
extracted to `registration/registrationContracts.ts` and now backs BOTH WS-2C's `getLifecycleHistory`
and the Timeline profile (one implementation, two callers).

## 5. Observability review (Phase 10)

`ai.coordination.queryprofile.{execution, latency_ms, result_count, degrade}` labeled `profile_type` —
a new namespace that does not collide with WS-2A (`…adoption.*`), WS-2B (`…registration.*`), WS-2C
(`…intelligence.*`), or the Shared-Contract `ai.gateway.*`/`ai.grounding.*`.

## 6. Certification checklist

- [x] Query Profiles reuse existing graph/navigation logic — every `run` composes WS-2C + `graphNavigation`
- [x] No duplicated traversal algorithms — `lineageTree` centralized in `graphNavigation`; profiles call it
- [x] Stable consumer-facing DTOs — `ProfileResponse<Data>` + extracted shared models
- [x] Complete observability — `ai.coordination.queryprofile.*` (4 metrics, profile-typed)
- [x] Zero ownership violations — Zone A2 only; no platform/producer/registration change
- [x] Read-side only — no writes anywhere
- [x] Feature-flag safe — `COORDINATION_QUERY_PROFILES_ENABLED` (surfacing); read-only inherently safe
- [x] Baseline TypeScript clean — 0 errors in touched files
- [x] Tests pass — 8 new, **68/68** across 7 coordination suites
- [x] No behavioural change — additive read-side layer; nothing consumes it yet

### ✅ CERTIFIED — canonical read-side Query Profile layer

## 7. Documentation

`docs/pmo/communication-query-profiles.md` — architecture, profile responsibilities, request/response
contracts, intended consumers, and extension guidelines ("never compose graph queries directly if a
profile exists").

## 8. PMO sequencing

Parallelism intact — WS-2D added only Zone A2 read-side profiles + tests + docs; no Platform (P) or
Zone A1 change; producers/registration untouched. Agent 1's WS-1c-* remain independent.

**Next (Agent 2):** WS-2D-consume — point an existing A2 analytics/dashboard read path at
`communicationQueryProfiles` behind `COORDINATION_QUERY_PROFILES_ENABLED` (still read-side, still dark).
Producer adoption (registering real communications) remains the separate, later track.
