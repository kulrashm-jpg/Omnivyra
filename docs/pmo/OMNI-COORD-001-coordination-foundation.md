# OMNI-COORD-001 — Coordination Intelligence Foundation (Zone A2)

**Workstream:** WS-2 (Intelligence & Egress) · **Owner:** Agent 2 · **Governs under:** OMNIVYRA-PMO-001.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** FOUNDATION COMPLETE — inert, flag-gated, additive. **Date:** 2026-07-20.

> A shared coordination layer that lets every specialized intelligence share knowledge while
> remaining independent. It generates **no content**; it coordinates. It couples to **no module**.

---

## 1. What was built

A new, self-contained **Coordination Intelligence Layer** under Zone A2, at
`backend/services/intelligence/coordination/`. It records communication **intents** across all
intelligences and answers *"has this company already communicated this intent?"* — **semantically,
not by wording**.

### Files added (all new; zero edits to existing files)

| File | Role |
|---|---|
| `coordination/coordinationContracts.ts` | Canonical types + service interfaces (the reusable contract) |
| `coordination/coordinationKeys.ts` | Deterministic `semanticRootId` derivation + topic normalization |
| `coordination/semanticIntentComparator.ts` | Comparator port impls — consumes the frozen embedding seam |
| `coordination/duplicateIntentDetector.ts` | Pure semantic duplicate-**intent** evaluation |
| `coordination/communicationRegistry.ts` | The canonical `CommunicationRegistry` service + factories + default singleton |
| `coordination/coordinationFlags.ts` | Default-OFF feature flags |
| `coordination/coordinationObservability.ts` | `ai.coordination.*` fail-safe metrics |
| `coordination/stores/inMemoryCoordinationStore.ts` | Inert default store (foundation state) |
| `coordination/stores/supabaseCoordinationStore.ts` | Opt-in durable store (persistence flag ON) |
| `coordination/index.ts` | Public barrel — consumers import only from here |
| `supabase/migrations/20260720120000_communication_coordination_registry.sql` | Net-new additive table |
| `backend/tests/unit/coordinationFoundation.test.ts` | 12 tests (all pass) |

---

## 2. Coordination architecture

```
   Writer   Campaigns   Creator   Engagement   Analytics   MarketPulse   ← future consumers
      └──────────┴──────────┴──────────┴───────────┴────────────┘
                              │  depend ONLY on the interface
                              ▼
                 CommunicationRegistry (interface)
                              │
              ┌───────────────┼───────────────────┐
              ▼               ▼                    ▼
     CoordinationStore   SemanticIntent      duplicateIntentDetector
        (port)            Comparator (port)     (pure evaluation)
        │  in-memory │ supabase        │  embeddingSeam │ inert
        ▼                              ▼
   communication_registry        signalEmbeddingService  ← FROZEN platform seam (consume-only)
       (additive table)          (generateTopicEmbedding / cosineSimilarity)
```

- **Ports, not couplings.** The registry depends on two injected ports — `CoordinationStore` and
  `SemanticIntentComparator` — so persistence backends and embedding backends swap without touching
  the registry or any consumer.
- **Module-agnostic.** The layer imports nothing from Writer / Generation Runtime / Brand / Prompt
  Assembly. Its DTOs are its own. No consumer couples to another consumer.
- **Consumes frozen seams.** Embedding + cosine come from `signalEmbeddingService` (Zone P). No new
  embedding or vector infrastructure was introduced.

---

## 3. Semantic registry

`CommunicationRecord` — the shared coordination row — tracks exactly the requested dimensions:

| Field | Meaning |
|---|---|
| `semanticRootId` | Stable grouping id for one intent seed (producer-supplied or derived) |
| `communicationIntent` | `announce · educate · promote · engage · nurture · reply · report · recruit · advocate · other` |
| `campaignId` | Campaign awareness |
| `platform` | Cross-platform awareness |
| `audience` | Audience awareness |
| `publicationStatus` | Communication-intent lifecycle: `planned → generated → scheduled → published → suppressed → retired` |
| `embedding` | **Semantic embedding reference** (`SemanticEmbeddingRef` — inline jsonb vector or external `ref`) |
| `performanceRef` | **Performance reference** (soft ref, no FK) |
| `contentRef` | Soft ref to produced content (no FK) |
| `sourceModule` | Which intelligence owns it |
| `topic` | The semantic seed (subject) — never the produced wording |

Backed by the net-new additive `public.communication_registry` table (jsonb embedding, no pgvector —
mirrors `content_memory`), tenant-scoped RLS via `user_company_roles`.

**No duplicate storage:** the registry owns a **port**, not a table. Content wording stays in A1's
`content_memory`; market signals stay in `intelligence_signals`; this table holds only communication
*intents* — a concern no existing table covers. Refs to content/performance are soft (no FKs).

---

## 4. Duplicate detection design

**Intent, not text.** The detector never compares wording. It decides in two honest tiers:

1. **`root_id` (deterministic).** A prior communication shares the candidate's `semanticRootId`
   (same intent seed by construction) → `duplicate_intent`.
