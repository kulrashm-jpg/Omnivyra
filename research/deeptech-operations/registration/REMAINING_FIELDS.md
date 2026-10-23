# CPG-U1 REMAINING FIELDS — what is still unfilled, and who can fill it

**CLASSIFICATION: HUMAN-REQUIRED INPUT.** Every row below is a value this agent must not invent,
fetch, generate or guess. No row has been filled. This is the register of what stands between the
current state and `verify-registration` exiting 0.

## Human-dependency classes

| Class | Meaning |
|---|---|
| **H1** | An agent can prepare, compute or draft the value; a human reviews and signs it. |
| **H2** | The protocol or the tooling requires a human act — an agent is prohibited from performing it. |
| **H3** | The human's *independence* from the developing organisation is itself the evidence; an agent substitution destroys the claim, not merely the procedure. |

"Lead time" is the external wait, independent of preparation effort.

---

## 1. Registration-record fields (`cpg-u1-registration/v1`)

| Field path | Who can supply it | Class | External lead time |
|---|---|---|---|
| `accountable_identity.value` | The accountable identity itself (a real person or organisation with an OSF account, independent per §4A.1) | **H3** | OSF account creation: hours. Establishing and documenting independence: **UNASSIGNED — depends on who the principal names** |
| `persistent_identifier.type` | Human principal, choosing the scheme | **H2** | none once the scheme is chosen |
| `persistent_identifier.value` | The external issuing authority of the chosen scheme, via the principal | **H2** | **UNASSIGNED — scheme-dependent**; a newly requested persistent identifier is typically days, not minutes |
| `bitcoin_key_custodian.value` | Human principal, naming the study operator (role pinned `STUDY_OPERATOR`, CPG-040 §3.2) | **H3** | none once named; the custodian must be identified before any funding |
| `outpoints.development` (`O_dev`) | Key custodian, by creating and funding a single-use P2WPKH output | **H2** | 1 confirmation ≈ 10 min expected; **≥ 6 confirmations ≈ 1 h** typical, unbounded in the tail |
| `outpoints['held-out']` (`O_ho`) | Key custodian, same act, **distinct** output | **H2** | as above, can share the same funding batch |
| `checkpoint.height` | Operator, read from the chain at or after both funding confirmations | **H1** | gated by the ≥ 6-confirmation wait above |
| `checkpoint.hash` | Operator, read from the chain (must be cross-checked against both header sources) | **H1** | as above |
| `as_of` | Operator, choosing one frozen ISO-8601 UTC timestamp for the whole held-out run (§7, §19.1) | **H1** | none — but it is a methodological choice, not a clock reading, and cannot be changed later |
| `provider_configuration_sha256` | Operator / agent, computed over `registry/builtins.ts` + `coverageInventory.ts` at the frozen resolver SHA (§13.1) | **H1** | none (computable; not computed here) |
| `registration_id` | **OSF Registries**, at registration | **H2** | OSF issues on submission; immediate to hours |
| `registration_timestamp` | **OSF Registries**, at registration | **H2** | as above |

None of the twelve is filled. `checkRegistration(reg, {phase: 'registered'})` therefore reports
every one as `BLOCKED` and `verify-registration` exits **4**.

---

## 2. Values that are frozen by registration but are not registration fields

| Item | Who decides | Class | Lead time |
|---|---|---|---|
| `rules/analysis_decisions.json` AD-1..AD-9 (all `UNDECIDED`) | The methodological authority for the study — the tooling explicitly refuses to choose them | **H2** | none externally, but **must be settled before `registration-fields` runs**: the file is inside the tooling aggregate (see `REGISTRATION_PACKAGE.md` §1.1) |
| Whether the registered aggregate is `f7699f05...` or a new value | Follows mechanically from the row above | **H1** | none |
| Frozen resolver SHA for `scan --expect-sha` | Operator, from the treatment identity (§7.1) | **H1** | none; candidate `f01a7eb4199be4e04d4fee7fc0116303949dc553` was given to this stream as the evaluation-tree commit but is **UNVERIFIED here as the resolver SHA** |

---

## 3. Named prerequisites that are not registration fields (§19.3)

| Prerequisite | Who supplies it | Class | External lead time |
|---|---|---|---|
| Seven mutually exclusive independent persons: enumerator(s), reference Author, Confirmer, reference adjudicator, ≥ 2 raters, rating adjudicator (§4A) | Human principal, recruiting people independent of the developing organisation | **H3** | **UNASSIGNED — recruitment-dependent**; the binding constraint on the whole study, plausibly weeks |
| Two independent Bitcoin header sources, or an own full node | Operator | **H1** for choosing named sources; **H2** if an own node is run (initial block download) | archives: minutes to hours. Own node initial sync: **days** |
| ≥ 2 drand relays | Operator | **H1** | minutes |
| Recording fetcher, recording Wikidata lookup, replay harness (§13) | Engineering | **H1** | engineering time; not an external wait |
| certenv with a fixture tenant | Engineering / operator | **H1** | engineering time |
| Funding satoshis for `O_dev` and `O_ho` plus commitment fees | Key custodian | **H2** | acquisition and transfer: **UNASSIGNED — custodian-dependent** |

---

## 4. Explicitly refused here

This stream generated no identity, no key, no address, no outpoint, no timestamp, no organisation
name and no custodian name. Where a document needed one, it carries an `UNASSIGNED — <who supplies
it>` placeholder. No value in the identity table of `REGISTRATION_PACKAGE.md` §1 was invented; the
four marked VERIFIED were recomputed read-only from files already on disk, and the rest are carried
forward as UNVERIFIED assertions of the orchestration.
