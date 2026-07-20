# OMNIVYRA-PMO-001 — Multi-Agent Engineering Execution Plan

<!-- ────────────────────────────────────────────────────────────────────────
     GOVERNANCE METADATA (PMO-002B canonical standard) — ARCHIVAL ANNOTATION
     Added by PROGRAM-0B (2026-07-20). Document body below is UNCHANGED.
     This annotation records lineage only; it does NOT transition authority.
     ──────────────────────────────────────────────────────────────────────── -->
> | Field | Value |
> |---|---|
> | **Document ID** | PMO-001 |
> | **Title** | Multi-Agent Engineering Execution Plan |
> | **Version** | 1.0 |
> | **Status** | **Active** (Governance Baseline) — remains Active until PMO-003 executes the adoption transaction |
> | **Authority** | Omnivyra AI-platform execution (current, sole) |
> | **Type** | Baseline |
> | **Predecessor** | — |
> | **Successor** | PMO-002 (Draft — Pending Adoption) |
> | **Adoption Date** | 2026-07-20 (governing since) |
> | **Supersession Criteria** | Becomes `Historical` when the PMO-002 adoption transaction completes (PMO-002A §6 triggers) |
> | **Related Amendments** | — |
> | **Last Updated** | 2026-07-20 (archival annotation only) |
>
> *Governance note: this document predates the PMO-002B metadata standard and is grandfathered; the header above is an archival annotation. Its original certification banner and body are preserved verbatim.*

**Authority:** Engineering Program Management Office (PMO) — single architectural authority.
**Status:** ⚠️ CERTIFIED WITH COORDINATION FOLLOW-UP (see §Final Certification).
**Governs:** all *remaining* engineering work, executed by **exactly two concurrent implementation agents**.
**Date:** 2026-07-20. **Branch context:** `feat/writer-wave0-stabilization`.

> This document is the **single source of ownership, contract, and sequencing truth**. Every future
> implementation prompt MUST reference it. It plans and governs; it authorizes **no** production code
> by itself. The PMO does not implement.

---

## Executive Summary

Omnivyra is a large Next.js + Node monorepo (~80 backend service domains under `backend/services/`,
~75 `lib/` domains, `pages/api/**`, `components/**`, standalone `workers/`, Supabase migrations).
Six programs are **complete and canonical** and are **frozen**: Governance Engineering, Migration
Engineering, Product Architecture (**AI-ARCH-000**), Product Audit (**OMNI-AI-001**), Product
Intelligence Specification, and Product Intelligence Platform Foundation (`backend/platform/intelligence/`).

The **remaining engineering work** is exactly the delta between the as-is (OMNI-AI-001) and the
to-be (AI-ARCH-000), enumerated in `docs/ai-architecture/MIGRATION-ARCHITECTURE.md`. Wave 1 (AI
Safety: prompt-safety, moderation, structured-output, gateway hardening) is **complete**. Wave 2
(grounding activation) is **activated-with-exceptions**. Waves 2-completion → 5 remain.

The remaining work partitions along the **one natural, conflict-free fault line** in this codebase:

- **AGENT 1 — Generation Spine (the content WRITE path).** Everything that flows into
  `content/runtime → provider gateway`: GenerationRuntime consolidation, prompt-byte ownership,
  originality tier + coverage, brand-runtime adoption, Writer/BOLT/long-form convergence, and
  consuming the (frozen) grounding decision in the prompt path (closes the Wave-2 exception).
- **AGENT 2 — Intelligence & Egress (the READ / ANALYZE / send path).** Everything on the tiered
  intelligence pipeline and reply/moderation egress: MarketPulse fabrication → tiered pipeline,
  intelligence ingestion connection, authority activation/retirement, Engagement reply-path merge,
  outbound-moderation adoption, analytics narration.

The two agents share **only frozen platform seams** — the Provider Gateway, `ai/safety/*`
primitives, `ai/grounding/*` policy, `contextAssimilationEngine`, `billing/runBilledAiCompletion`,
observability, and `backend/platform/intelligence`. **Neither agent may modify a shared seam's
interface**; both consume. Interface changes require a PMO Interface Change Request (§Interface
Change Policy). Under this partition, no two agents ever own the same file, and no capability can
be implemented twice.

---

## 1. Repository Ownership Map (zones)

Every file resolves to exactly one zone. Zones A1/A2 are the two **active** agents; **P** is the
frozen Platform (PMO/ICR only); **F** is frozen-canonical (no change without a proven defect); **U**
is unassigned/out-of-scope for this program (owned by the human owner via CODEOWNERS, not part of
the remaining AI-platform work).

| Zone | Name | Root paths (representative) | Change policy |
|---|---|---|---|
| **A1** | Generation Spine | `backend/services/content/**`, `backend/services/contentGeneration/**`, `contentGenerationService.ts`, `contentWriter/**`, `boltContentGenerationForSchedule.ts`, `backend/services/longForm/**`, `longFormIntelligence/**`, `lib/blog/**`, `lib/post/**`, `lib/thread/**`, `lib/content/**`, `backend/services/brand/**`, `context/canonicalContentContextResolver.ts`, `unifiedContentGenerationEngine.ts`, `textGenerationOrchestrator*` | OPEN to A1 only |
| **A2** | Intelligence & Egress | `backend/services/marketPulse/**`, `lib/marketPulse/**`, `marketPulseIntelligenceService.ts`, `backend/services/intelligence/**`, `authorityIntelligenceService*`, `backend/services/moderation/**`, `engagementAiAssistantService.ts`, `responseGenerationService.ts`, `conversationTriageService.ts`, analytics-narration paths | OPEN to A2 only |
| **P** | AI Platform (shared seams) | `backend/services/aiGateway*.ts`, `aiGatewayCore.ts`, `aiGatewayProviders*.ts`, `backend/services/ai/safety/**`, `backend/services/ai/grounding/**`, `backend/services/ai/aiExecutionRuntime.ts`, `aiRequestGuard.ts`, `context/contextAssimilationEngine.ts`, `backend/platform/intelligence/**`, `signalEmbeddingService*`, `billing/runBilledAiCompletion*`, `backend/observability/**`, `lib/observability/**` | **FROZEN interface** — consume only; change via ICR |
| **F** | Frozen-canonical | `backend/services/governance/**`, `backend/services/campaignAiOrchestrator/**` + `buildDeterministicWeeks`, `strategicMixCapability/**`, `weeklyAssignmentEngine`, `websiteIntelligence*`, `backend/auth/**`, `backend/security/**`, `supabase/migrations/**` (net-new additive only), `docs/ai-architecture/**`, `docs/ENGINEERING-GOVERNANCE.md` | No change without proven production defect |
| **U** | Out-of-scope this program | all other `pages/api/**`, `components/**`, `lib/**`, billing enforcement, connectors, etc. | Untouched by A1/A2 |

