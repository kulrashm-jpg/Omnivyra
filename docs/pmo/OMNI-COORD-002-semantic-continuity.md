# OMNI-COORD-002 — Semantic Continuity Engine (Zone A2)

**Workstream:** WS-2 (Intelligence & Egress) · **Owner:** Agent 2 · **Builds on:** OMNI-COORD-001.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** REFINEMENT COMPLETE — contracts + metadata only, inert, additive, **uncommitted**. **Date:** 2026-07-20.

> Extends the Coordination Foundation into the **Semantic Coordination Platform**: one origin
> (Semantic Root) that every marketing artifact derives from, a lineage graph, and continuity/drift
> **contracts** — with **no** content generation, **no** AI evaluation, **no** module integration.

---

## 1. Updated architecture

```
                         Semantic Coordination Platform (facade, inert)
                                          │
   ┌──────────────────┬──────────────────┼────────────────────┬────────────────────┐
   ▼                  ▼                   ▼                    ▼                    ▼
SemanticRoot     Communication      CommunicationGraph   Continuity           Drift
Registry         Registry           (pure projection)    Evaluator (iface)    Evaluator (iface)
(origin)         (intents +         nodes + edges        → NOT_EVALUABLE       → not_evaluable
                 artifacts +        (metadata only)      (inert stub)          (inert stub)
                 lineage)
   │                  │
   └── SemanticRootStore port ── CoordinationStore port  ── consume FROZEN signalEmbeddingService (P)
       in-memory | supabase        in-memory | supabase
```

Everything from OMNI-COORD-001 is unchanged and still canonical. This wave **adds a layer above it**;
it does not redesign it. The one generalization: a `CommunicationRecord` may now optionally carry
lineage metadata, at which point it also acts as an **artifact node** in the graph.

---

## 2. Semantic Root model (Phase 1)

`SemanticRoot` — the **origin of communication**. Not content, not a prompt, not a post.

| Field | Meaning |
|---|---|
| `id` | Stable id (= `deriveSemanticRootId(...)` unless supplied) — what artifacts point at |
| `businessObjective` | The durable business goal |
| `campaignObjective?` | Optional campaign framing |
| `topic` | Subject seed |
| `communicationIntent` | Reuses the COORD-001 intent taxonomy |
| `targetAudience` | Who it addresses |
| `positioning` | Stance / angle / value framing |

Served by `SemanticRootRegistry` (`register` · `get` · `list`), tenant-scoped, fail-safe, inert by
default (in-memory store; Supabase-backed under the persistence flag). Table: `public.semantic_roots`.

---

## 3. Semantic lineage model (Phases 2–3)

Every artifact exposes lineage metadata (all **optional/additive** on `CommunicationRecord`):

| Field | Meaning |
|---|---|
| `semanticRootId` | The origin it ultimately derives from (already present since COORD-001) |
| `parentArtifactId` | Direct predecessor in the chain |
| `artifactType` | `semantic_root · content_brief · post · visual_brief · image · image_text · platform_adaptation · published_asset · engagement · analytics` |
| `derivedFrom` | Multi-source provenance (ids) |
| `generationStage` | `origin · brief · draft · visual · render · adaptation · publication · engagement · measurement` |

This models the requested chain — Semantic Root → Content Brief → Post → Visual Brief → Image →
Image Text → Platform Adaptation → Published Asset → Engagement → Analytics — where **every node knows
its parent, origin, and semantic root**. It is **metadata only**; no Writer/Engagement integration.

---

## 4. Communication graph (Phase 6)

`buildCommunicationGraph(...)` is a **pure, deterministic projection** (no I/O, no persistence, **no
graph database**) over registry metadata. It emits:

- **Nodes** (`GraphNode`): kinds `semantic_root · content · visual · campaign · engagement · analytics`
  (campaign nodes synthesized from `campaignId`).
- **Edges** (`GraphEdge`): `derives_from · belongs_to · adapts · responds_to · measures`, chosen by
  artifact type (adaptation→`adapts`, engagement→`responds_to`, analytics→`measures`, else
  `derives_from`), plus a `belongs_to` edge to the root and multi-source `derives_from` edges.

Edges de-dup on `(from,to,kind)`; ordering is deterministic. It is a view, not a stored graph.

---

## 5. Semantic continuity contracts (Phases 4 & 7)

**Continuity validation (Phase 4)** — *"does this artifact still represent the Semantic Root?"*
- `SemanticContinuityDecision`: `ALIGNED · DRIFTED · CONFLICTING · NOT_EVALUABLE`
- `SemanticContinuityEvaluator` interface + `SemanticContinuityVerdict` (with `basis` provenance).

**Semantic drift (Phase 7)** — origin → final published asset.
- `SemanticDriftEvaluator` interface + `SemanticDriftAssessment` (`severity`, `drift`, `dimensions`).

**No AI is implemented.** The shipped `inertContinuityEvaluator` / `inertDriftEvaluator` always return
`NOT_EVALUABLE` / `not_evaluable` — the interfaces are the deliverable; a future wave injects real
evaluators behind them (the PIP Null-adapter pattern).

---

## 6. Cross-module compatibility (Phase 5)

