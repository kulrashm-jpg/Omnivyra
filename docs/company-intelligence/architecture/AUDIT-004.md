# COMPANY-PROFILE-AUDIT-004 — Company Intelligence Quality & Accuracy Certification

**Scope:** Read-only quality audit. Builds on AUDIT-001/002/003. Certifies how good the generated intelligence is and where it degrades.

**Classification: Moderate.**

---

## 1. Intelligence Quality Architecture

Quality is produced and lost at four planes: **Evidence** (4 pages × 2,000 chars — a hard ceiling); **Generation** (13 LLM sites, temp 0–0.3, varying evidence discipline); **Filter** (one real cliché blocklist [strategy only], classifier override, competitor gates — strong but unevenly applied); **Measurement — effectively absent for correctness.** The Phase-1 quality gates (bfaa3778) are long-form publishing gates that never touch profile AI. The capability-validation "hallucination check" is a non-empty-payload check; most profile capabilities have grounding/hallucination checks disabled. Shadow mode measures canonical-vs-legacy divergence, not correctness. The only factual-quality judge (LLM-judge with `factualCorrectness`/`hallucination`) is offline lab scaffolding. **No production ground-truth or correction-rate loop** — `company_profile_refinements` and `company_context_review_events` persist the raw material for one but nothing analyzes it.

## 2. Evidence Coverage Matrix

Certified: the system's best evidence is systematically unavailable to most generators. Crawl summaries → extraction + strategy only. JSON-LD → fingerprinting only. Existing profile → passed to extraction as `_currentProfile`, unused. Historical content (blogs/posts) → strategy draft only. KG → define-target-customer only. Wikidata/Wikipedia → suggest-competitors + facts-lookup only. BFS crawl (250 pages) → context enrichment only. **Four high-value grounding assets each serve exactly one workflow or none.**

## 3. Field Quality Matrix