**Rule:** a file's zone is decided by its **root path prefix**, longest-match wins. If an agent
believes it must edit outside its zone, it stops and files a request to the PMO — it does not edit.

---

## 2. Canonical Ownership Registry

The permanent owner-of-record for each component. (Owner = A1 | A2 | P | F.)

| Component / capability | Canonical module | Owner |
|---|---|---|
| Provider Gateway (chat) | `aiGatewayCore.ts` + `aiGatewayProviders*.ts` | **P** |
| Embedding seam | `signalEmbeddingService*` | **P** |
| Grounding policy (floor/freshness) | `ai/grounding/{groundingPolicy,groundingObservability}.ts` | **P** |
| Context assimilation (canonical read/enforce) | `context/contextAssimilationEngine.ts` | **P** |
| Safety primitives | `ai/safety/{aiError,safeParse,promptSafety,outboundModeration,marketProvenance,providerRetryPolicy}.ts` | **P** |
| AI execution/billing lifecycle | `ai/aiExecutionRuntime.ts`, `billing/runBilledAiCompletion*` | **P** |
| Abuse guard | `ai/aiRequestGuard.ts` | **P** |
| Intelligence platform foundation | `backend/platform/intelligence/**` | **P** |
| Observability | `backend/observability/**`, `lib/observability/**` | **P** |
| **Generation Runtime** | `content/runtime/generationRuntime.ts` | **A1** |
| Prompt Assembly (owns the bytes) | `content/runtime/promptAssembler.ts` | **A1** |
| Content primitives | `contentGeneration/blueprintGenerator.ts`, `platformVariantGenerator.ts` | **A1** |
| Originality Engine | `content/originalityGate.ts`, `content/contentMemoryService.ts` | **A1** |
| Brand Runtime | `brand/brandRuntime.ts` | **A1** |
| Content grounding read | `context/canonicalContentContextResolver.ts` | **A1** |
| Writer paths | `lib/post/**`, `lib/thread/**`, `contentWriter/**` | **A1** |
| Long-form engine | `lib/blog/**`, `longForm/**`, `longFormIntelligence/**` | **A1** |
| Scheduled content gen | `boltContentGenerationForSchedule.ts` | **A1** |
| Legacy content gen (to replace/remove) | `unifiedContentGenerationEngine.ts`, `contentGenerationService.ts`, `textGenerationOrchestrator.runTextGeneration` | **A1** |
| MarketPulse tiered pipeline | `marketPulse/**`, `marketPulseIntelligenceService.ts`, `lib/marketPulse/**` | **A2** |
| Intelligence ingestion adapters | `intelligence/adapters/**`, `intelligence/**` | **A2** |
| Authority intelligence | `authorityIntelligenceService*` | **A2** |
| Engagement reply generator | `engagementAiAssistantService.ts`, `responseGenerationService.ts`, `conversationTriageService.ts` | **A2** |
| Moderation service (outbound extension) | `moderation/moderationGateService*` | **A2** |
| Campaign Intelligence (deterministic) | `campaignAiOrchestrator/**`, `buildDeterministicWeeks` | **F** |
| Strategic/Intelligent Mix | `strategicMixCapability/**`, `weeklyAssignmentEngine` | **F** |
| Website Intelligence | `websiteIntelligence*` | **F** |
| Governance runtime | `backend/services/governance/**` | **F** |

---

## 3. Shared Contract Registry

Classification: **Platform-owned** (change via ICR only), **Module-owned** (owning agent), **Shared
Contract** (Platform-owned, multi-consumer), **Forbidden Overlap** (must never be re-implemented).

| Contract | Kind | Classification | Owner |
|---|---|---|---|
| `RequestEnvelope`, `TenantScope`, `Result<T>`, `AiError` (common substrate) | Interface/DTO | **Shared Contract** | P |
| Provider gateway request/response (`prompt+config → completion+usage`) | Interface | **Shared Contract** | P |
| `safeParse` / structured-output schema contract | Interface | **Shared Contract** | P |
| Grounding decision (`GroundingDecision`, floor/freshness result) | DTO | **Shared Contract** | P |
| `marketProvenance` tier labels (deterministic/retrieval/inference/speculation) | Enum/contract | **Shared Contract** | P (A2 primary consumer) |
| Outbound moderation verdict | DTO | **Shared Contract** | P (A2 consumer) |
| Billing operation vocabulary (`HOLD→EXECUTE→CONFIRM`) | Contract | **Shared Contract** | P |
| Observability metric names (`ai.gateway.*`, `ai.grounding.*`) | Metrics | **Shared Contract** | P |
| `content/runtime` intent → content+provenance | Interface | **Module-owned** | A1 |
| Prompt-block registry entries | Registry | **Module-owned** | A1 |
| Originality decision (`decision`, not `isOriginal`) | DTO | **Module-owned** | A1 |
| MarketPulse insight+citation payload | DTO | **Module-owned** | A2 |
| Engagement reply payload | DTO | **Module-owned** | A2 |
| **Any second provider abstraction** (`intelligence/adapters/*` old) | — | **Forbidden Overlap** | must merge onto P, never fork |
| **Any second grounding/originality/context engine** | — | **Forbidden Overlap** | one each, already owned |
| **Semantic identity** (`SemanticRootId` + ID strategy + `CommunicationIntent` vocabulary) | Type/contract | **Shared Contract** (ICR-1; was two divergent defs) | P — A1 produces, A2 consumes |

---

## 4. Platform Capability Registry

| Capability | Owner | Maturity | Status | Roadmap |
|---|---|---|---|---|
| Provider Gateway | P | Mature/hardened (Wave 1d) | Complete | transient-retry off-default; full error normalization deferred |
| Safety Layer (injection + moderation + structured output) | P | Adopted (Wave 1a–1c) | Complete | outbound moderation shadow→enforce (A2 adoption) |
| Grounding Engine | P | Activated (Wave 2) | **Exception** | prompt-path consumption pending (A1); two grounding stacks not unified |
| Generation Runtime | A1 | Built, flag-gated | In progress | consolidate all content paths; enable by default |
| Prompt Assembly | A1 | Canonical, delegates bytes | In progress | own the bytes; retire legacy builders |
| Originality Engine | A1 | Live, embedding tier dead | In progress | activate semantic tier; universal coverage |
| Brand Runtime | A1 | Contract inert on Writer | In progress | full adoption |
| Knowledge/Memory | A1 (content) / A2 (market) | Live | Stable | content_memory + brand_memory (A1); market provenance (A2) |
| Campaign Intelligence | F | Deterministic, canonical | Complete | seed plan call (minor, F) |
| Market Intelligence | A2 | Fabricated flagship | In progress | replace with tiered cited pipeline |
| Analytics Intelligence | A2 | Deterministic + optional narration | Stable | optional narration hardening |
| Engagement AI | A2 | 3 paths, shallow live | In progress | merge to one grounded generator + outbound moderation |
| Observability | P | Strong | Stable | +quality/hallucination signals |
| Billing | P | Under-adopted | Stable | universal coverage (cross-cutting, ICR-tracked) |

