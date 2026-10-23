# DEEPTECH-PARALLEL-011 §2 — which of the five decisions the owner has actually ruled on

§2 forbids silently resolving an owner decision: *"If it contains only a recommendation, report it
as OWNER DECISION REQUIRED."* So I determined the status of each from the record, not from the
prompt. The determination is **discriminating, not blanket** — the record has an explicit
convention for an owner ruling, and three decisions carry it while two do not.

## The convention

Where the owner has ruled, the artefacts say so in a fixed form:

```
/c/tmp/dt009-closure/orchestrator/DECISION_RECORD.md:19   ## DR-1  — drand relay floor        · OWNER DECISION: ADOPT OPTION (B)
/c/tmp/dt009-closure/orchestrator/DECISION_RECORD.md:40   ## DR-2  — §19.3 certenv wording    · OWNER DECISION: ADOPT OPTION (A)
/c/tmp/dt009-closure/orchestrator/DECISION_RECORD.md:53   ## DR-10 — cmdScan duplicate collapse · OWNER DECISION: FIX BEFORE REGISTRATION
/c/tmp/dt009-closure/G-registration/DECISION_DISCLOSURES.md:31   DR-1 · DECIDED: **ADOPT OPTION (B)**
/c/tmp/dt009-closure/G-registration/DECISION_DISCLOSURES.md:137  DR-2 · DECIDED: **ADOPT OPTION (A)**
```

Three decisions, two independent locations each, an explicit verb (`ADOPT` / `FIX`), and the word
`DECIDED` or `OWNER DECISION`. That is what a ruling looks like in this record.

## DR-11 — no ruling exists

Every occurrence of `DR-11` in the entire DeepTech corpus, after excluding my own wave-011 files:

| Location | What it says | Form |
|---|---|---|
| `dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md:204` | states the defect at `cpg_u1_data.mjs:113` | finding |
| `dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md:246` | "**Take** the four aggregate-moving decisions now" | recommendation |
| `dt009-closure/orchestrator/RECONCILIATION_LOG.md:201` | "the same defect class, elsewhere, **unfixed**" | finding |
| `dt009-closure/orchestrator/RECONCILIATION_LOG.md:217` | "**This is a new owner decision (DR-11)**" | explicitly *open* |
| `dt010-rehearsal/DEEPTECH_PARALLEL_010_REPORT.md:255` | "five aggregate-moving decisions, **all DECISION REQUIRED**" | explicitly *open* |
| `dt010-rehearsal/DEEPTECH_PARALLEL_010_REPORT.md:272` | "**Authorise** … take all five … in one sitting" | recommendation |
| `dt010-rehearsal/orchestrator/HUMAN_ACTIONS.md:23` | item 8, "**Rule on** the four aggregate-moving decisions" | outstanding action |

**No `OWNER DECISION:` line. No `DECIDED:`. No adopted option.** Two of the seven say the opposite
in terms — that it *is* a new owner decision and that all five are DECISION REQUIRED.

**Verdict: DR-11 — OWNER DECISION REQUIRED.** §16 therefore says report, not edit.

### A false-positive class worth flagging

A loose grep for `DR-11` also matches **`PMO-ADR-11`** in `dt002/docs/pmo/OMNIVYRA-PMO-002.md`
(lines 165, 171, 255, 260) — an unrelated Omnivyra PMO architecture-decision namespace about
splitting Zone A2. Four hits, none of them about the enumeration collapse. Anyone re-running this
search must exclude `ADR` or they will find four "decisions" that look like rulings and are not.
Recorded so a later wave does not mistake them for one.

## `EVIDENCE_SCHEMA` — no ruling exists

The record says it was **deliberately not** bumped `/v1` → `/v2`, and says why: the brief said to
infer nothing further, so it stopped. Wave 010 lists it among the five "**all DECISION REQUIRED**".
This directive's §8 says to change it only *"if the DR explicitly requires a schema change"* — and
no DR does.

**Verdict: `EVIDENCE_SCHEMA` — OWNER DECISION REQUIRED.**

## Summary

| Decision | Status | Evidence |
|---|---|---|
| DR-1 | **RULED** — ADOPT OPTION (B) | two locations, explicit |
| DR-2 | **RULED** — ADOPT OPTION (A) | two locations, explicit |
| DR-10 | **RULED** — FIX BEFORE REGISTRATION | explicit |
| DR-11 | **OWNER DECISION REQUIRED** | seven mentions, all finding or recommendation |
| `EVIDENCE_SCHEMA` | **OWNER DECISION REQUIRED** | explicitly deferred, never resolved |
| `TOOL_VERSION` | referred to the identity stream | — |
| README enforcement row | referred to the identity stream | — |

The first §16 stop condition — *"DR-11 is not explicitly resolved"* — **has fired**, on evidence,
and not because the prompt failed to mention it.