**Excellent:** website_url. **High:** name, logo/favicon/country/socials, company facts (Wikidata + review), engine-path competitors, strategy fields (richest grounding + the only semantic filter). **Medium:** products_services, target_audience, unique_value (broken confidence key), industry/category (classifier override + generic fallback), commercial 7 (chat, zero save validation, then locked). **Low:** brand_voice, goals (evidence the base can't support), marketing intelligence 7 (profile-only grounding, no cliché filter, no save validation), campaign_purpose (unguarded loop), problem/transformation 9 (invention-licensed; fallback output **Very Low**).

## 4. Prompt Quality Certification

Strong: strategy (only real cliché blocklist `containsMeaningfulSignal`), missing-field questions (allow/block filter), suggest-competitors (hard exclusion list), define-context-intelligence (temp 0, deterministic reconstruction), extraction (self-labeling + null-on-missing). Weak (ranked by hallucination likelihood): (1) infer-PT (internally contradictory: "grounded only" vs "typical for that industry"); (2) define-problem-transformation ("MUST propose an improvement each turn" + `deterministicRefineFallback` injects identical boilerplate per company); (3) PT fill mode; (4) marketing intelligence draft (soft "prefer specific" only, no output filter, full-profile dump); (5) define-campaign-purpose (no anti-invention, model-driven loop). Certified pattern: anti-hallucination discipline is inversely correlated with field abstraction.

## 5. Grounding Quality Certification

Completeness: no workflow gets complete grounding. Missing: MI draft + 5 of 6 chats operate with no primary evidence (AI grounded in prior AI). Duplicate: five parallel serializations. Inconsistent: dedup grounding (KG) in 1 of 6 chats; marketing chat passes only 3 of 7 commercial fields. Stale: 7-day gate + cooldowns + no scheduled crawl; all chat grounding reads with autoRefine:false. **Better grounding exists but unused:** KG (1/6), Wikidata/Wikipedia (competitors only), blog/post corpus (strategy only), 250-page BFS (enrichment only), JSON-LD types (fingerprint only).

## 6. Intelligence Consistency Certification

The same company can produce divergent intelligence with no detection. Strategy and marketing drafts run in one `Promise.all`, never seeing each other; reconciliation is fill-if-empty union. Industry consistency relies on a single advisory conflict flag. **Zero cross-field enforcement** for audience↔voice, PT↔messaging, competitors↔positioning. Cross-chat consistency exists only where the KG is wired (1 endpoint). Confidence consistency broken by construction (4 mismatches).

## 7. Deterministic Quality Certification

Net-positive — the system's main defense. Improves: refresh gate, `containsMeaningfulSignal`, generic-industry stripper, creator-contamination guard, competitor gates. Dual-edged: classifier override (vs AI good, vs user bad; generic fallback). **Reduces quality (three cases):** the PT deterministic fallback (fabricates company-agnostic content — the one case of deterministic logic writing wrong intelligence); monotonic confidence (`Math.max` — never reflects degradation); classifier-vs-user override.

## 8. Intelligence Loss Register

Crawl (JS-rendered invisible, pages >4 unread, empty `headings`, 2,000-char truncation, 17-keyword filter); JSON-LD (parsed then hashed); cleaning (LLM deletes evidence, unlogged); prompt construction (≤40 cap, existing profile discarded); serialization (each chat a different subset, 4 of 7 commercial fields never cross to marketing); normalization (caps, <3-word rejection); confidence (wrong keys unreadable, `'Needs Review'`→low, PT flattened); persistence (silent column drop, report_settings full-replace); downstream (**refinement audit + review events persisted but never analyzed — the only ground-truth signal collected and discarded**).

## 9. Consumer Quality Matrix

Content generation (whole profile via buildContentContext) is the highest-volume amplifier of the weakest fields (voice, goals, key_messages). Campaigns/BOLT build on the two least-validated groups (purpose, PT). Customer-success keys decisions to a monotonic, band-broken confidence. Strongest upstream inputs: website, identity, facts, engine competitors, strategy. Weakest: marketing intelligence, PT, goals, brand voice, campaign purpose — precisely what content generation leans on hardest.

## 10. Intelligence Accuracy Scorecard

| Dimension | Score |
|---|---|
| Evidence Quality | 4/10 |
| Grounding Quality | 5/10 |
| Prompt Quality | 6/10 |
| AI Output Quality Controls | 6/10 |
| Deterministic Quality | 8/10 |
| Validation Quality | 4/10 |
| Consistency | 3/10 |
| **Overall Intelligence Quality** | **5/10** |

## 11. Final Classification

**Moderate.** Bimodal by field tier. Reliable: website/identity, deterministic crawl facts, Wikidata facts, engine-path competitors (only AI-adjacent subsystem with contract tests), strategy fields (rich grounding + semantic filter). Weak: the entire marketing-intelligence tier, problem/transformation (invention-licensed + boilerplate fallback), goals and brand voice (evidence the base can't support), campaign purpose. **Three structural causes:** (1) evidence starvation with abundance nearby (rich assets one import away, each serving one workflow); (2) quality machinery real but misallocated (cliché filter on one workflow, dedup on one endpoint, contract tests on competitors/confidence, publishing gates on blogs — the highest-hallucination fields have the least of all four); (3) nothing measures correctness (shadow measures divergence, adoption measures migration, context quality measures completeness; the correctness judge is offline; the collected ground-truth signal is discarded). Not "Weak" — the deterministic backbone, reliable-field tier, historical-failure guards, and strategy workflow prove the platform can produce high-quality intelligence. Not "Good" — the weak tier is the marketing/PT/purpose layer content generation depends on most, the chat-save path launders unvalidated output into locked truth, and no production mechanism can detect any of it.

---
**Related:** [AUDIT-003](AUDIT-003.md) · [DESIGN-001](DESIGN-001.md) · **Depends on:** AUDIT-001..003 · **Related ADRs:** [ADR-003](../adr/ADR-003-immutable-evidence.md), [ADR-005](../adr/ADR-005-universal-validation.md), [ADR-009](../adr/ADR-009-learning-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/AUDIT-004-FULL.md`](../full/AUDIT-004-FULL.md) · **Certification:** Moderate. See [`../appendices/relationships.md`](../appendices/relationships.md).
