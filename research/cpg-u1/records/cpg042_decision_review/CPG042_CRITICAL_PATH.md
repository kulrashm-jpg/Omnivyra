# CPG-042 — Critical Path (post-decision-review)

**Current state (verified):**
- Protocol-003 is implemented but must not be registered as-is (integrity issues B-1 and B-2).
- Tooling v3 is aggregate `572452e1…1b5`.
- No identity, custodian, outpoint, registration, personnel, frame, seed or experiment exists.

## Does anything in A / B / D block external registration?

| Item | Blocks registration? | Why |
|---|---|---|
| **B-1, B-2** | **YES** | Integrity: the registered protocol must not permit outcome-dependent frame composition or post-pilot registry steering |
| **A-1…A-6** | **YES** (text only) | The registration binds the protocol hash; the personnel and blinding rules must be in the registered text |
| **X-1** (private preview / execution timing) | **Decision required before registration** | A rule, if adopted, must be in the registered text; if rejected, it must be declared as a limitation |
| **T-1…T-3 tooling enforcement** | Only if adopted | Any tooling change alters the registered aggregate, so it happens before registration or not at all |
| **D-1** | No | Naming convention for future documents |
| **D-2, D-3, D-4** | No | Separate future studies (DT-U8/CPG-U8, U9, DT-U4); CPG-U1 already captures what §16.2 needs |

## Sequence

```
PHASE 0 — decisions & text (no people named, no publication, no funding)
  0.1 Approve CPG-042 amendment wording (A-1…A-6, B-1, B-2; optional D-1 editorial)
  0.2 Decide X-1 (execution-window / no-preview rule: adopt or declare as limitation)
  0.3 Decide tooling enforcement T-1…T-4 (adopt → implement + tests + mutations + clean rebuild; or outsider-verified)
  0.4 Produce CPG_U1_PROTOCOL_004.md (new file; protocol-003 untouched)
  0.5 Owner decisions already open: asOf; provider configuration hash (read-only computation)
        ─────────────► protocol-004 hash + tooling aggregate FINAL
PHASE 1 — named people (parallel)
  1.1 Key custodian (= operator)          1.2 Accountable OSF identity + PID
  1.3 Enumerator(s) under §4A             1.4 Author, Confirmer, reference adjudicator under §4A
  1.5 Rater 1, rater 2, rating adjudicator under §4A (label assignment recorded later, before held-out commitment)
PHASE 2 — Bitcoin funding (needs 1.1)
  2.1 Create O_dev, O_ho (P2WPKH); ≥ 6 confirmations; choose checkpoint
PHASE 3 — external publication (needs 0.4, 1.2, 2.1)
  3.1 PUBLIC OSF registration of protocol-004 (no embargo)
PHASE 4 — independent dataset construction (needs 3.1, 1.3)
  4.1 Enumerate the COMPLETE frame F; frame; scan (registered registry)
  4.2 Verify frame sufficiency E ≥ 126 / 52 / 32 (else enumerate more — before any commitment)
PHASE 5 — commitments & draws (needs 4.2)
  5.1 Development commitment → +12 blocks, depth 6, drand R_dev ≥ 3 h → development draw
  5.2 Pilot + instrument check (needs harness + certenv) → sizing (size only)
  5.3 Record rater label assignment fingerprint (1.5)
  5.4 Held-out commitment (same F, registered registry; after development finality) → R_ho → held-out draw
PHASE 6 — reference truth (needs 5.4, 1.4)
  6.1 Blind Author + Confirmer records (both stages) → blinded adjudication (A-2 packet) → reconcile → seal → publish seal hash
PHASE 7 — U1 experiment (needs 6.1, harness, certenv)
  7.1 Held-out execution once (subject to X-1 decision) → archive
  7.2 Rating in derived order (A-3) → blinded rating adjudication (A-4) → α → analysis → outcome vocabulary
```

## Prerequisites by category

| Category | Items | Can start |
|---|---|---|
| **Pursue immediately** | 0.1–0.5 (decisions, protocol-004 drafting after approval, tooling decision); harness and certenv engineering (separate authorised task); instruction packs; D-2/D-3/D-4 decisions and future U4/U8/U9 protocol design; Q2 evidence (CPG-041P C) | **Now** |
| **Require named people** | 1.1 custodian; 1.2 identity + PID; 1.3–1.5 independent personnel (recruitment can begin now; materials only per §4A) | Recruitment now; assignment on approval |
| **Require external publication** | 3.1 registration | After 0.x, 1.2, 2.1 |
| **Require Bitcoin funding** | 2.1; also 3.1 (outpoints named) | After 1.1 |
| **Require independent dataset construction** | 4.1–4.2; then 5.x draws; 6.1 reference truth | After 3.1 |
| **Require the U1 experiment** | 7.1–7.2; any U9 reuse of U1 data; CPG-U8 calibration labels; CPG-U4 eligibility (U1 companies excluded) | After 6.1 |

## True critical path

**0.1 amendment approval + 0.2 X-1 decision + 0.3 tooling decision → 0.4 protocol-004.** This is now the **first** blocking step: nothing else can be registered while protocol-003's integrity issues stand.

It then joins the parallel human track (1.1 → 2.1, and 1.2) at **3.1 registration → 4.1–4.2 (larger frame; slowest human task) → 5.x → 6.1 → 7.x**.

**Change vs CPG-041P:** the frame is now built once and larger (≥ 210 eligible admissible rows) before the development commitment, and there is no F₂ step after the pilot.
