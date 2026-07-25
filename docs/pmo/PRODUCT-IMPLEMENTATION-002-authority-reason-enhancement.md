# PRODUCT-IMPLEMENTATION-002 — Authority Reason Narrative Enhancement (D′)

**Assigned:** Agent 2 · **Authority:** PRODUCT-QUALITY-001 + PRODUCT-IMPLEMENTATION-001 · **Priority:** High.
**Type:** product enhancement — D′ only. **Date:** 2026-07-22. **Status:** complete, **uncommitted**.

---

## 1. Executive summary

`authority_reason` is now **recommendation-aware**. It previously ignored the recommendation topic —
despite already receiving it as a parameter — and alwayas emitted `authority_domains[0]`, producing the
identical sentence on every card of a company. D′ selects the authority domain most relevant to the
topic (deterministically, with stable-hash tie-breaking) and anchors the sentence to that topic.

Measured on the canonical 60-profile / 300-card corpus: distinct-value ratio **0.30 → 0.40**, domain
**relevance 33/33 = 100%**, grounding **100%**, determinism **absolute**. The PRODUCT-IMPLEMENTATION-001
compatibility harness is **13/13 green and unmodified** — no contract was weakened, no downstream
behaviour changed.

This is the smallest behavioural change in the roadmap, executed under the guard rails built for it.

## 2. Files modified

| File | Change |
|---|---|
| `backend/services/strategicRecommendationIntelligenceService.ts` | **the only product change** — RULE D → D′ (`selectAuthorityDomain` + topic anchor), plus a header note recording the authorized deviation |
| `backend/tests/unit/strategicRecommendationIntelligenceRestore.test.ts` | one pinned assertion updated (authorized behavioural change) + **6 new D′ tests** |

**Untouched and verified:** the compatibility harness, `gap_being_filled`, `why_now`,
`campaign_angle`, `problem_being_solved`, `expected_transformation`, Planner, recommendation
sequencing, the validator, and the feature flag. No new flag, no new configuration.

## 3. D′ implementation

```ts
selectAuthorityDomain(domains, topic):
  single domain            → that domain                      // strict generalization of domains[0]
  score = token overlap(domain, topic) for every domain
  keep the highest-scoring set
  one winner               → it
  tie (incl. all-zero)     → tied[stableHash(topic) % tied.length]

buildAuthorityReason:
  null conditions UNCHANGED (not authority-elevated, or no usable domains)
  → "Company has credibility in {domain} — directly relevant to {topic}."
  → "Company has credibility in {domain}."        when no topic is available (historical verbatim)
```

Design fidelity notes:
- **Every domain is evaluated**, not just `[0]` — the historical rule's blind spot.
- **Deterministic throughout**: token overlap, then a stable FNV-style hash. No `Math.random`, no clock,
  no ambient state.
- **Wording preserved where possible**: the historical stem `Company has credibility in {domain}` is
  intact, and when no topic exists the output is byte-identical to the historical sentence.
- **Single-domain companies are a strict generalization** — the sole domain always wins, so selection
  behaviour is unchanged; only the topic anchor differs.

## 4. Compatibility results (Phase 3)

| Contract (PRODUCT-IMPLEMENTATION-001) | Result |
|---|---|
| `campaign_angle` token (`"Conversion"` iff diamond) | ✅ green |
| Angle classification (no trigger tokens; all `analytical`) | ✅ green |
| Execution-stage parity vs pinned reference | ✅ `{education:60, authority:60, conversion:60}` — **identical** |
| `authority_reason` nullability | ✅ green (`nullCases + valueCases = 300`) |
| Determinism (5 runs: values, hash, ordering) | ✅ green |
| Schema / serialization (keys, order, nullability, round-trip) | ✅ green |
| **Suite** | **13 / 13 passing, harness file unmodified** |

No assertion was weakened, relaxed, skipped, or re-pinned in the harness.

**Why this was safe to change:** verified before implementing that **no consumer pattern-matches
`authority_reason` content** — every consumer reads only presence/nullability (`hasAuthorityReason`
drives the `authority` execution stage). Wording is therefore free; nullability is load-bearing and is
preserved exactly.