2. **`embedding` (semantic).** Cosine over topic-seed embeddings, thresholded:
   `≥ 0.90 → duplicate_intent`, `≥ 0.78 → related`, else `unique`.

**Never fabricates uniqueness.** If the candidate carries no embedding and shares no root, yet priors
exist, the verdict is **`not_evaluable`** (basis `none`, `maxSimilarity: null`) — the layer refuses to
claim a uniqueness it cannot substantiate, and there is no text fallback. With zero priors it is
trivially `unique`. Every verdict carries its `basis` as provenance.

---

## 5. Shared interfaces

Consumers depend only on these (all in `coordinationContracts.ts`, re-exported via the barrel):

- `CommunicationRegistry` — `register` · `lookup` · `checkDuplicateIntent` · `markStatus`
- `CoordinationStore` — storage port (`insert` · `findByRoot` · `query` · `markStatus`)
- `SemanticIntentComparator` — embedding port (`embed` · `similarity`)
- DTOs: `CommunicationRecord`, `RegisterCommunicationInput`, `CoordinationQuery`,
  `DuplicateIntentVerdict`, `SemanticEmbeddingRef`, `CoordinationRef`, `CoordinationResult<T>`

Adoption is one call, no wiring:
```ts
import { communicationRegistry } from '@/backend/services/intelligence/coordination';
const v = await communicationRegistry.checkDuplicateIntent({ companyId, communicationIntent: 'promote', topic });
if (v.ok && v.value.decision === 'duplicate_intent') { /* coordinate: skip / vary / defer */ }
```

---

## 6. Backward compatibility

- **Zero edits to existing files.** Purely additive; nothing imports the layer yet.
- **Inert by default.** Flags default OFF (`COORDINATION_REGISTRY_ENABLED`,
  `COORDINATION_REGISTRY_PERSIST_ENABLED`, `COORDINATION_SEMANTIC_EMBEDDING_ENABLED`). Default store
  is in-memory; embedding seam is not called; no DB dependency.
- **Fail-safe.** Missing tenant → typed `TENANT_REQUIRED`; any store/seam failure → typed error +
  `ai.coordination.degrade`; never throws into a consumer.
- **Migration is additive + reversible** (`DROP TABLE`), applied manually per repo discipline. It is
  intentionally **not** added to `verify-schema-parity.js` `REQUIRED_COLUMNS`, so the parity gate is
  not tripped before the table is applied in an environment.

---

## 7. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Overlap with A1 Originality Engine | Low | Different altitude (intent vs wording), different store; no import of A1 |
| Name collision with existing `*CoordinationService` (worker/scheduler) | Low | Distinct dir + purpose-named symbols (`communicationRegistry`) |
| Embedding cost when the semantic flag is enabled | Low | Flag-gated, `system: true` attribution, batch-capable seam, fail-open |
| Registry could later be re-homed onto PIP `SignalService` | — | Deliberately port-based; a future ICR can inject a PIP-backed store |

---

## 8. Outstanding questions

1. **PIP `SignalService` re-homing** — the PIP foundation (`backend/platform/intelligence`, Zone P)
   already models `Signal { dedupKey, provenance, confidence }`. Long-term, the coordination store
   could be a PIP-backed adapter. That touches a **frozen** seam → **ICR-gated**, deferred.
2. **Semantic thresholds (0.90 / 0.78)** are chosen to parallel the Originality embedding floor
   (0.92) but slightly looser for *intent*. Should be calibrated against real embeddings during the
   first consumer adoption (shadow mode).
3. **Consumer adoption order** — recommend Engagement first (it has *no* dedup today), then BOLT/
   scheduled content, then Campaigns.

---

## 9. Certification checklist

- [x] Canonical coordination interfaces (`CommunicationRegistry` + ports)
- [x] Semantic registry (`CommunicationRecord` + additive table)
- [x] Communication-intent tracking (intent taxonomy + lifecycle)
- [x] Duplicate-intent detection foundation (root + embedding tiers; never fabricates)
- [x] No dependency on Writer implementation (module-agnostic; zero A1 imports)
- [x] Reusable across all intelligence modules (single-call adoption via barrel)
- [x] Consumes existing platform capabilities (embedding seam, observability); no duplicate storage
- [x] Additive; flags dark; fail-safe; tenant-isolated
- [x] Tests green (12/12)
- [x] Baseline typecheck green — `tsc -p tsconfig.backend.json` shows **0 errors in coordination files**; the only backend error is pre-existing debt in `pages/api/company-profile/index.ts` (untouched)

---

## 10. Recommended next prompt

**OMNI-COORD-002 — First Consumer Adoption (Engagement, shadow).** Wire the engagement reply path
(`engagementAiAssistantService` / `responseGenerationService`) to call
`communicationRegistry.checkDuplicateIntent` in **shadow** (log-only, flags dark), producing a
coverage/collision diff before any suppression — the first proof the coordination layer changes
outcomes, with zero behavior change until measured. Still Zone A2; no Writer/P/F edits.
