# Canonical grounding — U1 evaluation protocol (research)

Offline research infrastructure layered on the RF-3A golden-dataset equivalence harness
(`backend/evaluation/canonicalGrounding/`). It is not production runtime: nothing in
`pages/`, `backend/services/`, jobs or workers imports it, and it makes no live AI call
unless an operator injects a runner.

## What is here

| path | role |
|---|---|
| `backend/evaluation/canonicalGrounding/u1Protocol*.ts` | pre-registered, frozen protocol versions u1-001…u1-004: metrics, endpoints, acceptance and falsification rules fixed before any model output exists |
| `u1DatasetValidator.ts`, `u1Dataset002.ts`, `u1DatasetRaina12.ts`, `seal*.ts` | dataset contracts, validation and sealing (content hashes) |
| `u1Scorer.ts`, `u1Certification.ts` | scoring and evidence-rung certification |
| `controlArm.ts`, `runControlArm.ts` | control arm for the comparison |
| `backend/tests/unit/canonicalGrounding{ControlArm,Raina12,U1Certification,U1Dataset002,U1Scorer}.test.ts` | unit coverage |
| `docs/research/canonical-grounding-u1/DEEPTECH_*.md` | the baseline, pre-registrations and dataset-freeze records the code refers to by filename |

## Status

Research, and **blocked** at evidence rung 2. `DEEPTECH_U1_PREREGISTRATION_003.md` records
that no independent human authored ground truth, so `canonicalGrounding.u1Dataset.v2`
remains a self-authored engineering fixture. Protocol `u1-003` is the machine-enforced
contract an independent party must satisfy. No result in these files is a production claim.

## Provenance

Extracted in STEP 3AH-75 from the obsolete branch `feat/company-profile-grounding-and-report1`
(commit `c76eb9bd`). The evaluation code is byte-identical to that commit. One test line was
adapted: `canonicalGroundingControlArm.test.ts` replaces an `@ts-expect-error` on the
`globalThis.fetch` override, which is unused under main's type environment, with an explicit
cast. The five `DEEPTECH_*.md` records moved from the repository root to this directory. `PROTOCOL_REPO_SHA`
inside the protocol modules records the commit the protocol was registered against, which is
historical provenance, not a dependency.
