# Appendix — AI Workflow Catalog

Every AI generation workflow, consolidated from the certified 13 hand-rolled call sites (AUDIT-003 §4) into the registered workflow set (IMPLEMENTATION-002F §4). After Phase 6, no LLM call exists outside this registry (P16).

Each workflow declares: consumer, grounding profile, validation profile (with determinability class per output field), model policy, retry policy, output contract. All execute through the one Generation Runtime (I2F §5), consume a Grounding Context (P11), and require a ValidationPassed token before their output becomes fact-mutation basis (P19).

## Registered workflows

| Workflow | Purpose | Output fields (determinability) | Grounding |
|---|---|---|---|
| **Profile extraction** | Extract fields from crawl evidence | name (observable), products/audience/voice/goals/unique_value/themes (observable→interpretive) | crawl evidence + archetype/pack; **existing profile now grounded** (fixes A4 §2) |
| **Evidence cleaning** | Strip nav/UI text pre-extraction | cleaned evidence | raw crawl evidence |
| **Missing-field questions** | Generate a scoped questionnaire | questions (bounded, allow/block filtered) | extraction output |
| **Strategy draft** | Worldview/differentiation/focus | strategy fields (interpretive) | crawl + blogs + posts + pack (the reference cliché-filtered workflow, A4 §4) |
| **Marketing intelligence** | Channels/positioning/messages | 7 marketing fields (interpretive) | profile + pack; **now Sem-validated** (fixes A4 §4) |
| **Problem transformation** | 9 PT fields | PT fields (interpretive) | profile + Q&A + pack; **boilerplate fallback deleted** (P20, A4 §7) |
| **Competitor suggestion** | Direct same-category competitors | competitors (deterministic gate) | companyUnderstanding (Wikidata/Wikipedia via Evidence) + profile |
| **Content context** | Grounding for content generation | content context | full grounding (via buildContentContext, re-seated) |
| **Campaign purpose** | campaign_purpose_intent | purpose (user via conversation) | profile; **engine-governed questioning** (fixes A4 §4 self-loop) |
| **Audience** | target_audience / commercial pair | audience fields (interpretive/user) | profile + KG grounding |
| **Messaging** | key messages / positioning | messaging fields (interpretive) | profile + competitor facts (consistency-checked) |
| **Content generation** (all formats) | Blogs/posts/threads/newsletters | content | full grounding |
| **Recommendations** | Actionable proposals | recommendations (derived) | full graph + market intelligence |
| **Future workflows** | — | declared at registration | declared |

## Governance summary (I2F §5–8)

- **Prompts** are registered, versioned, approval-gated assets. A prompt with a contradictory evidence stance (the certified "grounded only" vs "typical for that industry" conflict, A4 §4) **fails approval**. Zero inline prompts remain.
- **Models** are a registered set with routing/fallback/rollback; per-call `OPENAI_MODEL` reads eliminated.
- **Evaluation** — the offline LLM-judge bench (A4 §1) is the standing gate: every prompt/model version promotion requires a bench pass at or above the recorded per-workflow baseline.
- **Cost** — every run records cost; cost policies govern every stage (P24).
- **Industry Packs** supply per-industry vocabulary/frames/topology as data (not prompts); pack selection is owned by the Knowledge classifier, consumed by Generation.

## Determinism boundaries (I2F §7)

- **Observable fields:** extract-or-null; a claim without evidence linkage is a validation failure, not a low-confidence result.
- **Interpretive fields:** inference permitted, always labeled, capped below confirmed confidence.
- **Deterministic logic never fabricates** (P20) — the PT fallback injector is deleted.
