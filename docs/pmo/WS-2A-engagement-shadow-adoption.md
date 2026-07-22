# WS-2A — Semantic Coordination Adoption: Engagement Shadow Integration

**Workstream:** WS-2A (Agent 2, Intelligence & Egress) · **Builds on:** OMNI-COORD-001/002 + ICR-1.
**Branch:** `feat/intel-egress-coordination-foundation`. **Status:** COMPLETE — shadow, dark, additive, **uncommitted**. **Date:** 2026-07-20.

> Proves the certified Coordination Platform can be consumed by a real product (Engagement) with
> **zero runtime behavior change**. An adoption project, not a reply-generation project.

---

## 1. Integration audit (Phase 1)

Every engagement reply entry point, classified:

| Entry point | Role | Reply gen? | Context retrieval | Conversation state | Moderation | Persistence | Shadow-integrated? |
|---|---|---|---|---|---|---|---|
| `engagementAiAssistantService.generateReplySuggestions(message_id, organization_id, brand_voice?)` | Reply **suggestions** (3 tone paths) | ✅ (OpenAI / Omnivyra / templated fallback) | thread messages, original post, parent comment, profile voice | thread history (context only) | `moderateBeforePersist` per suggestion | caller persists | ✅ `engagement.suggestion` |
| `responseGenerationService.generateResponse(input)` | Single reply from template | ✅ (LLM + strategic-perspective retry) | `getThreadMemory`, reply/strategy intelligence, opportunities, profile | thread memory summary | `moderateBeforePersist` outbound | caller persists | ✅ `engagement.reply` |
| `conversationTriageService.classifyThread(threadId, orgId)` | Inbox **classification** | ❌ (no reply) | thread/messages/signals/opportunities | thread memory | n/a | writes classification | audit-only (no reply → no probe) |

Neither reply path had any duplicate-detection or Semantic-Root awareness before this change.

---

## 2. Entry points integrated

Two live reply generators, each with a **single fire-and-forget line** (plus one import):

- `engagementAiAssistantService.ts` — after `llmInput` is assembled, before generation.
- `responseGenerationService.ts` — after platform rules resolve, before generation.

Both call `observeEngagementSemanticShadow(...)` with `void ...catch(() => {})`. The probe is never
awaited, never feeds the LLM input, never changes the return value, and cannot throw into the caller.
`conversationTriageService` is intentionally untouched (classification, not reply).

---

## 3. Shadow lookup implementation

New module `backend/services/intelligence/coordination/adoption/` (Zone A2):

| File | Role |
|---|---|
| `engagementSemanticShadow.ts` | The coordinator — lookup + duplicate detection + metrics; never throws/persists/blocks |
| `coordinationAdoptionFlags.ts` | `COORDINATION_ADOPTION_MODE` = `off`(default)`/shadow/active` |
| `coordinationAdoptionObservability.ts` | `ai.coordination.adoption.*` fail-safe metrics |

`observeEngagementSemanticShadow(input)`:
1. **Phase 2** — derives the canonical `semanticRootId` (via the ICR-1 platform `deriveSemanticRootId`,
   intent `'reply'`) and looks up the **Semantic Root** (`semanticRootRegistry.get`) + prior
   **communication events / lineage** (`communicationRegistry.lookup`). Non-mutating.
2. **Phase 3** — runs `checkDuplicateIntent()` (semantic, **non-persisting**) — **log only, never blocks**.
3. **Phase 4** — assembles an `EngagementSemanticContext` (semanticRootId, communicationIntent,
   campaignId, platform, rootPresent, priorEventCount, lineageDepth, duplicate verdict) — transported
   for future consumption; **the reply generator ignores it today**.
4. **Phase 5** — records adoption metrics.

Consumes the certified interfaces **exactly as published** (registries, `deriveSemanticRootId`,
`DuplicateIntentVerdict`) — no re-implementation, no platform-contract change.

---

## 4. Duplicate detection observations (Phase 3)

`checkDuplicateIntent` returns one of `duplicate_intent · related · unique · not_evaluable`, recorded
per surface. Expected shadow distribution **in the current foundation state**:

- **`unique`** dominant and **`registry_hit` ≈ 0 / `missing_root` ≈ 100%** — because no producer
  (Writer/Campaigns) has populated the registry yet, and persistence is dark (in-memory store). This
  is the correct, honest adoption finding: transport works; the registry is simply not yet populated.
