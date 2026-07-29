# COMPANY-UNDERSTANDING-DECISION-001 — Interpretive Identity Fields Policy

**Type:** Product / architecture decision (no engineering) · **Role:** Chief Product Architect
**Date:** 2026-07-29 · Context: unblocks COMPANY-UNDERSTANDING-IMPLEMENTATION-001 U5

---

## Decision Matrix

| Field | Policy | One-line reason |
|---|---|---|
| **business_model** | **B — Evidence Expansion** | Correctness-critical (the original defect field) and grounded in observable site signals (pricing / CTA / sales-motion). |
| **provider_type** | **B — Evidence Expansion** | Drives competitor product-vs-service classification (the defect area); observable from offering/site structure. |
| **solution_domains** | **B — Evidence Expansion** | Consumed by Market-Pulse alignment scoring + competitor domain signals; derivable from grounded offerings. |
| **operating_model** | **A — Canonical Abstention** | Narrative/synthesized descriptor, largely redundant with category + business_model; soft prompt framing only. |
| **domain_role** | **A — Canonical Abstention** | Vague role phrase; legacy output was generic/low-signal; redundant with category + market positioning. |

**No field selects C (Decommission)** now — abstention keeps the two low-value fields NULL-tolerant without a
consumer redesign, and is reversible; decommission stays available later if they prove entirely unused.

---

## Rationale

The five fields split cleanly along **evidence-groundability × product value**:

**B — the three correctness-critical, genuinely-groundable fields.** `business_model`, `provider_type`, and
`solution_domains` are exactly where the program's thesis pays off. Each is (a) observable in grounded
website/offering evidence — sales-motion/pricing/CTA reveal business model; product-vs-service-vs-agency-vs-
media structure reveals provider type; the offering set reveals solution domains — and (b) consumed for
*correctness* (competitor affinity/classification, Market-Pulse domain alignment). These are the fields whose
*wrong* legacy values caused the Embro/Omnivyra defects. Abstaining them (NULL) would degrade competitor
intelligence and Market Pulse precisely where the program set out to improve them; decommissioning them would
throw away real signal. The right answer is to ground them in evidence — the program's whole point.

**A — the two narrative descriptors.** `operating_model` and `domain_role` are synthesized positioning
phrases, largely re-expressible from `category` + `business_model`, used only as soft framing in prompts. Their
legacy keyword output was generic ("AI-powered problem-solution provider") and low-signal. They have weak
independent evidence basis, so grounding them (B) is low-value effort, and their consumers tolerate NULL by
falling back to category/business_model. Canonical abstention is architecturally pure, deterministic, and
low-disruption (no schema/consumer redesign). If usage analysis later shows they add nothing, revisit as C.

**Governing principle preserved:** heuristics remain prohibited in all cases. B populates only from approved
grounded evidence; A represents "unknown" honestly. No field is ever fabricated.

---

## Affected Consumers

| Field | Consumers that read it |
|---|---|
| business_model | Market Pulse (executor context + scoring), Competitor Intelligence (affinity scoring), Content Architect (long-form business identity) |
| provider_type | Competitor Intelligence (product-vs-service classification), Market Pulse |
| solution_domains | Market Pulse (domain alignment scoring), Competitor Intelligence (discovery domain signals) |
| operating_model | Market Pulse (identity prompt line), Content Architect (long-form operational model) |
| domain_role | Competitor Intelligence (domain signals), Market Pulse (identity prompt line) |

---

## Migration Impact

- **B fields (business_model, provider_type, solution_domains):** **no consumer change** and **no regression**
  in the interim — they stay populated by the legacy classifier until the evidence source ships, then switch to
  evidence-backed values. Shipping the evidence source is the **prerequisite** for retiring
  `classifyCompanyBusiness` (which sources them via `business_classification.level_1/2/3`),
  `inferCompanyDomainShape`, and `inferBusinessModelLabel`.
- **A fields (operating_model, domain_role):** consumers must become **NULL-tolerant** — a small hardening
  (fall back to category/business_model; omit the prompt line when null), **not** a redesign. Once tolerant,
  the classifier output for these two can be retired (they abstain).
- **Sequencing consequence:** because `inferCompanyDomainShape` produces both A-fields and (a fallback for)
  B-fields, and `classifyCompanyBusiness` produces the B-fields via `level_1/2/3`, **no interpretive-field
  classifier can retire until the B evidence source ships.** The A-fields' classifier output retires with the
  same family once B lands.

---

## Required Implementation (specification only — not authorized here)

1. **Evidence-Expansion phase (prerequisite for U5 Stage B, Families 1–3):** extend the existing grounded
   `profileExtraction` to additionally extract **business_model**, **provider_type**, and **solution_domains**,
   grounded strictly in website/offering evidence (no keyword ladders). Surface them as `ai_generated` evidence
   through the U1 AI-extraction adapter (add `businessModel` + `providerType` slots; `solutionDomains` already
   exists). Weight/kind unchanged; abstain when the site gives no signal.
2. **A-field NULL-tolerance hardening:** Market Pulse executor context + Content Architect long-form + any UI
   that renders operating_model/domain_role tolerate NULL (fallback/omit).
3. **Then** U5 Stage A (authoritative activation + live parity) and Stage B (retire families) proceed as
   already specified.

No heuristic recreation. No fabrication. Unknown remains unknown until evidence exists.

---

## Verdict

# APPROVED

**Policy set:** business_model = **B**, provider_type = **B**, solution_domains = **B**, operating_model = **A**,
domain_role = **A**. This is the architectural policy of record; it authorizes the Evidence-Expansion phase to
be *scoped* (implementation still requires its own authorization) and defines the A-field abstention contract.
