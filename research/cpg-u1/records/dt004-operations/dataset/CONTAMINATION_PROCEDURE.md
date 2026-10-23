# CONTAMINATION_PROCEDURE — the operator's repository scan (CPG-C1(1) + CPG-C1(6))

**Classification: PREPARATION** (the procedure) — a scan actually run against the registered frame produces
**REGISTERED EVIDENCE** (`scan.json`, whose `scan_sha256` goes into both commitment payloads). The scan is an
**operator** task, not an enumerator task: it reads the repository, which enumerators never see.

---

## 1. Prerequisites

| Prerequisite | State |
|---|---|
| A **clean clone** of the repository checked out at the frozen resolver SHA `f01a7eb4199be4e04d4fee7fc0116303949dc553`, with **no working-tree changes** | operator-provided |
| The frame CSV to scan | from the independent enumerator(s) (**H3**) |
| `rules/development_only_registry.json` — the registry whose SHA-256 is **in the registration** | FROZEN; never modified |
| The verified instrument at aggregate `<NEW_AGG>` | read-only |

The scan refuses if `git rev-parse HEAD` ≠ `--expect-sha`, and refuses if `git status --porcelain` is
non-empty ("scan a clean clone only"). Both refusals write nothing.

---

## 2. The command

```bash
node cpg_u1_data.mjs scan \
  --frame      <FRAME>.csv \
  --repo       <clean clone at the frozen resolver SHA> \
  --expect-sha f01a7eb4199be4e04d4fee7fc0116303949dc553 \
  --registry   rules/development_only_registry.json \
  --out        scan.json
```

`--expect-sha` is **mandatory** and is the whole point: contamination is assessed **at the frozen resolver
SHA**, not at whatever the clone happens to be on. A later commit could add or remove a company name and
silently change eligibility, so the scan is pinned to the same commit the study evaluates.

Exit `0` on success; exit `1` on any refusal (HEAD mismatch, dirty tree, malformed frame header, an output path
that already exists — all outputs are **write-once**).

`scan.json` records `tool`, `rules`, `repo_sha`, `frame_hash`, `registry_sha256`, `files_scanned` per scope,
and one `results` entry per candidate with `repository_hits`, `registry_matches` and
`held_out_ineligible_by_scan`. Downstream commands refuse unless the scan's `frame_hash` equals the frame they
were given **and** its `registry_sha256` equals the registry file they were given — a scan cannot be reused
across a changed frame or a changed registry.

---

## 3. The two scan scopes (§5.4, decision D-D)

Enumerated over `git ls-files` at the resolver SHA. Files larger than 5 MiB and files containing a NUL byte are
skipped; everything else in scope is read as UTF-8.

| Scope | Paths |
|---|---|
| **TEST** | anything under `test/`, `tests/`, `__tests__/`, `fixture/`, `fixtures/`, `__snapshots__/`, `__mocks__/`, `e2e/`, or named `*.test.*`, `*.spec.*`, `*.snap` — committed test fixtures, snapshots, mocks and specs |
| **CPG_IMPLEMENTATION** | `backend/services/companyProfile/`, `backend/evaluation/`, `pages/api/company-profile/`, `pages/api/company-grounding/`, `components/companyProfile*`, `components/companyFacts*` — CPG's own source, evaluation harnesses, routes and UI |

The second scope is the widening that matters: **a company named in CPG's own source was used while building
CPG even if no test cites it.** A test-only scope would miss names occurring in CPG grounding source
(the protocol cites `discoveredSource.ts:232` and `entityResolution.ts:223` as the concrete misses).

**What is matched, per candidate:** every name variant (the name as written, plus the name with legal suffixes
such as `inc`, `ltd`, `gmbh`, `sa`, `ltda`, `plc`, `llc` repeatedly stripped), the `canonical_domain`, the
`identifier_value` and the `wikidata_qid`. Names and domains match case-insensitively at word boundaries, with
whitespace/underscore/hyphen flexibility inside a name; `UNKNOWN` values produce **no** token. At most one hit
per token per file is recorded (with the first matching line number), so a hit list is a list of *files*, not
of occurrences.

**The scan is deliberately conservative.** A false positive only moves a company out of held-out and into
development. A false negative would contaminate held-out — the one error the design refuses to risk.

---

## 4. What the development-only registry does (CPG-C1(6))

`rules/development_only_registry.json` records the **implementers' own CPG history**: 13 seed entries, each
citing its basis and its evidence. Every entry names a company that was run through CPG or used in developing
it — a live smoke run, a committed fixture, a live-acquisition harness target, or the implementers' own
tenant. No entry was created by researching companies.

A frame candidate matches an entry if a registry **name** appears as a whole word in any of the candidate's
name variants — so a registry name also matches any *longer* company name containing it as a whole word, which
is conservative by design — or if a registry **domain** equals the candidate's domain or is a parent of it. A
match makes the candidate held-out-ineligible **regardless of scanner output and regardless of every
attestation**.

