# WS-2B — Canonical Communication Registration

**Workstream:** WS-2B (Agent 2, Intelligence & Egress) · **Builds on:** OMNI-COORD-001/002 + ICR-1 + WS-2A.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** COMPLETE — additive, shadow, flag-gated, **uncommitted**. **Date:** 2026-07-20.

> The registration **pipeline itself** — not Writer, not Campaign integration. Every future producer
> performs exactly ONE operation, `registerCommunication(...)`; everything else is hidden.

---

## 1. Registration architecture

```
  registerCommunication(request)              ← the ONE operation (module-agnostic)
        │
        ├─ normalize intent (platform vocabulary)  ── ICR-1 semanticIdentity
        ├─ derive semanticRootId (deterministic)   ──┘
        ├─ derive idempotencyKey (deterministic)   ── replay safety
        ├─ ensure Semantic Root (optional seed)    → SemanticRootRegistry (idempotent upsert)
        ├─ registry.registerIdempotent(...)        → CoordinationStore.insertIdempotent
        │        └─ row becomes a graph node (lineage fields) + a prior for dedup — automatic
        └─ record observability                    → ai.coordination.registration.*
        ↓
  RegistrationOutcome { record, created, skipped, semanticRootId, idempotencyKey, rootEnsured }
```

The required chain — **Semantic Root → Registration → Registry → Communication Graph → Observability →
Future Duplicate Detection** — is automatic: once a communication is registered, it is a graph node
(via its lineage fields, projected by `buildCommunicationGraph`) and a prior for `checkDuplicateIntent`,
with no extra producer calls.

New module `backend/services/intelligence/coordination/registration/` (Zone A2):

| File | Role |
|---|---|
| `registrationContracts.ts` | `CommunicationLifecycleState`, `RegisterCommunicationRequest`, `RegistrationOutcome`, pipeline interface |
| `registrationKeys.ts` | `deriveIdempotencyKey` (deterministic) |
| `registrationFlags.ts` | `COORDINATION_REGISTRATION_MODE` off/shadow/active |
| `registrationObservability.ts` | `ai.coordination.registration.*` fail-safe metrics |
| `communicationRegistrationPipeline.ts` | the pipeline (`registerCommunication` + `advanceLifecycle`) + singleton |

---

## 2. Lifecycle model

Canonical, monotonic 7-state lifecycle (`COMMUNICATION_LIFECYCLE`):

```
planned → generated → adapted → published → engaged → measured → archived
```

- `registerCommunication` seeds the state (default `planned`).
- `advanceLifecycle(companyId, id, toState)` moves **forward only** (`archived` reachable from
  anywhere); setting the same or an earlier state is an idempotent no-op.
- Persisted via `CommunicationRecord.publicationStatus`, whose union was **widened additively** to a
  superset (the 7 canonical states + the original `scheduled/suppressed/retired`) — every prior value
  stays valid.

---

## 3. Idempotency model (the crux)

**Identity, not payload.** A registration's logical identity is
`(companyId, semanticRootId, artifactType, generationStage, platform, campaignId, audience, contentRef.id)`.
`deriveIdempotencyKey` hashes it to `cidem_<24-hex>`; a caller may override with an explicit key.

Replay safety is enforced at **three levels**, defence-in-depth:
1. **Deterministic key** — a retry/duplicate/replay with the same identity derives the same key.
2. **Store `insertIdempotent`** — in-memory keeps a `(company, key) → record` index; Supabase inserts
   and, on unique-violation, returns the existing row (`created:false`).
3. **DB partial unique index** — `uq_comm_registry_company_idempotency ON (company_id, idempotency_key)
   WHERE idempotency_key IS NOT NULL` makes concurrent double-registration impossible at the storage
   layer (not merely a check-then-insert race). Partial ⇒ legacy null-key rows are unconstrained.

Result: retries, duplicate requests, and replays **never create duplicate registry entries** —
`created:false` signals the collapse. Proven by tests (single + custom key + concurrency-shaped replays).

---

## 4. APIs

The single canonical surface (consumers depend only on the interface):