**No duplicate capability exists** after execution: each row has exactly one owner; forbidden overlaps
(§3) are structurally prevented by zone ownership.

---

## 5. Platform Freeze Classification

| Subsystem | Classification | Rationale |
|---|---|---|
| Governance / Migration Framework | **FROZEN** | Complete & certified |
| Authentication / Security | **FROZEN** | Certified (PROD-CX-004, HARDEN-005/006/007) |
| Provider Gateway | **FROZEN (interface)** | Hardened Wave 1d; consume only |
| `ai/safety/*`, `ai/grounding/*`, `contextAssimilationEngine` | **FROZEN (interface)** | Platform primitives; ICR only |
| `backend/platform/intelligence` | **FROZEN (interface)** | Product Intelligence Platform Foundation |
| Campaign / Strategic Mix / Intelligent Mix | **FROZEN** | Canonical deterministic |
| Website Intelligence | **FROZEN** | Mature deterministic |
| Billing enforcement | **LIMITED** | Additive adoption only; enforce DEFERRED (credit gates dark) |
| Supabase migrations | **LIMITED** | Net-new additive only; never rewrite existing |
| Generation Spine (A1 zone) | **OPEN** to A1 | Active workstream |
| Intelligence & Egress (A2 zone) | **OPEN** to A2 | Active workstream |

No implementation prompt may violate freeze status.

---

## 6. Duplication Risk Audit

| Risk area | Owner | Likelihood | Impact | Prevention |
|---|---|---|---|---|
| Generation runtime vs legacy generators | A1 | High (3 live forks) | High | A1 owns all; replace→remove under one runtime |
| Provider abstraction fork (`intelligence/adapters`) | A2→P | Med | High | merge onto frozen gateway; forbidden to fork |
| Context/grounding re-implementation | A1 uses P | Med | High | grounding is P-frozen; A1 consumes, never re-derives |
| Originality re-implementation on new paths (BOLT, long-form) | A1 | Med | High | route all through `originalityGate`; coverage mandatory |
| Prompt-byte ownership drift | A1 | Med | Med | promptAssembler owns bytes; legacy builders archived |
| Reply-generator duplication (Engagement A/B/C) | A2 | High | Med | merge to one; remove dead path |
| Market "insight" fabrication re-appearing | A2 uses P | Med | Critical | `marketProvenance` tiers enforced; no fabricated evidence |
| Telemetry/metric-name divergence | both use P | Low | Med | metric names are Shared Contracts (P) |
| Memory/index double-write | A1 | Low | Med | single `contentMemoryService` write seam |

---

## 7. Workstream Architecture

Two workstreams, each independently executable / reviewable / mergeable / certifiable / rollbackable.

- **WS-1 (Agent 1) — Generation Spine Consolidation.** Converge Writer, BOLT, and long-form onto
  the single `generationRuntime`; make `promptAssembler` own the prompt bytes; activate the
  originality semantic tier and close coverage holes; adopt `brandRuntime` fully on the write path;
  **consume the frozen grounding decision in the prompt path** (closes Wave-2 exception). Replace →
  remove legacy generators behind a flag with A/B parity. Every change flag-gated and fall-back-safe.
- **WS-2 (Agent 2) — Intelligence & Egress.** Replace MarketPulse LLM fabrication with the tiered
  (deterministic / retrieval-backed / labeled-inference) pipeline wired to real ingestion; activate
  or retire authority signals; merge the three engagement reply paths into one grounded generator
  and extend moderation to outbound (shadow→enforce); harden analytics narration. Every change
  flag-gated, provenance-labeled, never fabricates.

Dependencies minimized: WS-1 and WS-2 touch disjoint file zones and share only frozen P seams.

---

## 8. Dependency Graph

```
                    ┌──────────────────────── FROZEN PLATFORM (P) ────────────────────────┐
                    │ gateway · ai/safety/* · ai/grounding/* · contextAssimilationEngine   │
                    │ billing · observability · platform/intelligence  (consume-only)      │
                    └───────────▲─────────────────────────────────────────▲───────────────┘
                                │ consumes                                 │ consumes
              ┌─────────────────┴───────────────┐         ┌───────────────┴──────────────────┐
              │  WS-1  Generation Spine (A1)     │         │  WS-2  Intelligence & Egress (A2) │
              │  runtime→prompt→originality→     │         │  ingestion→tiered insight→cite    │
              │  brand→persist                   │         │  engagement reply→moderation→send │
              └──────────────────────────────────┘         └───────────────────────────────────┘
                     (no edge between WS-1 and WS-2 — fully parallel)
```

- **Prerequisite:** Wave 1 (P safety) + Wave 2 grounding policy exist ✅ (both merged/uncommitted-canonical).
- **Integration graph:** WS-1 and WS-2 integrate only through P contracts (§3); no cross-WS import.
- **Merge graph:** independent branches → main; order-independent (see §10).
- **Parity checkpoints:** WS-1 A/B parity per content type; WS-2 provenance-coverage + moderation
  shadow-diff before enforce.
- **Maximum safe parallelism:** 2 (as mandated), achieved with zero shared mutable files.

---

## 9. Agent Allocation Matrix

| Dimension | AGENT 1 (Generation Spine) | AGENT 2 (Intelligence & Egress) |
|---|---|---|
| **Ownership** | Content write path | Read/analyze + egress path |
| **Files owned** | Zone A1 (§1) | Zone A2 (§1) |
| **Interfaces owned** | runtime intent/output, prompt-block registry, originality decision | market insight+citation DTO, engagement reply DTO |
| **Shared contracts (consume)** | gateway, grounding decision, safety, billing, observability | gateway, marketProvenance, outbound-moderation verdict, safety, billing, observability |
| **Allowed modifications** | anything in A1; add net-new additive migrations | anything in A2; add net-new additive migrations |
| **Prohibited** | any file in A2/P/F/U; modifying any P interface; forking gateway/grounding/originality | any file in A1/P/F/U; modifying any P interface; re-introducing fabricated market evidence |
| **Required inputs** | this doc; AI-ARCH-000 ADR-002/003/004/005/012; grounding policy contract | this doc; AI-ARCH-000 ADR-006/007; marketProvenance + moderation contracts |
| **Expected outputs** | one content runtime live (flagged), legacy removed, originality coverage 100%, brand adopted, grounding consumed in prompt | tiered market pipeline (cited), one engagement reply generator, outbound moderation shadow→enforce, dead paths removed |
| **Certification** | A/B parity per content type; originality coverage proof; baseline tsc green; tests | provenance coverage (no fabrication); moderation shadow-diff; baseline tsc green; tests |