The registry is:

- **append-only** — entries are never removed or edited;
- **`status: "SEED — completeness NOT ATTESTED"`** — before enumeration the CPG implementer must attest that
  every company ever run through CPG (smoke, live, pilot, production) or used in CPG development is listed
  (§19.2, an open **H2** item);
- **FROZEN at registration** (§5.3, APPROVED CPG-043). Held-out eligibility for **both** stages is determined
  solely by the registry whose SHA-256 is in the registration. Additions, deletions and edits after
  registration have **no effect on this study**. Both commitment payloads must carry the registered
  `registry_sha256`; a mismatch is refused at the CLI before commitment and is
  `STAGE_VOID_BINDING_MISMATCH` at chain verification.

**This file is never modified by this stream, or by anyone, for this study.**

---

## 5. A scan hit makes a company held-out-INELIGIBLE, not inadmissible

This distinction is the one most easily got wrong:

| | Admissibility (A1–A6) | Held-out eligibility (C1) |
|---|---|---|
| Established by | the enumerator's attestations + computed identifier/family checks | the scanner (C1(1), C1(6)) + the enumerator's attestations (C1(2)–C1(5)) |
| A failure means | the row is **excluded**: it is screened out, does not count toward the §5.7.2 floor, and is never drawn | the row stays **admissible** and countable as a frame row, but can be drawn into **development only** |
| Recorded as | `exclusion_reason` in the §15.3 screening log | `held_out_eligible = no` + `held_out_ineligible_basis` in the same log |

"Ineligibility never excludes a company from research: it can only be drawn into development" (§5.3). In the
development draw, held-out-ineligible companies are taken **first**, since they can serve nowhere else; the
ones not drawn are logged `DEVELOPMENT_SURPLUS` and never enter held-out (§5.8). A frame rich in ineligible
admissible rows is therefore *better* than one without — those rows absorb the exact 6/2/2 development places
and leave the eligible pool intact.

Note that eligibility is computed from **three** merged sources, all folded into one basis list per candidate:
repository hits, registry matches, and the contamination attestations — where **`unknown` is treated exactly
like `yes`**.

**Late-discovered contamination** (§5.3): a contamination found after registration is recorded (company,
basis, date, discoverer) and published. The company is **never excluded, removed or replaced** — not for any
outcome, not at all. Its observations are flagged `CONTAMINATION-DISCLOSED`, and a pre-specified secondary
analysis excluding flagged observations may be reported but **never changes the §10.5 outcome**.

---

## 6. Omnivyra — permanent DEV-001 status (§17)

Omnivyra is the implementers' own company and tenant. Its status is **permanent and not contingent on any
scan or attestation**:

- a real-company integration / development / smoke case;
- **contaminated for U1** on four independent grounds: C1(1) (195 repository hits at the resolver SHA), C1(2),
  C1(5), and registry entry **DEV-001**;
- **not eligible for held-out U1 evidence, whatever any scanner or attestation says** — C1(5) and DEV-001 each
  independently suffice;
- **not an independent reference-truth case** — its first-party site and any reference values would be
  authored by the implementers;
- **not a source of any U1 efficacy statistic.**

The inability to execute its production lookup (CPG-035, blocked by authentication) is **not a U1 failure**.
Its tenant id is repository-corroborated, not DB-verified.

Operationally: if Omnivyra ever appears in a frame, the correct outcome is `held_out_eligible = no` with basis
citing DEV-001 and C1(5) — and it may be drawn into development only. No scanner result, and no enumerator
answer, can change that.

---

## 7. Order of operations

```
PUBLIC OSF registration (the freeze)
  → independent enumeration of the COMPLETE frame            (H3)
  → frame                     (refuse on any malformed row)
  → scan --expect-sha f01a7eb4…  against a clean clone       (this document)
  → check-frame-sufficiency   (E ≥ 126 / 52 / 32)
  → commitment-payload(development) → on-chain commitment
  → … NO LATER FRAME, SCAN OR REGISTRY CHANGES
```

The **same** `scan.json` serves both stages. Re-scanning between stages produces a different `scan_sha256` and
is refused (`SCAN_CHANGED`), because "eligibility is fixed before any CPG outcome."

---

## 8. Verification state of this procedure

- **VERIFIED** — the command shape, the `--expect-sha` refusal, both scope regexes, the write-once output and
  the frame/registry binding were exercised against the real frozen resolver SHA with synthetic candidates.
  See `FRAME_DRY_RUN.md` §3 for the real commands and output (1797 TEST + 116 CPG_IMPLEMENTATION files
  scanned at `f01a7eb4…`).
- **DEFERRED** — a positive C1(6) registry match was **not** rehearsed. Demonstrating one requires writing a
  real company name from the registry into a candidate row, which this stream is prohibited from doing. The
  registry matcher's positive path is covered by the instrument's own self-test and mutation suite.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

