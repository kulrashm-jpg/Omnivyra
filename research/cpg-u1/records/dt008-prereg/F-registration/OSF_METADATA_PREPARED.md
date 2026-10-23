# CPG-U1 — OSF METADATA AND NARRATIVE, PREPARED

**Agent:** DEEPTECH-PARALLEL-008 / AGENT 6. **Date:** 2026-09-24.

**CLASSIFICATION: DRAFT NARRATIVE, NOT A SUBMISSION.** Nothing here was submitted to OSF. No OSF identity, no
persistent identifier, no timestamp, no outpoint and no checkpoint was invented. Every external value appears as
the literal marker

```
<<<UNFILLED: ... >>>
```

**A submission containing any `<<<UNFILLED` marker is malformed.** Search the text for `<<<UNFILLED` before you
submit; if the search finds anything, you are not ready.

---

## 1. What is safe to paste today

Everything in §2 through §7 was recomputed read-only in this session and can be transcribed into the OSF form
verbatim. Everything in §8 must wait for the owner, for OSF, for the Bitcoin chain or for recruitment.

---

## 2. Study title and identity

| OSF field | Value |
|---|---|
| Title | **CPG-U1: a preregistered, sampling-committed evaluation of Company Profile Grounding on a frozen held-out company frame** |
| Registry | OSF Registries |
| Visibility | **Public** |
| Embargo | **None.** Leave the embargo date empty. |
| `study_id` | `CPG-U1-2026-01` |
| Protocol version | `CPG_U1_PROTOCOL_004` |
| Accountable identity | `<<<UNFILLED: the accountable person or organisation (U1; §4A.1). This agent must not name it. >>>` |
| Persistent identifier type | `<<<UNFILLED: the scheme the owner chooses >>>` |
| Persistent identifier value | `<<<UNFILLED: the identifier the external issuer returns >>>` |
| `registration_id` | `<<<UNFILLED: issued by OSF Registries at submission >>>` |
| `registration_timestamp` | `<<<UNFILLED: issued by OSF Registries at submission; ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ >>>` |

---

## 3. Frozen artifact identities (all recomputed in this session)

| Artifact | Identity | Files | Verified here |
|---|---|---|---|
| Protocol document `CPG_U1_PROTOCOL_004.md` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | 1 | Yes — `sha256sum` |
| `research/cpg-u1` git tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | — | Yes — `git rev-parse HEAD:research/cpg-u1` |
| Instrument (tooling) aggregate | `<NEW_AGG>` | **<NEW_N>** | Yes — `toolingManifest()` |
| Treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | — | Yes — `git rev-parse HEAD` |
| Treatment git tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | — | Yes — `git rev-parse HEAD^{tree}` |
| Treatment content-manifest aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` | **11552** | Yes — `verifyEvaluationTree()`, `ok=true`, zero notes, zero refusals |
| Development-only registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | 13 entries | Yes — `sha256sum` |
| Provider configuration (§13.1) | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | 2 source files | Yes — `providerConfigurationSha()`, re-confirmed |

**Narrative wording for the treatment identity** (paste as is):

> The evaluated treatment is the repository state at commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, git tree
> `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, whose content-manifest aggregate over the 11552 tracked files is
> `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`. Content is authoritative: a clone whose
> commit or tree identifier differs while the content aggregate matches is the same treatment under a different
> commit identifier. Later mainline states never become the treatment (§7.1). The measuring instrument is pinned
> separately by the tooling aggregate and is excluded from the treatment identity; a clone whose tracked files
> include the instrument is refused as a conflation of the two.

**Narrative wording for the provider configuration** (paste as is):

> The §13.1 provider configuration hash is a domain-separated SHA-256 over the hashes of two named files in the
> frozen treatment clone, in order:
> `backend/services/companyProfile/grounding/registry/builtins.ts` and
> `backend/services/companyProfile/grounding/registry/coverageInventory.ts`. Its registered value is
> `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`. The execution harness refuses to run with
> `PROVIDER_CONFIG_MISMATCH` if the resolver clone's provider configuration differs from this value.

---

## 4. Pinned sampling parameters (U2 / U3) — transcribe verbatim

`checkRegistration` requires the parameter key **count** and every value to match exactly. Do not add, drop,
rename or reorder anything in this block.