```ts
communicationRegistrationPipeline.registerCommunication(request): Promise<Result<RegistrationOutcome>>
communicationRegistrationPipeline.advanceLifecycle(companyId, id, toState): Promise<Result<{changed, state}>>
```

`RegisterCommunicationRequest` accepts only canonical metadata — **no module-specific DTO**: Semantic
Root (or its seed), artifact type, parent artifact, derivedFrom, generation stage, platform, campaign,
audience, communication intent, lifecycle state, soft refs, optional embedding, optional idempotency key.

---

## 5. Observability

New non-colliding namespace `ai.coordination.registration.*`:

| Metric | Type | Meaning |
|---|---|---|
| `register` | counter | `created`(idempotent replay=false) × `skipped` × `root_ensured` × source × artifact |
| `latency_ms` | histogram | pipeline latency (writes only) |
| `lifecycle_advance` | counter | `changed` × `to_state` |
| `degrade` | counter | pipeline failed (fail-open) |

The `ai.gateway.*` / `ai.grounding.*` Shared Contracts are untouched.

---

## 6. Feature flags

`COORDINATION_REGISTRATION_MODE` — dark by default:
- **`off`** (default) — derives the semantic root id + idempotency key and returns `skipped:true`
  with **no write** (a call site is adoption-safe before enabling; ids are identical to when enabled).
- **`shadow`** — full pipeline runs (durable persistence still gated by `COORDINATION_REGISTRY_PERSIST_ENABLED`; in-memory otherwise).
- **`active`** — reserved; identical to `shadow` today.

---

## 7. Producers

**Not integrated — by design.** WS-2B exposes the mechanism only. No Writer, Campaign, Creator,
Engagement, Analytics, or MarketPulse call sites were added. Future modules consume
`registerCommunication` behind the dark flag.

---

## 8. Tests

`coordinationRegistrationPipeline.test.ts` — 10 tests: OFF no-op + stable ids; register-once then
replay-collapse (same row); distinct identities → distinct rows; caller-supplied key; tenant required;
Semantic-Root ensure; ids identical OFF vs ON; monotonic `advanceLifecycle` (forward, idempotent, no
backward); canonical lifecycle order; `deriveIdempotencyKey` determinism. **37/37 across all four
coordination suites** (the prior 27 unchanged).

---

## 9. Certification checklist

- [x] Registration architecture — one `registerCommunication`; root→registry→graph→obs→dedup automatic
- [x] Lifecycle model — canonical 7 states, monotonic `advanceLifecycle`
- [x] Idempotency model — deterministic key + store idempotent insert + DB partial unique index
- [x] APIs — single module-agnostic request; no producer DTOs
- [x] Tests — 10 new, 37/37 total; baseline tsc 0 errors in touched files
- [x] Observability — 4 `ai.coordination.registration.*` metrics
- [x] **Producers NOT integrated** — mechanism only
- [x] Additive · shadow · feature-flagged · ownership-safe (Zone A2 only; no platform-contract change)

---

## 10. PMO sequencing

Genuine parallel execution holds — WS-2B touched only Zone A2 (coordination + its stores/contracts +
additive migration), no Platform (P) or Zone A1 files.

| Agent | Workstream | State |
|---|---|---|
| **Agent 2** | WS-2A Engagement shadow | ✅ Certified |
| **Agent 2** | **WS-2B Canonical Registration** | ✅ **This report** |
| Agent 2 | WS-2C Active semantic consumption | Later (after producer population + shadow-diff) |
| Agent 1 | WS-1c-2b (BOLT convergence), WS-1c-3, WS-1c-4 | Independent (Zone A1) |

**Recommended next (Agent 2): WS-2B-adopt (producer population, shadow).** Wire the first producer —
the Engagement path (WS-2A already computes the identity) and/or a Campaigns seed — to call
`registerCommunication` behind the dark flag, so the registry accrues real rows and WS-2A's
`registry_hit`/`continuity_coverage` become non-trivial. Still zero behavior change, still Zone A2.
Then WS-2C (active consumption) after a shadow-diff review.
