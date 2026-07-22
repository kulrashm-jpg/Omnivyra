# AI Migration Architecture (AI-ARCH-000)

Component dispositions derived from OMNI-AI-001. **Architecture only — no implementation, migration, or removal is authorized by this document.** Each disposition names the target end-state that Waves 1–5 will realize under ADR-014 (flag-gated, parity-verified).

## Disposition legend
- **Retain** — canonical; keep as the single implementation.
- **Merge** — fold into a canonical implementation.
- **Replace** — supersede with the canonical path, then remove.
- **Remove** — delete after parity/verification.
- **Archive** — move out of the authoritative tree (stale reference).

## Component dispositions

| Component | OMNI-AI-001 finding | Disposition | Target |
|---|---|---|---|
| `aiGatewayCore` + `aiGatewayProviders*` | Canonical chat seam; mature | **Retain** | The one gateway (ADR-001) |
| `signalEmbeddingService` (embeddings) | Legit sibling seam | **Retain** | Embedding seam (also feeds originality — ADR-005) |
| `creatorAssetRendererMedia` image path | Legit but bypasses guard; duplicated | **Merge** | One guarded image seam (ADR-013) |
| `rendering/providers/openAIRenderProvider` | Second image stack | **Merge** into the one image seam | ADR-013 |
| `intelligence/adapters/*` | Divergent second provider abstraction | **Merge** onto gateway | ADR-001 |
| `content/runtime/generationRuntime` | Canonical, OFF by default | **Retain** (enable) | Sole content orchestration (ADR-002) |
| `contentGeneration/blueprintGenerator` + `platformVariantGenerator` | Canonical primitives | **Retain** | Owned by the runtime |
| `unifiedContentGenerationEngine` | "DEPRECATED" banner, worker-wired | **Replace → Remove** | ADR-002 |
| `contentGenerationService` (inline prompts) | Live legacy | **Replace → Remove** | ADR-002 |
| `textGenerationOrchestrator.runTextGeneration` | Legacy fork | **Merge** into runtime | ADR-002 |
| `content/runtime/promptAssembler` | Canonical, but delegates bytes to legacy | **Retain** (own the bytes) | ADR-003 |
| `prompts/contentGenerationPromptsV3` prompt builders | Dead (no prod importer) | **Archive/Remove** | ADR-003 |
| `PROMPT_REGISTRY` `content_generation` entry | Test-only/orphaned | **Remove** | ADR-003 |
| `UNIFIED_CONTENT_GENERATION_COMPLETE.ts` (root) | Prose-as-code, stale | **Archive/Remove** | ADR-003 |
| `contentGeneration.prompt.ts` vs V3 duplicate constants | Version/fingerprint collision | **Merge** to one each | ADR-003 |
| `getCanonicalProfile` / `canonicalContentContextResolver` | Canonical single read | **Retain** (+ floor, freshness) | ADR-004 |
| `brand/brandRuntime` | Full contract inert on Writer | **Retain** (full adoption) | ADR-012 |
| `content/originalityGate` + `contentMemoryService` | Canonical; embedding tier dead; coverage holes | **Retain** (activate tier, extend coverage) | ADR-005 |
| `boltContentGenerationForSchedule` | Bypasses originality + memory index | **Merge** onto runtime path | ADR-002/005 |
| long-form `lib/blog/runBlogGeneration` | Live long-form | **Merge** with the unwired orchestrator into one engine | ADR-002 |
| `longForm/longFormGenerationOrchestrator` + `groundedClaimValidator` | Richest grounding, unwired from live | **Merge/wire** into the live long-form path | ADR-002/007 |
| `campaignAiOrchestrator` + `buildDeterministicWeeks` | Canonical deterministic | **Retain** (seed the plan call) | ADR-009 |
| `strategicMixCapability` (decision graph) / `weeklyAssignmentEngine` | Canonical deterministic | **Retain** | ADR-009 |
| MarketPulse LLM flagship (`opportunityGenerators`) | Fabricated, no citations | **Replace** with tiered pipeline | ADR-006 |
| Intelligence ingestion (YouTube/NewsAPI/SerpAPI) | Real but disconnected | **Retain** + connect as flagship source | ADR-006 |
| `authorityIntelligenceService` / backlink signals | Inert (table never populated) | **Replace/Remove** (activate provider or retire) | ADR-006 |
| `websiteIntelligence*` deterministic engines | Canonical / mature | **Retain** | ADR-006 |
| Engagement reply paths (A live/shallow, B grounded/dormant, C dead) | Three paths, unequal | **Merge** to one grounded generator; **Remove** dead path | ADR-004/007 |
| `moderation/moderationGateService` | Real, inbound-only | **Retain** (extend to outbound) | ADR-007 |
| `aiRequestGuard` | Canonical abuse guard, fail-open | **Retain** | ADR-007 |
| `billing/runBilledAiCompletion` | Canonical billed path, under-adopted | **Retain** (universal coverage) | ADR-011 |
| `usage_events` + observability | Canonical, strong | **Retain** (+ new quality/grounding/hallucination signals) | §11 |
| `tmp_run_intelligence_evaluation.mjs` (root) | Throwaway temp script | **Archive/Remove** | hygiene |
| Dark-by-default optimization flags | Sophisticated but off | **Retain** (activate via measured rollout) | §Performance |
| `docs/AI-USAGE-AUDIT-CAMPAIGN-PIPELINE.md` "bypass" table | Stale (misreports remediated files) | **Archive/correct** | Docs |
| `docs/archive/*` AI guides | Superseded | **Archive** (already archived; relabel) | Docs |

## Implementation Readiness Assessment

| Readiness gate | State |
|---|---|
| Single seam per layer defined | ✅ (§2 responsibility matrix) |
| One canonical path per product | ✅ (§3) |
| Every shared capability has a contract | ✅ (§2 + ADRs) |
| All duplicated ownership has a disposition | ✅ (this document) |
| End-to-end lifecycle defined | ✅ (§1) |
| Boundaries internally consistent | ✅ (governance §12; owners are disjoint) |
| Immutable design principles established | ✅ (§13) |
| Cutover strategy defined (no-regression) | ✅ (ADR-014 flag-gated/parity) |
| Safety/integrity blockers have target designs | ✅ (ADR-006/007) |

**Readiness verdict:** the architecture is implementation-ready. Waves 1–5 can proceed against this blueprint without further architectural redesign. Sequencing follows the OMNI-AI-001 roadmap: W1 safety/integrity (ADR-006/007/010), W2 originality/grounding (ADR-004/005), W3 consolidation (ADR-002/003/012/013), W4 resilience/cost (ADR-001 retry, ADR-008/011), W5 observability/docs (§11, ADR-006 authority disposition).