**Every repository file has exactly one owner** via longest-prefix zone match (§1).

---

## 10. Merge Governance

- **Branch ownership:** `feat/gen-spine-*` (A1), `feat/intel-egress-*` (A2). One worktree per branch
  (repo worktree policy). Never two workstreams in one checkout; never `git add -A` in a shared checkout.
- **Review ownership:** PMO reviews each certified commit by SHA before merge to `main`.
- **Merge ownership:** PMO sequences merges. Because zones are disjoint, **merge order is
  independent** — either agent may merge first; no rebase conflict is possible on owned files.
- **Conflict resolution:** any conflict on a shared P/F file = a governance violation → revert the
  offending change, file an ICR. Conflicts should be structurally impossible under §1.
- **Shared-code policy:** P/F files are consume-only. A cross-zone need becomes an ICR, executed by
  PMO or a dedicated short-lived platform task — never inline by A1/A2.
- **Interface freeze policy:** all §3 Shared Contracts frozen for the duration; changes via ICR only.
- **Integration windows:** after each agent's certified commit, PMO runs the Continuous Coordination
  audit (§17) before authorizing the next.
- **Merge sequencing (recommended, not required):** WS-1 content flag OFF by default and WS-2
  provenance in shadow — both land dark, then activate via measured rollout.

**No agent may modify another agent's owned area.**

---

## 11. Interface Change Policy (ICR)

Any change to a public interface, DTO, registry, shared utility, runtime/AI contract, event schema,
or API in Zone **P** or a §3 **Shared Contract** requires an **Interface Change Request** approved by
the PMO before implementation. Implementation agents may **not** modify shared contracts
independently. An ICR records: requesting agent · contract · current shape · proposed shape ·
consumers impacted · backward-compat plan · rollback. The PMO either approves (and, if needed, assigns
a dedicated platform task) or rejects with an alternative that stays within existing contracts.

**Standing ICR-0 (pre-approved):** additive, backward-compatible consumption of the existing
grounding decision by A1's prompt path, and A2's outbound-moderation shadow adoption — because both
are *consuming* frozen contracts, not changing them. Any *shape* change still needs a fresh ICR.

---

## 12. Architectural Decision Registry (ADR log)

Binding ADRs live in `docs/ai-architecture/AI-ARCHITECTURE-ADRS.md` (ADR-001..014) and are inherited.
PMO-local decisions:

