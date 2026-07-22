# COMPANY-PROFILE-AUDIT-003 — Company Intelligence & AI Generation Certification

**Scope:** Read-only. Builds on AUDIT-001/002. Certifies how intelligence is produced.

**Classification: Hybrid** (deterministic control plane, AI generation plane).

**Two corrections to prior assumptions:** (1) "language refine on read" is NOT an LLM call — `refineLanguageOutput` is rule-based (regex/tone), env-flag-gated. (2) Intelligence enrichment (`runCompanyContextEnrichment`) makes ZERO LLM calls despite tagging output `ai_inferred` — it is pure regex/heuristic inference.

---

## 1. Intelligence Generation Architecture

Pipeline (DET = deterministic, AI = LLM): Website → **CRAWL [DET]** (root + 3 keyword-scored pages, 8s/5MiB, 120s cache, SSRF-pinned) → **DETERMINISTIC EXTRACTION [DET]** (metadata, social links, top-10 sentences ≤2000 chars) → **FINGERPRINT + CHANGE [DET]** → **REFRESH GATE [DET]** (16-branch; can STOP or route METADATA_ONLY) → **CLEAN [AI]** → **PROMPT [DET]** → **LLM [AI]** (gpt-4o-mini, temp 0, JSON, via gateway) → **NORMALIZE [DET]** (zod, Low⇒missing) → **CLASSIFY [DET]** (classifier OVERRIDES AI industry) → **DRAFTS [AI]** (strategy temp 0.1 + marketing temp 0.2) → **COMPETITOR ENGINE [DET]** → **VALIDATE [DET]** → **CONFIDENCE [DET]** (composite = max(existing, new) — monotonic) → **PERSIST [DET]** → consumers. No chunking/embeddings/vector retrieval anywhere.

## 2. Crawl Pipeline Certification

Two crawlers: profile enrichment (`crawlWebsiteSources`, ≤4 pages) and a separate 250-page BFS (`crawlerService.ts`, → `canonical_pages`). No scheduled crawl — all lazy/on-demand (refine, staleness ≥7d, setup, enrichment). Scope: root + top-3 keyword-scored same-domain pages; 8s/5s timeouts; 5 MiB/page; 2,000-char summaries; ≤40 sources; ≤8 socials; SSRF-pinned, 3 redirects; asset filter; **robots.txt not honored** by the profile crawler. Cache: per-process Map, URL-string key (global across tenants), 120s TTL, 256 FIFO, success-only. Change detection: L0 HTTP / L1 structural / L2 business (JSON-LD types, CTA, contact, socials) → UNCHANGED/COSMETIC/BUSINESS/MAJOR. **JSON-LD parsed for fingerprinting only, not profile metadata.** 16-branch refresh policy (cooldowns 1/3/7d), fail-open. Evidence before AI: page summaries, discovered metadata, fingerprint+change decision, social links, existing profile, bootstrap columns, knowledge version, BFS signals (if run), Wikidata facts (**not wired into refine**).

## 3. Grounding Certification

**No shared grounding pipeline — five distinct mechanisms:** crawl evidence (extraction only, + strategy adds blogs/posts); existing profile (ad-hoc, different shape per caller — marketing/PT/6 chats); KG grounding block ("ALREADY KNOWN"/gap — **define-target-customer only**); companyUnderstanding (Wikidata/Wikipedia; suggest-competitors only; Crunchbase/Bloomberg dark); public signals (context enrichment, no LLM). The extraction prompt receives `_currentProfile` but never uses it. Confidence contributes to grounding only via the KG path (1 of 9 workflows). **Certified: AI endpoints do NOT use the same grounding.**

## 4. AI Workflow Inventory

13 LLM call sites, all via `runCompletionWithOperation` (gpt-4o-mini): evidence cleaning, extraction, missing-field questions, strategy draft, marketing draft, PT refine, 6 define-* chats (define-target-customer KG-grounded; others ad-hoc; define-campaign-purpose self-driven loop), infer-PT, generate-marketing-intelligence, suggest-competitors (companyUnderstanding). Non-LLM (previously assumed AI): language refinement (rules), context enrichment (regex), competitor discovery (SERP+heuristics), classification (rules), KG (derivation), fingerprint/gate (pure).

## 5. Field Generation Matrix

`website_url` Excellent; identity/facts/socials/logo High; engine-path competitors High (chat path Low); strategy fields High (only workflow with a semantic filter); products/audience Medium; industry Medium (classifier override, generic fallback); commercial 7 Medium (chat, **no server-side save validation**, then locked); brand_voice/goals Low (evidence-starved); marketing intel 7 Low (profile-only, no cliché filter, no validation); campaign purpose Low; PT 9 Low (invention-licensed; deterministic fallback fabricates → Very Low).

## 6. Confidence Certification