## 5. Corpus measurements (Phase 4)

Canonical 60-profile / 300-card corpus (reused from the harness — the first dividend of building it):

| Metric | Before (legacy rule D) | After (D′) |
|---|---|---|
| `authority_reason` distinct-value ratio | **0.30** | **0.40** |
| Domain relevance (matching domain chosen when one exists) | n/a — always `domains[0]` | **33 / 33 = 100%** |
| Factual grounding | — | **100%** |
| Determinism (3 full-corpus runs → distinct hashes) | — | **1** |
| Non-null authority cards | 60 | 60 (unchanged — nullability preserved) |

**An honest measurement caveat.** A multi-domain corpus variant produced the *same* 0.40 ratio. That is
not a null result — it is metric saturation: only 2 of 5 cards per company are authority-elevated, so
once the topic anchor makes those two distinct, distinctness cannot rise further regardless of how many
domains exist. Distinct-ratio therefore **cannot** demonstrate domain-selection value. The **relevance
metric (100%)** is the correct measure of D′'s selection benefit, corroborated by targeted unit tests
(topic "Content Strategy Playbook" → *content strategy*; "Pricing Science Benchmarks" → *pricing science*).

## 6. Regression analysis (Phase 5)

| Check | Result |
|---|---|
| Recommendation sequencing | **Unchanged** — stage distribution identical to the pinned reference |
| `campaign_angle` | **Unchanged** — not touched; harness contract green |
| Validator compatibility | **Unchanged** — `strategicContentTransformationValidator` suite green; `authority_reason` still contributes a weight-4 signal (content changed, scoring semantics did not) |
| Planner compatibility | **Unchanged** — `plannerStrategicCard.ts` not touched, and it does not emit `authority_reason` at all |
| Producer suite | **17 / 17** (11 original + 6 new D′) |
| Historical enrichment suite | **green, unmodified** — its `toContain('credibility')` / `toContain('saas positioning')` assertions still hold by design |
| Wider sweep | **140 / 148**; the 8 failures are the *identical* pre-existing set — 3+2 Supabase-mock engine suites (proven pre-existing in PRODUCT-RESTORE-001 by reverting to HEAD) and 3 mission-context DB failures. **Zero new failures.** |
| Typecheck | producer compiles clean; no new errors |

**One assertion was intentionally updated**, and it is worth being explicit about: my own
`strategicRecommendationIntelligenceRestore` test pinned the full historical intelligence object,
including `authority_reason: 'Company has credibility in content strategy.'`. D′ changes that string by
design, so the expectation was re-pinned to the new value and the test retitled to
*"rules A/B/C/E/F exactly (D → D′)"*. The other five exact assertions are untouched. This is a
**re-pin of an intentionally changed value, not a weakened contract** — and it is in the producer's own
behavioural suite, never in the compatibility harness.

## 7. Risks

| Risk | Level | Note |
|---|---|---|
| Wording change breaks a consumer | **None identified** | verified no consumer matches `authority_reason` content; only presence is consumed |
| Stage assignment drift | None | nullability preserved exactly; harness parity contract green |
| Non-determinism via tie-breaking | None | stable hash, no RNG; proven over 3 corpus runs + 5-run harness check |
| Longer sentence in constrained UI | Low | the card UI renders `authority_reason` as a free-text row with no length cap; the field was already free-text |
| Multi-domain relevance untested in prod data | Low | corpus profiles are synthetic; selection logic is proven by unit tests and a 100% corpus relevance rate |

## 8. Final certification

**PRODUCT-IMPLEMENTATION-002 COMPLETE — AUTHORITY REASON ENHANCEMENT DELIVERED.**

`authority_reason` is recommendation-aware; determinism is preserved; the compatibility suite is fully
green and unmodified; no downstream behavioural change occurred (stage distribution, angle
classification, schema and serialization all identical); measured narrative diversity improved
(0.30 → 0.40) with 100% domain relevance and 100% grounding; and no regressions were introduced —
the only failing tests are the byte-identical pre-existing set. Only D′ was implemented.