| ADR | Decision | Context | Alternatives | Consequences |
|---|---|---|---|---|
| PMO-ADR-01 | Partition remaining work by **write-path vs read/egress-path**, not by product | Products span both paths; product-split would collide on shared runtime | Split by product (rejected: overlap on runtime/gateway); split by layer (rejected: forces shared files) | Zero file overlap; two clean workstreams |
| PMO-ADR-02 | All shared AI seams are **FROZEN, consume-only** | Wave-1/2 hardened them; concurrent edits = drift | Let agents edit seams (rejected) | Interface stability; ICR gate |
| PMO-ADR-03 | `contextAssimilationEngine` classified **Platform (P)**, not A1/A2 | It's the one canonical assimilate used across products | Give to A1 (rejected: A2 dependency) | Neither agent edits it; ICR only |
| PMO-ADR-04 | Image-seam merge (ADR-013) **deferred** to a follow-up wave | Not on the text spine; would overload A1 | Do it now (rejected: scope/overlap) | Registered PENDING (§20); no concurrent conflict |
| PMO-ADR-05 | All activations land **dark** (flag-gated) then measured rollout | Production-ready-throughout mandate | Big-bang enable (rejected) | Continuous production readiness |
| PMO-ADR-06 | Adopt **Semantic Root + Semantic Continuity** as the canonical generation-lineage substrate, owned by **A1** in `content/runtime/contracts.ts` | New foundational concept (not in AI-ARCH-000); aligns with "single generation runtime owns context→gen→persist" | Skip it (rejected: no shared semantic identity across stages); make it a Platform Shared Contract (rejected: originates in and is consumed only by A1's runtime) | Semantic Root DTO is **A1 Module-owned, additive/optional → no ICR**; **must reconcile with existing `publicationLineageService` (no 2nd lineage store)**; image/visual bridge is **orchestration-only** (produce specs carrying lineage; do NOT touch the deferred image seam) |
| PMO-ADR-07 | **Promote the semantic identity substrate to a Platform-owned Shared Contract** (revises ADR-06's "Module-owned") | WS-1a (A1) and OMNI-COORD-001 (A2) independently defined `semanticRootId`+`communicationIntent` **divergently** (A1 string/uuid vs A2 enum/deterministic-derive) → incompatible; a second consumer makes it multi-consumer by §3 | Leave two definitions (rejected: spine non-continuous across zones); A2 imports A1's type (rejected: cross-WS import) | New P contract `backend/platform/intelligence/semanticIdentity.ts` (ICR-1) owns `SemanticRootId` + ID strategy + `CommunicationIntent` vocabulary; A1's rich `SemanticRoot` and A2's coordination contracts both reference it; **A1 runtime is the canonical producer/minter, A2 consumes-or-derives-as-fallback** |
| PMO-ADR-08 | Approve **runtime no-persist mode + typed output-schema adapters + LF-adapter wiring** as the path to full consolidation | WS-1c audit found 5 live families can't converge onto the persistence-bearing, short-form-shaped runtime without these | Force-wrap now (rejected: double-persist/schema regression); keep families permanently separate (rejected: violates "one runtime" mandate) | All A1 Module-owned + additive → **no ICR**; sequenced WS-1c-2/3/4, each parity-gated; convergence never breaks flag-OFF |
| PMO-ADR-09 | **Grow the runtime with a structured/blueprint task-profile capability** so #9 (structured object) + #10 (blueprint) fit "one runtime" — converge via **quality-A/B, NOT byte-parity** | WS-1c-3 proved #9/#10 can't byte-converge onto the single-master runtime (owner decision: grow, not narrow/retire) | Narrow to master-family; retire #9/#10 (both rejected by owner) | New A1 runtime capability (**additive** — default master behavior BYTE-IDENTICAL so post/thread/#7/BOLT parity preserved); #9/#10 convergence flag-gated + quality-validated; WS-1c-3b. Content-type axis + output-shape extended additively |
| PMO-ADR-10 | **Agent 2 "pause" lifted — PMO now actively coordinates a live A2 session** | Owner confirmed the parallel A2 coordination work (registration/adoption/engagement) is intentional | Keep paused (rejected by owner) | PMO monitors every A2 landing against ICR-1 drift + Zone-A2 ownership + forbidden-overlap; A2 consumes (never edits) the Platform semantic-identity contract; concurrent A1+A2 now genuinely parallel |

---

## 13. Technical Debt Registry

| ID | Debt | Kind | Owner | Status |
|---|---|---|---|---|
| TD-01 | Grounding decision computed but not consumed in generation PROMPT path | Architectural | A1 | Deferred → WS-1 closes |
| TD-02 | Two grounding stacks not unified (assimilation vs extractCompanyIdentity) | Architectural | P/A1 | Known → ICR if unification needed |
| TD-03 | Originality semantic (embedding) tier dead; coverage holes (BOLT, long-form, creator copy) | Architectural | A1 | WS-1 activates + covers |
| TD-04 | Multiple competing generators live; "one prompt/context assembly" NOT yet repo-wide | Architectural | A1 | **Scoped by WS-1c audit; converging:** post/thread ✅ + #7 ✅ + BOLT master #8 ✅ + **day-content #9 ✅** (task-profile, WS-1c-3b) now on runtime; no-persist mode + task-profile capability built. Remaining: angle-blueprint #10 (profile built, cutover-or-retire WS-1c-3c), workspace #11, long-form #12–15 + shadow LF #17 (WS-1c-4), then WS-1c Final (legacy retirement). Each parity/quality-gated |
| TD-05 | MarketPulse flagship fabricates evidence (no citations) | Correctness/Security | A2 | WS-2 replaces (Critical) |
| TD-06 | Engagement: 3 reply paths, live one ignores memory, no outbound moderation | Architectural/Security | A2 | WS-2 merges |
| TD-07 | Provider transient-retry off by default; full boundary error normalization deferred | Reliability | P | Known (backward-compat) |
| TD-08 | Billing under-adopted (many AI paths unbilled) | Cost | P (cross-cutting) | Tracked; ICR-coordinated, not this wave |
| TD-09 | Authority signals inert (table never populated) | Correctness | A2 | WS-2 activate or retire |
| TD-10 | Image-seam duplication (2 direct-OpenAI stacks bypass guard) | Security/Architectural | A1 (deferred) | PENDING follow-up (PMO-ADR-04) |
| TD-11 | Stale prose-as-code / dead prompt builders in tree | Docs/Hygiene | P/U (not A1) | **Discovered by WS-1c** (exact targets): orphaned `PROMPT_REGISTRY.content_generation`+`buildContentGenerationPrompt` (`backend/prompts/`), dup `getContentBlueprintPromptWithFingerprint` (`contentGenerationPromptsV3.ts:426`), root `UNIFIED_CONTENT_GENERATION_COMPLETE.ts`, dead `unifiedEngine` import (`creatorContentProcessor.ts:20`). All out-of-A1-zone → WS-1c-hygiene for owners |
| TD-12 | Semantic Root "generation lineage" risks duplicating existing `publicationLineageService` (`publication_lineage`, Wave 5) | Architectural (duplication) | A1 | WS-1a MUST reference/extend the existing service, never fork a 2nd lineage store — **RESOLVED** by WS-1a (soft-ref only) |
| TD-13 | **Semantic-identity contract divergence**: A1 `communicationIntent:string`+`sroot-<uuid>` vs A2 `CommunicationIntent` enum + `deriveSemanticRootId` → ids never match, spine non-continuous across zones | Architectural (drift/incompat) | P (ICR-1) | **OPEN — blocks activation of both**; reconcile via P `semanticIdentity.ts` — **✅ RESOLVED** (ICR-1 certified; A1 produces canonical `sroot_<hex>` grouping key + separate `generationInstanceId`; A2 consumes; both reference the ONE P contract; ids proven equal for the same seed) |
| TD-15 | `deriveVisualBrief.imageText` now derives from the canonical intent token (e.g. `'promote'`) instead of a human-readable objective, after intent narrowed | Correctness (dormant) | A1 | OPEN — flag-OFF + orchestration-only (not consumed); fix to source `imageText` from `contentBrief.objective`/`coreMessage`; tighten `VisualBrief.communicationIntent` to `CommunicationIntent`. Fold into WS-1a-fix or the image wave — **✅ RESOLVED** by WS-1a-fix (imageText → `contentBrief.objective`; VisualBrief typed). Minor residual: `deriveImagePromptSpec` still narrates the enum token as prompt metadata (acceptable; note for image wave) |
| TD-14 | Isolation breach: WS-1a/1b (A1) + ICR-1 (P) + OMNI-COORD-001/002 (A2) co-mingled, uncommitted | Process/Governance | PMO | **✅ SESSION WORK COMMITTED** (2026-07-20, LOCAL only — not pushed) as 3 clean per-zone commits: `499dd206` P semantic-identity, `ce9f8d11` A1 Semantic Spine, `9b6f55ac` A2 coordination, `735ce310` A1 WS-1c-2 no-persist+#7, `a143a209` A1 WS-1c-2b BOLT (⚠ includes pre-existing BOLT edits per owner direction — entanglement accepted). Surgical (explicit paths; 0 OTHER pre-existing files swept). **Observed 2026-07-20:** new untracked A2 artifacts `coordination/adoption/` + `coordinationEngagementAdoption.test.ts` (OMNI-COORD-002 engagement shadow) appeared despite Agent-2-paused directive — left untouched, flagged to owner. **Residual:** (a) pre-existing substrate — Wave-1/2 safety+grounding, PIP foundation (README/contracts/platform/runtime.ts), ~39 modified + misc — remains uncommitted (prior-wave, owner's call); (b) per-zone BRANCHES (vs commits on one branch) deferred — commits are cleanly cherry-pickable per zone if separate PRs are wanted |
| TD-16 | WS-1b stamps `semantic_root_id`/`communication_intent` as UNTYPED extra keys on `PlatformVariantPayload` (agent wrongly assumed `contentGeneration/**` out-of-zone; it IS Zone A1) | Cleanliness (minor) | A1 | OPEN — add typed optional fields to the payload (in-zone, additive, NO ICR needed); flag-dark so non-urgent |

| TD-17 | **⚠ GOVERNANCE ALERT: parallel Agent-2 session ACTIVE despite "Agent 2 paused" directive.** Files committed in `9b6f55ac` (coordinationContracts/communicationRegistry/index/stores) RE-MODIFIED live (mtimes 13:34, ~70s before detection); new `coordination/{registration,adoption}/` modules + tests appeared. ICR-1 reconciliation still intact (no local CommunicationIntent), but actively changing → drift risk on the Platform semantic-identity contract | Process/Governance/Drift | PMO ↔ owner | **OPEN — ESCALATED.** Uncoordinated concurrent A2 work: (a) violates A1-first sequencing; (b) re-dirties committed files (commit hazard); (c) live-edits the file holding TD-13's fix. Needs owner decision: is this intentional (2nd session)? If so, PMO must coordinate/monitor it against ICR-1; if not, pause it — **RESOLVED: owner confirms INTENTIONAL (PMO-ADR-10). PMO now coordinates A2 live: monitor ICR-1 integrity + Zone-A2 ownership on every landing.** ICR-1 verified intact as of 13:35 (coordinationContracts still imports platform CommunicationIntent, no local redef) |

Every implementation report MUST update this registry.

---

## 14. Repository State Model

| Subsystem | State |
|---|---|
| Governance, Migration, Auth, Security | **Completed / Frozen** |
| AI Safety (Wave 1a–1d) | **Completed** (uncommitted-canonical) |
| Grounding (Wave 2) | **In Progress** (activated w/ exceptions) |
| Generation Runtime (WS-1) | **In Progress** |
| Writer / BOLT / Long-form convergence | **In Progress** (WS-1) |
| MarketPulse tiered pipeline (WS-2) | **In Progress** |
| Engagement reply merge + outbound moderation (WS-2) | **In Progress** |
| Campaign / Strategic Mix / Intelligent Mix | **Completed / Frozen** |
| Website Intelligence, Analytics core | **Completed** |
| Image-seam merge | **Deferred** (PENDING) |
| MarketPulse LLM flagship (fabricating) | **Superseded** (by tiered pipeline) |
| Legacy content generators | **Deprecated** → to be Removed by WS-1 |

---

## 15. Execution Roadmap

| Order | Workstream | Est. | Depends on | Cert gate | Rollback | Merge wave | Risk | Outcome |
|---|---|---|---|---|---|---|---|---|
| 1a | WS-1 runtime consolidation + grounding consumption | L | P seams (ready) | A/B parity per content type; tsc baseline | flag OFF | Wave A (dark) | Med | one content path live (flagged) |
| 1b | WS-1 originality tier + coverage + brand adoption | M | 1a | coverage proof; parity | flag OFF | Wave A | Med | 100% originality coverage |
| 1c | WS-1 legacy replace→remove | M | 1a/1b parity green | no importer of legacy | revert commit | Wave B | Med | forks removed |
| 2a | WS-2 tiered market pipeline + ingestion wiring | L | P (marketProvenance) | provenance coverage; no fabrication | flag OFF / shadow | Wave A (dark) | High | cited insights |
| 2b | WS-2 engagement merge + outbound moderation shadow | M | P (moderation) | shadow-diff; memory used | flag OFF | Wave A | Med | one reply generator |
| 2c | WS-2 authority activate/retire; analytics narration | S | 2a | signal populated or removed | flag OFF | Wave B | Low | no inert signals |
| 3 | Measured rollout (flags on) | S | all cert gates | live metrics stable | flag OFF | Wave C | Med | activated in prod |
| 4 | (Deferred) image-seam merge | M | this wave done | guard coverage | flag OFF | later | Med | one guarded image seam |

WS-1 and WS-2 run **fully concurrently** (orders 1x and 2x in parallel).

---

## 16. Execution Prompts

> The two prompts are reproduced verbatim below (also usable directly). Neither overlaps.

See **AGENT 1 Execution Prompt** and **AGENT 2 Execution Prompt** sections at the end of this document.

---

## 17. Continuous Coordination Strategy

After **every** implementation report, the PMO runs, in order:
1. **Ownership audit** — did any change touch a file outside the agent's zone? (git diff path-check vs §1)
2. **Duplication audit** — any new capability that already exists? (§6 checklist)
3. **Architectural drift audit** — any P/F interface modified? any forbidden overlap re-introduced?
4. **Dependency audit** — any new cross-WS import? (grep for A2 modules imported in A1 diff & vice-versa)
5. **Merge readiness audit** — certified by SHA? baseline tsc green? tests pass? flags dark?
6. **Interface audit** — any Shared Contract shape change without an ICR?

**Remediation levers:** rebalance work · reassign ownership · split a workstream · freeze an
interface · issue a revised (superseding) prompt. Always preserve **one canonical implementation**.

---

## 18. Workstream Health Dashboard

| Workstream | Health | Rationale | Required action |
|---|---|---|---|
| WS-1 Generation Spine | 🟢 GREEN | Clean zone, frozen deps ready, flag-gated | proceed; prove A/B parity before removal |
| WS-2 Intelligence & Egress | 🟡 YELLOW | Critical fabrication debt (TD-05); more external deps (ingestion providers) | proceed dark; verify provenance before enable |
| Platform (P) | 🟢 GREEN | Hardened, frozen | hold interfaces; process ICRs |

---

## 19. Repository Risk Dashboard

| Risk | Level | Note |
|---|---|---|
| Architecture | 🟢 Low | Canonical blueprint frozen; partition prevents drift |
| Merge | 🟢 Low | Disjoint zones → conflicts structurally impossible |
| Ownership | 🟢 Low | Every file one owner (longest-prefix) |
| Regression | 🟡 Med | Legacy removal (TD-04); mitigated by A/B parity + flags |
| Security | 🟡 Med | Fabrication (TD-05) + outbound moderation (TD-06) until WS-2 lands |
| Performance | 🟢 Low | Optimization flags dark; measured rollout |
| Dependency | 🟡 Med | WS-2 external ingestion providers |
| Testing | 🟢 Low | Strong existing suites; per-wave gates |
| Documentation | 🟢 Low | This registry + AI-ARCH-000 |
| **Overall** | 🟢 **Healthy, conditional** | Safe for 2 concurrent agents under this governance |

---

## 20. Prompt Registry

| Prompt | State |
|---|---|
| WS-1 Generation Spine (AGENT 1, below) | **Active** |
| WS-1a Semantic Spine Foundation (Semantic Root + Continuity, PMO-ADR-06) | **Certified** (2026-07-20; in-zone, flag-dark, tests pass) |
| OMNI-COORD-001 / WS-2a Coordination Intelligence Foundation (A2) | **Reconciled** (references P `semanticIdentity`) |
| ICR-1 Platform semantic-identity contract (`semanticIdentity.ts`, PMO-ADR-07) | **✅ Certified** (2026-07-20; PMO-verified: 0 net-new tsc, 50/50 tests, A1↔A2 ids interoperate) |
| WS-1a-fix: permanent A1↔A2 interop regression test + `imageText`/`VisualBrief` tidy (TD-15) | **✅ Certified** (2026-07-20; PMO ran the test — 4/4 incl wired A1↔A2 id equality, 0 net-new tsc) |
| WS-1b Semantic Continuity Enforcement + publish-lineage linkage | **✅ Certified** (2026-07-20; PMO-verified: A1-only mtime-proven, 17/17 continuity tests incl no-mint-when-absent, 0 net-new tsc, fail-closed gen / fail-safe publish, flag-dark). Rollout note: enabling `SEMANTIC_ROOT_ENABLED` makes a corrupt/absent root a HARD failure at gen — call out at flag-enable |
| WS-1c Canonical Generation Runtime Consolidation — audit | **✅ Certified as audit** (2026-07-20; PMO-verified zero-change, 14/14 tests). 22-entry inventory: short-form (post/thread) consolidated on the runtime; 5 live families (BOLT/day-content/angle-blueprint/workspace/long-form) blocked on 3 runtime capabilities. Correctly changed NO code rather than force unsafe wraps |
| WS-1c-2 Runtime **no-persist mode** + textGenerationOrchestrator #7 convergence | **✅ Certified** (2026-07-20; PMO-verified: persist:true byte-identical, #7 parity 6/6 return+item, no double-persist asserted, 0 net-new tsc, BOLT+caller mtime-proven untouched). Flag `TEXTGEN_RUNTIME_DELEGATION_ENABLED` default OFF |
| WS-1c-2b BOLT #8 convergence | **✅ Certified** (2026-07-20; PMO-verified: BOLT master on runtime, additive painPoint?/outcomePromise? opt-in, post/thread+#7 parity 6/6+13/13 UNCHANGED, BOLT parity 5/5, no double-persist, 0 net-new tsc, out-of-zone callers untouched). Flag `BOLT_RUNTIME_DELEGATION_ENABLED` default OFF. Residual (Risk 1): runtime stage-7 variants computed+discarded when flag ON (output-neutral, wasteful) |
| WS-1c-2b-fix additive `variants?: boolean` runtime option (skip stage-7 for no-persist delegators that own variants) | **Pending** (APPROVED; A1-additive, default-preserving; eliminates BOLT double-variant compute) |
| WS-1c #7 legacy-body deletion (after prod soak + parity holding) | **Pending** (gated deletion wave) |
| WS-1c-3 Runtime output-schema adapters (day-content #9, angle-blueprint #10) | **✅ Certified as audit — BOTH DEFER** (2026-07-20; PMO-verified zero-change via mtime + structural spot-checks; 63/63 sacred suites green). Finding: runtime is single-master-shaped + content-type axis closed to 5 WriterContentTypes; #9 = 10-field structured object, #10 = multi-angle blueprint (`@deprecated`) — routing either through the runtime changes output (regression); neither context read byte-safe. **Raises PMO decision:** is "one runtime" meant to absorb structured/blueprint generators (needs a new runtime task-profile capability) or are they distinct shapes / retire candidates? |
| WS-1c-3b Runtime task-profile capability + #9 convergence (PMO-ADR-09) | **✅ Certified** (2026-07-20; PMO-verified: additive profile registry + top-of-generate guard, default master + post/thread/#7/BOLT BYTE-IDENTICAL — 31/31 sacred green, taskPolicyRegistry/unifiedEngine untouched, main tsc 0 net-new). #9 day-content CONVERGED behind `CONTENTGEN_DAY_RUNTIME_DELEGATION_ENABLED` (quality-A/B, dark). #10 blueprint profile built+tested, live cutover DEFERRED (@deprecated). Enable #9 = HOLD DARK pending human quality spot-check |
| WS-1c-3c #10 blueprint live cutover OR retire `unifiedContentGenerationEngine.generateMasterContent` (@deprecated) | **Pending** (low priority; lean RETIRE in WS-1c Final unless queue path proven live; profile ready if cutover chosen) |
| WS-1c-4 Long-form convergence | **✅ Certified (partial)** (2026-07-20; PMO-verified: adapter wired byte-identically via `longFormRuntimeDelegation.ts` at the unified-engine chokepoint, flag `LONGFORM_RUNTIME_DELEGATION_ENABLED` default OFF, lazy-import cycle-safe; generationRuntime.ts UNTOUCHED; 47/47 sacred+new, 0 net-new tsc). DEFERRED (byte-unsafe): long-form context + deep multi-section gen-convergence (distinct shape; future quality-gated task-profile optional). Chokepoint covers the whole LF family |
| WS-1c-4b Shadow #17: RETIRE dead shell (`longFormGenerationOrchestrator`+`aiGatewaySectionGenerator`, 0 prod callers) + MERGE grounding/claim-validation into live planned path (`groundingProfile` insertion) | **Pending** (APPROVED; reconcile w/ existing staged `compatibilityCore*`/`retirement*` machinery; non-trivial) |
| WS-1c-hygiene: remove out-of-zone dead code — orphaned `PROMPT_REGISTRY.content_generation`+`buildContentGenerationPrompt`, dup `getContentBlueprintPromptWithFingerprint` (contentGenerationPromptsV3:426), root `UNIFIED_CONTENT_GENERATION_COMPLETE.ts`, dead `unifiedEngine` import (creatorContentProcessor:20) | **Pending** (Zone P/U — prompts/queue/hygiene owners, not A1) |
| WS-2 Intelligence & Egress (AGENT 2, below) | **Active** |
| Image-seam merge (ADR-013) | **Pending** (deferred, PMO-ADR-04) |
| Billing universal-coverage (TD-08) | **Pending** (cross-cutting, ICR-coordinated) |
| Grounding-stack unification (TD-02) | **Pending** (ICR-gated) |
| Wave-1 safety adoption | **Completed** |
| Wave-2 grounding activation | **Superseded-in-part** by WS-1 (prompt consumption) |
| MarketPulse LLM fabrication path | **Cancelled** (replaced by tiered pipeline) |

Never issue duplicate work: check this registry before authorizing any prompt.

---

## Final Certification

The remaining Omnivyra engineering work can be executed by **two concurrent agents** with:
every file having exactly one owner (§1/§2), every shared component/interface/capability having
exactly one owner (§2–§4), disjoint file zones making merge conflicts structurally impossible (§10),
and forbidden overlaps preventing duplicate implementation (§3/§6). Both workstreams are
independently executable, mergeable, certifiable, and rollbackable (flag-gated), and the repository
stays production-ready throughout (dark landing + measured rollout).

**Two honest coordination follow-ups remain**, hence not an unconditional pass:
1. The **image-seam merge (ADR-013 / TD-10)** is deferred and its prompt is only *registered*
   (PENDING), not fully authored — so "future prompts require no additional planning" is not yet 100% true.
2. **`contextAssimilationEngine` / grounding-stack unification (TD-02)** sits on the A1↔P boundary;
   A1 consumes the frozen contract now, but full unification is an ICR-gated future decision.

Neither is a defect in the two-agent plan; both are sequenced future waves already registered (§20).

### ⚠️ CERTIFIED WITH COORDINATION FOLLOW-UP

---
---

# AGENT 1 — Generation Spine Execution Prompt

**Ownership:** Zone A1 (§1) — the content **write path**.
**Scope:** Consolidate all content generation onto the single `content/runtime/generationRuntime.ts`;
make `promptAssembler` own the prompt bytes; activate the originality semantic tier and close
coverage; adopt `brandRuntime` fully; **consume the (frozen) grounding decision in the prompt path**.

**Objectives**
1. Route Writer (`lib/post`, `lib/thread`, `contentWriter`), BOLT (`boltContentGenerationForSchedule`),
   and long-form (`lib/blog`, `longForm/**`) through `generationRuntime` behind existing flags, with
   **A/B parity proven per content type** before any removal.
2. Make `content/runtime/promptAssembler.ts` own the prompt bytes; retire legacy prompt builders
   (`prompts/contentGenerationPromptsV3`, orphaned `PROMPT_REGISTRY` entry) — archive/remove.
3. Activate the originality **semantic (embedding) tier** in `content/originalityGate.ts` +
   `contentMemoryService.ts`; extend coverage to BOLT, long-form, and creator copy. Key on `decision`.
4. Full `brand/brandRuntime.ts` adoption on the write path (voice/vocab/compliance).
5. **Consume the frozen grounding decision** (from `ai/grounding/*` via `contextAssimilationEngine`)
   in `promptAssembler` — gate/degrade output on floor/freshness. **Do not modify the grounding
   contract.** (Closes Wave-2 exception TD-01.)
6. Replace → remove `unifiedContentGenerationEngine`, `contentGenerationService`, and the
   `textGenerationOrchestrator.runTextGeneration` fork once parity is green.

**Files owned:** all of Zone A1 (§1). **Files prohibited:** any file in Zones A2, P, F, U.
**Dependencies (consume, never modify):** provider gateway, `ai/safety/*`, `ai/grounding/*`,
`contextAssimilationEngine`, `billing/runBilledAiCompletion`, observability.
**Interfaces owned:** runtime intent/output DTO, prompt-block registry, originality decision.
**Out-of-scope:** MarketPulse, Engagement, moderation, intelligence ingestion, image-seam merge
(deferred), any gateway/grounding/safety interface change (→ ICR).
**Constraints:** every change flag-gated and fall-back-safe; net-new migrations additive only;
one worktree/branch (`feat/gen-spine-*`); never `git add -A`; keep git identity `kulrashm-jpg`.
**Success criteria:** one content path live (flagged); A/B parity per content type; originality
coverage 100%; brand adopted; grounding consumed in prompt; legacy generators removed; tsc baseline
green; tests pass.
**Certification checklist:** [ ] A/B parity per type [ ] originality coverage proof [ ] brand adoption
verified [ ] grounding gate exercised [ ] no legacy importer remains [ ] baseline tsc green [ ] tests
[ ] TD-01/03/04/11 updated [ ] flags dark.
**Merge requirements:** certified commit by SHA; PMO coordination audit (§17) passes; flags OFF.
**Non-goals:** enabling flags in prod (Wave C, measured rollout); touching P/F/A2/U; ICR-gated items.

---

# AGENT 2 — Intelligence & Egress Execution Prompt

**Ownership:** Zone A2 (§1) — the **read / analyze / egress** path.
**Scope:** Replace MarketPulse LLM fabrication with the tiered cited pipeline; connect real
ingestion; activate or retire authority signals; merge the three engagement reply paths into one
grounded generator; extend moderation to outbound (shadow→enforce); harden analytics narration.

**Objectives**
1. Replace `marketPulse` LLM flagship (`opportunityGenerators`) with the **tiered pipeline**
   (deterministic · retrieval-backed/cited · labeled-inference) using the frozen `marketProvenance`
   contract; **never fabricate evidence** — degrade to `not_evaluable`.
2. Connect real ingestion (`intelligence/adapters/*` — YouTube/NewsAPI/SerpAPI) as the flagship
   source; **merge any second provider abstraction onto the frozen gateway** (do not fork it).
3. Activate `authorityIntelligenceService` (populate the table via a real provider) **or retire it**
   if no provider — no inert signals.
4. Merge Engagement reply paths (A live/shallow, B grounded/dormant, C dead) into **one grounded
   reply generator** that uses memory; remove the dead path.
5. Extend `moderation/moderationGateService` to **outbound** (pre-send), landing in **shadow**, with
   a shadow-diff report, before any enforce. Consume the frozen outbound-moderation verdict.
6. Harden analytics deterministic-aggregation + optional LLM narration (fallback deterministic).

**Files owned:** all of Zone A2 (§1). **Files prohibited:** any file in Zones A1, P, F, U.
**Dependencies (consume, never modify):** provider gateway, `marketProvenance`, outbound-moderation
verdict, `ai/safety/*`, `billing/runBilledAiCompletion`, observability, `platform/intelligence`.
**Interfaces owned:** market insight+citation DTO, engagement reply DTO.
**Out-of-scope:** content generation runtime, Writer/BOLT/long-form, originality, brand, prompt
assembly, any gateway/safety/provenance interface change (→ ICR).
**Constraints:** provenance-labeled always; never fabricate; flag-gated/shadow; net-new migrations
additive only; one worktree/branch (`feat/intel-egress-*`); never `git add -A`; git identity
`kulrashm-jpg`.
**Success criteria:** tiered market pipeline live (flagged, cited, zero fabrication); one engagement
reply generator using memory; outbound moderation in shadow with diff; authority activated or
retired; analytics narration hardened; tsc baseline green; tests pass.
**Certification checklist:** [ ] provenance coverage / no fabrication [ ] citations present
[ ] gateway not forked [ ] one reply path, dead removed [ ] moderation shadow-diff [ ] authority
resolved [ ] baseline tsc green [ ] tests [ ] TD-05/06/09 updated [ ] flags dark.
**Merge requirements:** certified commit by SHA; PMO coordination audit (§17) passes; flags OFF /
moderation in shadow.
**Non-goals:** enforcing outbound moderation in prod (after shadow-diff review); touching P/F/A1/U;
ICR-gated items.