Calculation sites: `computeConfidenceScore` (12-field weighted 0-100); refine per-field bands; PT uniform 'Medium'; KG `bandToConfidence`; provenance `readAiConfidence` (defaults 'medium'); intelligence readiness; context quality reliability formula; unified-intel per-row. **Seven certified inconsistencies:** (1) key mismatch `company_name`/`unique_value_proposition` vs `name`/`unique_value` — KG nodes permanently 'low'; (2) `business_classification` vs `pricing_model` mismatch; (3) `'Needs Review'` band outside every enum; (4) PT uniformly 'Medium'; (5) monotonic `Math.max` — can never decrease; (6) two duplicate score columns; (7) completeness (presence) vs confidence (bands) unreconciled. Consumers: UI badge; customer-success hard ≥60 threshold in four services.

## 7. Hallucination Prevention Matrix

Safeguards: temp 0 + JSON mode (extraction/PT); no-invent prompts (extraction/MI/competitors — but infer-PT/PT-fill explicitly permit inference); zod (extraction only); Low⇒missing; classifier override; competitor gates (blocklist + product-first + final gate + scrub + read revalidation, no DNS check); user locks; fill-empty; website validation (privileged bypass); strict-JSON retry (PT); grounding/cliché filters (draft-side). **Critical gap:** the define-* chat → client → `POST /api/company-profile` path has **no server-side content validation** — 7 commercial + 7 marketing + 9 PT fields reach the DB exactly as the LLM produced them, laundered as a "user save" that locks them. suggest-competitors validated by prompt only. Thin evidence ceiling (4 pages × 2,000 chars). Confidence-trust soft failure from key mismatches.

## 8. Competitor Intelligence Certification

Sources: stored names, archetype-native seeds, 10 hardcoded creator/media peer packs (no product-SaaS pack), SerpApi Google live (top-5/keyword, geography-appended, budget-gated), geo-filtered known dataset (fallback), user guidance. Ranking: inverse-SERP-position → multi-dimension scoring → product-first tier gate (business-first archetypes, 8 contract tests) → final gate (minScore 42) → market substitutes when no strong ≥70. Geography/industry/business-model aware. Validation: self/platform scrub (write+read), 15-host blocklist, read-time revalidation (re-scoring, no network). **No network identity verification anywhere.** The chat path bypasses the engine entirely.

## 9–11. Goals / Audience / Messaging Certifications

Goals: crawl evidence, shared extraction prompt, zod-only, never lock-listed. Audience: two paths (extraction crawl-grounded; commercial pair via chat, no save validation). Messaging: three paths (extraction; MI draft profile-only no crawl; MI chat), fill-missing merge, `unique_value` carries the key mismatch.

## 12. Intelligence Consumer Matrix

Content/campaigns/mix/recs/reports/trends/engagement/creator consume the whole profile as grounding — inheriting every upstream defect. MarketPulse+recs additionally read intelligence context ungated. Analytics/customer-success/onboarding consume confidence numbers (monotonic-max + band defects propagate).

## 13. AI Duplication Register

Model/temp/JSON call boilerplate ×13; JSON.parse+default per workflow; strict-JSON retry ×2; PT prompt in 3 places; MI 7-field list in 4; coercion helpers ×6; question-flow ×2; audience-led scaffolding ×3; five grounding serializations; two competitor systems.

## 14. Where Incorrect Intelligence Originates

(1) 4-page evidence ceiling; (2) inference-permissive prompts (infer-PT, PT-fill); (3) the unvalidated chat-save path laundering LLM output into locked user truth; (4) competitor chat bypass; (5) confidence contract drift; (6) classifier fallback + user override; (7) staleness windows (no scheduled crawl).

## 15. Final Classification

**Hybrid.** Not AI-Driven — the load-bearing decisions are deterministic (page selection, fingerprinting, change detection, refresh gate, classification overriding AI, competitor engine, enrichment, language refinement). Not Deterministic/Mostly — every substantive value originates from 13 LLM sites. Not Highly Fragmented as primary, though fragmentation is the chief defect within (five grounding mechanisms, ten scaffolds, broken confidence contract, 1-of-6 KG). The control plane is production-grade and cost-disciplined; the AI plane is centrally well-guarded but **peripherally unguarded** (client-mediated chat persistence, prompt-only competitor validation, inference-permissive endpoints) and undermined by a broken confidence contract.

---
**Related:** [AUDIT-002](AUDIT-002.md) · [AUDIT-004](AUDIT-004.md) · [DESIGN-001](DESIGN-001.md) · **Depends on:** AUDIT-001/002 · **Related ADRs:** [ADR-002](../adr/ADR-002-one-trust-engine.md), [ADR-004](../adr/ADR-004-grounding-authority.md), [ADR-005](../adr/ADR-005-universal-validation.md), [ADR-007](../adr/ADR-007-generation-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/AUDIT-003-FULL.md`](../full/AUDIT-003-FULL.md) · **Certification:** Hybrid. See [`../appendices/relationships.md`](../appendices/relationships.md).