- **`duplicate_intent` (basis `root_id`)** and **`related`/`duplicate_intent` (basis `embedding`)**
  appear only once producers register communications for the same tenant/seed (or within a process
  where a prior event was registered — proven by the test suite).

No fabrication: absent embeddings/priors degrade to `unique` (trivially) or `not_evaluable`, never a
manufactured match.

---

## 5. Metrics added (Phase 5) — platform-adoption only, no business metrics

| Metric | Type | Meaning |
|---|---|---|
| `ai.coordination.adoption.lookup_latency_ms` | histogram | end-to-end shadow probe latency (per surface) |
| `ai.coordination.adoption.duplicate_decision` | counter | decision × basis × surface (duplicate rate) |
| `ai.coordination.adoption.registry_hit` | counter | Semantic Root already registered? (`hit=true/false`) |
| `ai.coordination.adoption.missing_root` | counter | missing-Semantic-Root rate (`missing=true/false`) |
| `ai.coordination.adoption.continuity_coverage` | counter | prior communication events present? (`covered=true/false`) |
| `ai.coordination.adoption.degrade` | counter | shadow probe failed (fail-open) |

New non-colliding namespace (the `ai.gateway.*`/`ai.grounding.*` Shared Contracts are untouched).

---

## 6. Feature flags (Phase 6)

`COORDINATION_ADOPTION_MODE` — completely dark by default:
- **`off`** (default) — the hook is a total no-op (returns before any work).
- **`shadow`** — full lookup + duplicate detection + metrics; **no behavior change** (fire-and-forget).
- **`active`** — reserved; currently behaves identically to `shadow` (still no behavior change), so the
  flag can be staged ahead of any future consuming code.

---

## 7. Performance impact

- **OFF (default): zero.** `getCoordinationAdoptionMode()` returns `off` before any allocation/IO; the
  fire-and-forget promise resolves immediately.
- **SHADOW:** off the critical path — the probe is never awaited, so it adds **0 ms** to reply latency.
  Its own cost (in-memory lookups + a deterministic hash + optional embed, all flag-gated) is measured
  by `lookup_latency_ms`. With embedding disabled (default) and the in-memory store, it is sub-millisecond.
- No new heavy imports on the engagement path (the coordination singleton uses the in-memory store
  unless persistence is separately enabled).

---

## 8. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Fire-and-forget runs after response in serverless (metric loss) | Low | Acceptable for shadow; best-effort telemetry only |
| `organization_id` vs `companyId` tenant mapping | Low | Engagement's org id is the coordination tenant; shadow-only + never persists ⇒ harmless if imperfect |
| Registry empty ⇒ low signal | Expected | The point of shadow: it surfaces the population gap via `missing_root`/`registry_hit` |
| Import pulls coordination singleton into engagement | Low | In-memory by default, no DB, no behavior change; tsc clean |

---

## 9. Certification checklist

- [x] **Zero behavioral change** — fire-and-forget, never awaited/consumed/blocking; replies byte-identical
- [x] **Semantic lookup integrated** — Semantic Root + prior events + lineage (Phase 2)
- [x] **Duplicate detection executed in shadow** — `checkDuplicateIntent`, log-only (Phase 3)
- [x] **Semantic lineage transported** — `EngagementSemanticContext` produced at the pipeline boundary (Phase 4)
- [x] **Observability complete** — 6 `ai.coordination.adoption.*` metrics (Phase 5)
- [x] **No ownership violations** — only Zone A2 files (engagement services + coordination/adoption)
- [x] **Feature-flag safe** — `off`/`shadow`/`active`, dark by default (Phase 6)
- [x] **Consumes certified interfaces as published** — no platform-contract change, no re-implementation
- [x] Tests green — 6 adoption + 27 total coordination; baseline tsc 0 errors in touched files

---

## 10. Recommended next prompt

**WS-2B — Registry Population (producer-side, shadow).** The shadow metrics will show
`missing_root ≈ 100%` until producers register. Next: have the engagement path (and/or a Campaigns
seed) **register** its communication event in shadow (behind the same dark flag, in-memory/opt-in
persist), so `registry_hit` and `continuity_coverage` become non-trivial and duplicate detection has
real priors — still zero behavior change, still Zone A2. Then a shadow-diff review before any
`active` consumption.
