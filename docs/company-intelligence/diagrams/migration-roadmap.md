# Diagram — Migration Roadmap

The eight-phase migration sequence with gates, flag ladders, and release milestones. Derived from IMPLEMENTATION-001 §6/§16 and IMPLEMENTATION-003 §3/§6.

## The eight phases

```
PHASE 0  FABRIC & BASELINE      [low risk · additive]
   ▼ GATE-0  events verified · baseline live · schema lineage ratified · writer census installed
PHASE 1  OWN THE WRITES         [CRITICAL · master gate]
   ▼ GATE-1  writer census = 1 · overwrite = 0 · chat-save validated              ── M1
PHASE 2  OWN THE TRUST  ∥  PHASE 3  OWN THE EVIDENCE   [medium · parallel]
   ▼ GATE-2  one confidence engine · drift = 0 · reproducible
   ▼ GATE-3  one evidence layer · immutable · routed · SSRF ok                      ── M2
PHASE 4  OWN GROUNDING + VALIDATION   [medium-high · convergence]
   ▼ GATE-4  one grounding authority + one validation pipeline · bypass = 0         ── M3
PHASE 5  OWN CONVERSATIONS  ∥  PHASE 6  OWN GENERATION  [medium · parallel]
   ▼ GATE-5  one engine · zero duplicate questioning · no unvalidated persistence
   ▼ GATE-6  one runtime · zero inline prompts/direct model calls · bench-gated     ── M4
PHASE 7  OWN THE CONSUMERS      [medium-high · frontend last, per-section]
   ▼ GATE-7  one projection runtime · direct-read census = 0 · frontend dissolved   ── M5
PHASE 8  CLOSE THE LOOP         [low · terminal]
   ▼ GATE-8  one learning runtime · zero unmanaged learning · correction-rate live  ── M6
           →  CONSTITUTION IN FORCE
```

## The flag ladder (every cutover)

```
off  ──▶  shadow  ──▶  compare  ──▶  enforce  ──▶  legacy-retired
 │         │            │            │              │
byte-    new path     new serves    new is        old path
faithful computes,    read-only     authorit-     deleted
legacy   legacy       w/ auto-      ative;        after
         serves;      fallback      legacy        sunset
         divergence                 dormant
         recorded
```

- **Shadow before enforce is mandatory.** The "unauthorized overwrite must be 0" law gates every write-side enforcement.
- **Enforcement is per-tenant:** internal → beta → cohorts → all. Protected production tenants move last, always after a demonstrated rollback.
- **Percentage rollout** is allowed within a tenant for read flips only — never for writes (all-or-nothing to avoid split-brain).

## Release milestones

| Milestone | Reached at | Meaning |
|---|---|---|
| **M0** | GATE-0 | Platform can measure itself and route events |
| **M1** | GATE-1 | Ten-writer surface replaced; chat-save gap closed |
| **M2** | GATE-2 ∧ GATE-3 | Confidence reproducible; evidence routed |
| **M3** | GATE-4 | Five grounding mechanisms → one; validation universal |
| **M4** | GATE-5 ∧ GATE-6 | Conversations unified; generation governed |
| **M5** | GATE-7 | Zero direct reads; frontend consolidated |
| **M6** | GATE-8 | Platform self-measuring; constitution in force |

## Rollback checkpoints

Every phase reverts by flag re-point; no phase performs a destructive data operation while its predecessor is within the rollback window. Each critical phase (1, 2, 4, 7) must **demonstrate** an exercised rollback in a pre-production tenant before enforcing. Append-only history (facts, evidence, trust, transcripts) makes every rollback data-safe by construction.

## Risk-driven sequencing

| Risk | Sequencing response |
|---|---|
| R1 unknown 11th writer (Critical) | Phase-0 static writer census *before* any Phase-1 cutover |
| R4 frontend destabilization (High) | frontend is Phase 7, last, per-section, beta-first |
| R10 schema/environment drift (High) | Phase-0 schema-lineage audit before write work; silent column-drop instrumented to error in Phase 1 |
| R8 partial-adoption plateau (High) | census gates *require* zero-bypass, not progress — no phase closes with stragglers |