The model is module-agnostic by construction — it imports nothing from Writer / Generation Runtime /
Brand / Prompt Assembly / any consumer, and defines its own DTOs. All six future consumers derive from
the same origin without new dependencies:

| Module | How it uses the Semantic Root |
|---|---|
| Writer | Reads the root to ground generation; registers `post`/`content_brief` artifacts |
| Campaigns | Owns/registers roots; registers `platform_adaptation` nodes |
| Creator | Registers `visual_brief`/`image`/`image_text` nodes under the same root |
| Engagement | Registers `engagement` nodes (`responds_to`) |
| Analytics | Registers `analytics` nodes (`measures`) |
| MarketPulse | Reads the graph to coordinate; may seed roots from signals |

---

## 7. Backward compatibility

- **Zero behavior change.** All lineage fields are optional; existing COORD-001 records/tests are
  unaffected (21/21 tests pass, incl. the original 9 unchanged).
- **Additive persistence.** New `semantic_roots` table + `ADD COLUMN IF NOT EXISTS` lineage columns.
  The Supabase coordination store adds lineage keys to inserts **only when present**, so even a v1
  table (COORD-001 migration only) still accepts writes.
- **Inert by default.** New flags: none added — reuses `COORDINATION_REGISTRY_PERSIST_ENABLED`.
  In-memory stores + inert evaluators mean the whole layer is side-effect-free until adopted.
- **Fail-safe & tenant-scoped** throughout (typed `TENANT_REQUIRED`/`INTERNAL`, never throws).

---

## 8. Migration impact

| Migration | Effect | Risk |
|---|---|---|
| `20260720123000_semantic_continuity_lineage.sql` | New `semantic_roots` table (RLS) + 4 additive columns + 1 index on `communication_registry` | Low — additive, reversible (`DROP TABLE` / `DROP COLUMN`), no data migration, no FKs |

Applied manually per repo discipline; deliberately **not** added to `verify-schema-parity.js`
`REQUIRED_COLUMNS`, so the deploy gate is not tripped before the tables exist in an environment.

---

## 9. Ownership validation (§17 self-audit)

- **Ownership:** all files in `backend/services/intelligence/coordination/**` (+ its `supabase/migrations`
  additive files, + `docs/pmo/**`) — **Zone A2 only**. Zero edits to A1/P/F/U.
- **No platform modification:** `backend/platform/intelligence`, gateway, grounding, safety, billing,
  context assimilation — **untouched**. Only the frozen `signalEmbeddingService` seam is *consumed*.
- **No duplicate capability:** no second registry/store/embedding engine; ports keep storage single.
- **No cross-WS import:** imports only from within the layer + `ai/safety` (AiError) + `observability`
  + `db/writeOwner` + `signalEmbeddingService` — all consume-only.
- **No coupling to specialized intelligences:** zero imports from Writer/Engagement/etc.

---

## 10. Future integration points

1. **Agent 1 (Generation Spine)** consumes `SemanticRoot` as the grounding origin for `promptAssembler`
   — reads only; registers artifacts via the interface (no coupling either way).
2. **Real continuity/drift evaluators** injected behind the existing interfaces (candidate: embedding
   cosine of artifact-vs-root topic seeds; deterministic first, semantic later).
3. **PIP re-homing:** the `SemanticRootStore` / `CoordinationStore` ports can be backed by a PIP
   `SignalService`/`MemoryService` adapter — **ICR-gated** (Zone P frozen).
4. **Adoption (still shadow):** Engagement first (no dedup today), then BOLT/scheduled, then Campaigns.

---

## 11. Certification checklist

- [x] Canonical **Semantic Root** (`SemanticRoot` + registry + store + table)
- [x] **Semantic lineage** model (`ArtifactType` · `GenerationStage` · `SemanticLineage`; optional on records)
- [x] **Communication graph** contracts + pure projector (nodes/edges; no graph DB)
- [x] **Semantic continuity** contracts (`ALIGNED/DRIFTED/CONFLICTING/NOT_EVALUABLE`) + inert evaluator
- [x] **Semantic drift** contract + inert evaluator (interface only; no AI)
- [x] **Zero behavior changes** (optional fields; 21/21 tests; nothing imports the layer)
- [x] **Zero ownership violations** (Zone A2 only)
- [x] **Zero platform modifications** (PIP/gateway/grounding/safety/billing untouched)
- [x] **Zero coupling** with specialized intelligences (no Writer/Engagement imports)
- [x] Additive migration; flags dark; fail-safe; tenant-isolated
- [x] Baseline typecheck — 0 errors in coordination files (only pre-existing `pages/api/company-profile/index.ts` debt remains, untouched)

### ✅ CERTIFIED — Semantic Coordination Platform foundation

---

## 12. Recommended next prompt

**OMNI-COORD-003 — Deterministic Continuity Evaluator (shadow).** Implement the *first* real
`SemanticContinuityEvaluator` behind the existing interface — deterministic only (intent/audience/
positioning signature + embedding cosine of topic-vs-root), landing in **shadow** (log-only, flags
dark), producing an alignment/drift diff over a sample. No Writer integration; still Zone A2; still no
behavior change until measured. This is the natural bridge before Agent 1 consumes the Semantic Root.
