# Appendix — Traceability Matrix

The complete chain from every significant audit finding to the implementation that closes it. **No orphan findings.** This expands the defect-closure ledger in [`certification-history.md`](certification-history.md) into a full trace.

Trace shape:

```
Audit Finding → Design Principle / Invariant → Implementation Program → Certification Gate → Closure Status
```

Status legend: **Closed-by-design** (structurally inexpressible after the phase), **Closed-by-census** (a CI counter enforces it permanently), **Closed-by-gate** (verified at a phase gate).

## A. Ownership conflicts (AUDIT-002 §6)

| # | Finding | Invariant / Principle | Program | Gate | Status |
|---|---|---|---|---|---|
| C1 | 10 write authorities, 2 conventions | P3 / one write authority [ADR-001] | I2A | I2A §14.1 (writer census = 1) | Closed-by-census |
| C2 | 4 grounding authorities | P4/P11 [ADR-004] | I2D | I2D §17.1 (grounding authority) | Closed-by-census |
| C3 | KG vs Canonical Context (competing "what we know") | one knowledge graph [ADR-001/004] | I2A + I2D | I2A §14 + I2D §17 | Closed-by-design |
| C4 | report_settings replace-vs-merge race | merge-only mutations (P3) | I2A | I2A §14 (concurrency) | Closed-by-design |
| C5 | competitors null-then-overwrite | single write path (P3) | I2A | I2A §14.1 | Closed-by-design |
| C6 | confidence key/vocabulary mismatch | P12 / one confidence vocab [ADR-002] | I2B | I2B §16.3 (drift = 0) | Closed-by-gate |
| C7 | classifier overrides user | P8 authority class | I2A | I2A §14 (ownership) | Closed-by-design |
| C8 | phantom locks | P25 real locks | I2A | I2A §14.3 (fail loudly) | Closed-by-design |
| C9 | read initiates write | P2 reads pure | I2D | I2D §17.4 (deterministic/read-only) | Closed-by-design |
| C10 | ungated intelligence channel | P11 [ADR-004] | I2D | I2D §17.3 (bypass = 0) | Closed-by-census |
| C11 | dual notification stacks | P23 one event bus | I2G | I2G §16.6 (ProjectionUpdated sole signal) | Closed-by-design |
| C12 | hand-maintained 96-registry | derived declarations | I2G/I2D | I2G §16.2 | Closed-by-design |
| C13 | conversation-state absent across endpoints | P17 one engine [ADR-006] | I2E | I2E §15.1 | Closed-by-census |
| C14 | tenancy by discipline (no FK, non-isolating RLS) | P21 structural tenancy | all | each tenancy suite | Closed-by-design |

## B. Generation defects (AUDIT-003)

| Finding | Invariant / Principle | Program | Gate | Status |
|---|---|---|---|---|
| Unvalidated chat-save laundered as user truth (§7) | P10/P19 [ADR-005] | I2A + I2D + I2E + I2F | I2D §17.2, I2E §15.6, I2F §16.5 | Closed-by-census |
| 5 grounding mechanisms (§3) | P11 [ADR-004] | I2D | I2D §17.1 | Closed-by-census |
| 13 LLM call sites + 10 scaffolds (§4/§13) | P16 [ADR-007] | I2F | I2F §16.1–4 | Closed-by-census |
| Confidence contract drift: keys, `'Needs Review'`, monotonic-max, dup columns (§6) | P12 [ADR-002] | I2B | I2B §16.3 | Closed-by-gate |
| Competitor chat bypasses the engine (§8) | boundary validation | I2D/I2F | I2D §16 (boundary tier) | Closed-by-design |
| Evidence ignored (`_currentProfile` unused) (§3) | grounding completeness | I2F | I2F §16.6 (grounding mandatory) | Closed-by-design |

## C. Quality defects (AUDIT-004)

| Finding | Invariant / Principle | Program | Gate | Status |
|---|---|---|---|---|
| Evidence unrouted — KG/Wikidata/blogs/BFS/JSON-LD each serve one workflow (§2) | P1/P22 immutable routed evidence [ADR-003] | I2C | I2C §15.4 (complete routing) | Closed-by-design |
| Consistency vacuum — no cross-field checks (§6) | single-graph grounding + Con tier [ADR-004/005] | I2D | I2D §17.6 (Con tier live) | Closed-by-design |
| No production correction-rate loop (§1) | P14 learning contract [ADR-009] | I2H | I2H §16.8 (correction-rate live) | Closed-by-gate |
| Deterministic fabrication — PT boilerplate injector (§7) | P20 no fabrication | I2E + I2F | I2E §15.6, I2F §16 (deleted) | Closed-by-design |
| MI draft: no cliché filter (§4) | P19 Sem tier platform-wide [ADR-005] | I2D/I2F | I2D §17.6 | Closed-by-design |
| Inference-permissive prompts (infer-PT, PT-fill) (§4) | prompt governance (P16) [ADR-007] | I2F | I2F §16.3 (contradictory prompts fail approval) | Closed-by-gate |
| Thin evidence ceiling (4 pages) (§1) | evidence-first routing [ADR-003] | I2C | I2C §15.4 | Closed-by-design |
| Monotonic confidence never degrades (§6) | P12 reversible confidence [ADR-002] | I2B | I2B §16.3 | Closed-by-gate |

## D. Structural / discovery findings (AUDIT-001)

| Finding | Invariant / Principle | Program | Gate | Status |
|---|---|---|---|---|
| 2,384-line god hook + mega-object drilling (§2) | P26 derived projections [ADR-008] | I2G | I2G §16.8 (god hook dissolved) | Closed-by-gate |
| Silent column-drop upsert retry (§8) | P29 no silent data loss | I2A | I2A §14.3 | Closed-by-design |
| 3 dead endpoints (completeness, mission-context, forced-context) (§3) | cleanup | I2G | I2G §16.7 (dead endpoints retired) | Closed-by-gate |
| Read-triggered LLM refine on `getProfile` (§3) | P2 reads pure | I2D | I2D §17.4 | Closed-by-design |
| Split schema sources (`database/*.sql` vs migrations) (§4) | single ordered lineage | I1/WS-0 | GATE-0 (lineage ratified) | Closed-by-gate |
| Unbounded write-only refinements table (§4) | lineage store [ADR-002] | I2B | I2B §16.5 (complete lineage) | Closed-by-design |

## Coverage assertion

Every conflict in the AUDIT-002 register (C1–C14), every generation defect in AUDIT-003 §§3–8, every quality defect in AUDIT-004 §§1–8, and every structural concern in AUDIT-001 §9 maps to at least one program, one invariant, and one certification gate above. **There are no orphan findings** — a finding without a closure row would itself be a governance defect requiring an amendment.

**Related:** [`certification-history.md`](certification-history.md) (verdicts + closure ledger) · [`invariants.md`](invariants.md) (P1–P30) · [`../CONFORMANCE-CHECKLIST.md`](../CONFORMANCE-CHECKLIST.md) (per-PR enforcement) · [`../dependency-manifest.yaml`](../dependency-manifest.yaml) (census rules).
