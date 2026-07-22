# Appendix — Glossary

Canonical terms for the Company Intelligence Platform. Definitions are binding; use these terms with these meanings across code, docs, and PRs.

| Term | Definition |
|---|---|
| **Bounded context** | One of the six ownership domains: Identity, Evidence, Knowledge, Trust, Generation, Distribution. Each has one owner and one write authority. |
| **Company** | Tenant root; binds identity, domains, and industry-pack selection. |
| **Evidence Object** | An immutable, attributed, versioned observation from any source (crawl page, JSON-LD, blog, social, document, user input, conversation turn, generation output, external knowledge, analytics signal, connector payload). |
| **Observation** | A typed extraction from an Evidence Object (e.g., JSON-LD product entries). Immutable; re-extraction creates a new version. |
| **Fact (Knowledge Node)** | A typed assertion about the company with state, confidence, and lineage. Append-only versioned. |
| **Fact state** | unknown → inferred → observed → confirmed, plus corrected, contradicted, proposed. |
| **Inference** | A derived Fact *candidate* produced by AI or rules, pending validation/review. |
| **Insight** | A synthesized cross-fact interpretation (e.g., strategy worldview) that becomes a Fact on acceptance. |
| **Determinability class** | A field's nature: *Observable* (evidence-attested), *Derivable* (rule/AI-derived), *Interpretive* (AI-assisted, inference-labeled). Sets validation strictness and confidence ceiling. |
| **Authority class** | A field's ownership: *User* (locked on edit), *Evidence-authoritative*, *Derived-Deterministic*. Resolves every "who wins" conflict. |
| **Confidence composite** | The single trust value per Fact version, computed from five dimensions: evidence, generation, deterministic, review, freshness. Reproducible; reversible. |
| **Provenance** | The immutable per-version record: source, generator, grounding ref, reviewer, actor, timestamp, lineage. |
| **Lineage** | The derivation graph — which parent Fact versions and evidence a fact derives from. |
| **Grounding Context** | The versioned, deterministic input assembled for an AI workflow: knowledge, evidence, constraint, and gap sections. |
| **Grounding Authority** | The single runtime that assembles Grounding Contexts. No AI workflow grounds any other way (P11). |
| **Constraint section** | The "already-known / never-ask / locked / contradicted / below-floor" part of a Grounding Context (the KG block generalized). |
| **Gap section** | The ranked unknown-but-valuable facts a Grounding Context exposes (drives conversation questioning). |
| **Validation Pipeline** | The single runtime issuing ValidationPassed/Failed tokens. Tiers: schema, semantic, consistency, boundary, ownership, confidence, freshness, completeness, explainability, consumer-contract. |
| **Projection** | A derived, materialized, versioned read model over Facts+Trust, serving display/report/analytics/UI. Never hand-edited (P26). |
| **Consumer Profile** | A consumer's declaration: required/optional knowledge, confidence floor, freshness tolerance, fallback, explainability duty. |
| **Conversation mode** | A question-domain configuration of the one Conversation Engine (onboarding, refinement, marketing, context, campaign-purpose, PT, competitor). |
| **Workflow (generation)** | A registered AI operation with a prompt version, model policy, grounding profile, validation profile, retry policy, and output contract. No LLM call exists outside one (P16). |
| **Industry Pack** | A declarative, versioned data asset supplying per-industry vocabulary, goal/KPI frames, competitor topology, and evidence expectations. Content, not code. |
| **Learning Signal** | An immutable observation of a correction, acceptance, rejection, failure, or outcome, feeding calibration. |
| **Calibration** | A *recommended* parameter adjustment (confidence, selection weight, retry, question rank). Learning recommends; the owning context adopts through governance. |
| **Shadow mode** | New path computes, legacy path serves; divergence recorded. The mandatory pre-enforcement stage. |
| **Enforce** | New path serves authoritatively; legacy dormant. |
| **Census (CI)** | A permanent conformance counter (writers, bypasses, direct reads, unregistered LLM calls, unmanaged learning) that must hold at target. |
| **Strangler pattern** | Standing up a new seam beside legacy, migrating callers one at a time, retiring legacy at zero callers. |
| **Feature-complete** | Built and passing suites in shadow; no production behavior changed. |
| **Production-ready** | Enforced per-tenant with gate green, rollback demonstrated, observability live. |