| Parameter | Registered value |
|---|---|
| `confirmations_D` | `6` |
| `randomness_offset_K` | `12` |
| `abandonment_days` | `180` |
| `randomness_model` | `B` |
| `drand_chain_hash` | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` |
| `drand_delta_seconds` | `10800` (3 h) |
| `drand_missing_round_expiry_days` | `30` |
| `commitment_opreturn` | `CPGU1\|01\|44(D)/48(H)\|sha256 digest` |
| `digest_domain` | `cpg-u1-commitment-digest/v1` |
| `seed_derivation` | `cpg-u1-chain-drand-seed/v1` |
| `rank_key` | `sha256("<seed>\|<scheme>:<identifier>")` |
| `bls_implementation` | `@noble/curves@1.9.7 + @noble/hashes@1.8.0 (vendored)` |

Network: `bitcoin-mainnet`.

---

## 5. Authority rule and verification procedure — paste verbatim

**`authority_rule`:**

> The earliest registration under the accountable identity with this study_id is authoritative; a second
> registration with different sampling fields, or a withdrawal, voids the study.

**`verification_procedure`:**

> CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)

---

## 6. Recorded analysis decisions AD-1..AD-9

These are **RECORDED, not undecided** — verified directly in the frozen instrument
(`rules/analysis_decisions.json`, sha256 `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`,
status `DECIDED`, 0 undecided). See `ERRATA.md` E-1 in `C:/tmp/dt004-operations/registration/`. They are already
inside the registered aggregate `<NEW_AGG>`, so no aggregate change is pending from this source.

| Decision | Recorded value |
|---|---|
| AD-1 | `EXCLUDE_INVALID_CONFLICT_AND_STALE` |
| AD-2 | `INCONCLUSIVE` |
| AD-3 | `URL_WITHOUT_FRAGMENT` |
| AD-4 | `ENTRY_FOR_DECISIVE_IDENTIFIER` |
| AD-5 | `CALENDAR_MONTHS` |
| AD-6 | `STATED_REFERENCE_VALUES_ONLY` |
| AD-7 | `VOID` |
| AD-8 | `INCONCLUSIVE` |
| AD-9 | `ANY_UNAVAILABLE_ENTRY` |

---

## 7. The §19.3 named prerequisites — transcribed verbatim from the protocol

Quoted from `CPG_U1_PROTOCOL_004.md` §19.3, "Named prerequisites (not decisions; must exist before the stated
act)":

> 1. **Accountable OSF identity + persistent identifier** — before registration.
> 2. **Bitcoin wallet-key custodian** (the study operator) — before funding.
> 3. **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference Author,
>    Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective stage (or a recorded
>    absence of raters with the §12 ceiling). Seven mutually exclusive independent persons.
>
> Also required before held-out execution: recording fetcher, recording Wikidata lookup, replay harness (§13);
> certenv with a fixture tenant; two independent Bitcoin header sources (or an own node) and ≥ 2 drand relays for
> verification.

**Status of each, as prepared** (nothing here is a claim that a prerequisite is met):

| §19.3 item | Status |
|---|---|
| 1. Accountable OSF identity + persistent identifier | `<<<UNFILLED: owner + external issuer >>>` — before registration |
| 2. Bitcoin wallet-key custodian | `<<<UNFILLED: owner names the study operator >>>` — before funding |
| 3. Seven mutually exclusive independent persons | **NOT STARTED.** The **eight-person model (operator + 7) is authorised and needs no amendment** — §4A.3 line 186: "Several enumerators are permitted; each holds no other role."; `lib/personnel.mjs:26` exempts `enumerator` from the "exactly one" rule; `test/selftest.mjs:829` is a passing test named `'multiple distinct enumerators permitted'` |
| Recording fetcher / recording Wikidata lookup / replay harness (§13) | Engineering, not built. No external wait |
| certenv with a fixture tenant | Engineering. **Wording is open — DR-2** |
| Two independent Bitcoin header sources (or an own node) | `<<<UNFILLED: owner names two sources, or runs a node (initial block download: days) >>>` |
| At least 2 drand relays | `<<<UNFILLED: owner names the relays >>>`. **Floor is open — DR-1** |

**Additional §4A.3 timing obligation, to be stated in the registration narrative** (protocol line 189):

> The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded in the
> personnel register, and its SHA-256 fingerprint is published, **before the held-out commitment transaction is
> broadcast** (§12.1). Tooling: `check-personnel` verifies structure (roles filled, mutual exclusion, operator in
> none, declarations "no", confirmation present). It cannot verify that declarations are true.

Fingerprint value: `<<<UNFILLED: output of rater-assignment-fingerprint once the raters are named >>>`.

---

## 8. Every external value, in one list

Do not fill any of these from this document, from any other document in this directory, or from any agent.

| Value | Who supplies it | Marker |
|---|---|---|
| Accountable OSF identity | The accountable person or organisation | `<<<UNFILLED>>>` |
| Persistent identifier type | Owner | `<<<UNFILLED>>>` |
| Persistent identifier value | The scheme's external issuer | `<<<UNFILLED>>>` |
| Bitcoin wallet-key custodian | Owner | `<<<UNFILLED>>>` |
| `as_of` | Owner, as a methodological choice | `<<<UNFILLED>>>` |
| `registration_id` | OSF Registries | `<<<UNFILLED>>>` |
| `registration_timestamp` | OSF Registries | `<<<UNFILLED>>>` |
| `outpoints.development` | Key custodian, on mainnet | `<<<UNFILLED>>>` |
| `outpoints['held-out']` | Key custodian, on mainnet | `<<<UNFILLED>>>` |
| `checkpoint.height` | Read from the chain | `<<<UNFILLED>>>` |
| `checkpoint.hash` | Read from the chain, cross-checked against two header sources | `<<<UNFILLED>>>` |
| Two named Bitcoin header sources | Owner | `<<<UNFILLED>>>` |
| Named drand relays | Owner (after DR-1) | `<<<UNFILLED>>>` |
| Seven independent persons and their three artifacts each | Owner, by recruitment | `<<<UNFILLED>>>` |
| Rater / rating-adjudicator assignment fingerprint | Derived once the persons exist | `<<<UNFILLED>>>` |

---

## 9. `git check-ignore` results for this directory's filenames

Run in `C:/tmp/dt4-uncert` against paths under
`research/deeptech-operations/prereg-008/F-registration/`. The task brief named `.gitignore` patterns
`*_CHECKLIST.md` (line 50) and `*_RUNBOOK*.md` (line 58); **there is a third relevant pattern**,
`*_READINESS*.md` (line 51), which the brief did not mention and which catches the central deliverable.

| Filename | Result | Pattern |
|---|---|---|
| `REGISTRATION_READINESS_TABLE.md` | **IGNORED** | `.gitignore:51` `*_READINESS*.md` |
| `OSF_METADATA_PREPARED.md` | **TRACKED** | — |
| `OPERATOR_REGISTRATION_RUNBOOK.md` | **IGNORED** | `.gitignore:58` `*_RUNBOOK*.md` |
| `OPERATOR_CHECKLIST.md` (the dt004 name) | **IGNORED** | `.gitignore:50` `*_CHECKLIST.md` |
| `BITCOIN_RANDOMNESS_RUNBOOK.md` (the dt004 name) | **IGNORED** | `.gitignore:58` `*_RUNBOOK*.md` |
| `REGISTRATION_READINESS.md` | **IGNORED** | `.gitignore:51` `*_READINESS*.md` |

Verified trackable alternatives, all tested with `git check-ignore` and all reported **TRACKED**:

| Ignored name | Trackable alternative |
|---|---|
| `REGISTRATION_READINESS_TABLE.md` | `READINESS_TABLE_REGISTRATION.md` or `REGISTRATION_FIELD_STATUS_TABLE.md` |
| `OPERATOR_REGISTRATION_RUNBOOK.md` | `OPERATOR_REGISTRATION_SEQUENCE.md` or `REGISTRATION_OPERATOR_STEPS.md` |

**Resolution taken here.** The runbook is written at the trackable name
**`OPERATOR_REGISTRATION_SEQUENCE.md`**, so the operator's ordered procedure is version-controlled. The readiness
table keeps the name the brief specified, `REGISTRATION_READINESS_TABLE.md`, because downstream documents and the
task brief refer to it by that name; it therefore needs `git add -f`:

```
git add -f research/deeptech-operations/prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md
```

Nothing in this directory has been committed.

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

