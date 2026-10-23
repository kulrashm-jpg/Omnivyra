# CPG-U1 — Eligibility and rater-assignment workflow (operator procedure)

**Classification: PREPARATION.** No register, no assignment and no fingerprint exists. Nothing below
has been run. Every identity in every example is `UNASSIGNED`.

- Protocol: `CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §4A.3, §12.1, §13.2
  (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`.
  Run every command from the tooling root as `node cpg_u1_data.mjs <command> …`.
- **Exit codes** (tooling README): `0` ok · `1` refused / abort · `2` pool below minimum ·
  `3` HALT · `4` **BLOCKED (named human prerequisite missing)** · `5` WAITING / NOT_STARTED ·
  `6` VOID / ABANDONED.
- All outputs are **write-once**. A refused command writes nothing. There is **no `--seed`
  argument**.

---

## Step 0 — Ordering constraint that governs everything below

```
[declarations collected] → [personnel register built] → check-personnel (0)
        → [assignment artefact built] → rater-assignment-fingerprint
        → ***PUBLISH THE FINGERPRINT***  ← must happen HERE
        → [external] broadcast the held-out commitment transaction
        → … draw → seal → execute → rate …
        → verify-rater-assignment (at ingestion and at verification time)
```

§4A.3: the assignment of individuals to `rater-1`, `rater-2` and `rating-adjudicator` is recorded in
the personnel register **and its SHA-256 fingerprint is published, before the held-out commitment
transaction is broadcast** (§12.1). This is the whole point: the presentation order is derived from
the held-out sampling record (§12.1), which cannot exist before the held-out drand round. If the
person→label assignment were fixed after the order became knowable, someone could choose **which
person rates in which order** (`lib/assignment.mjs:1-3`). Publishing first removes that discretion.

---

## Step 1 — Collect the declarations (H1 / H3)

For each candidate, in this order:

1. Send `INVITATION_PACKET.md` (role-specific section + the "what you will not be told" section).
2. Agree the fixed fee **in writing, before releasing any role material** (§4A.1 item 5). Hash the
   signed agreement: `sha256` of the file → `study_fee_agreement_sha256`, or `null` if no fee.
3. Have the person complete and sign `INDEPENDENCE_DECLARATION_TEMPLATE.md`. **Every one of the
   seven questions must be `no`. An `unknown` answer is not `no`** (§4A.1) and ends the candidacy.
4. Obtain the **developing organisation's written confirmation** that its records show no §4A.1
   item 1–4 relationship with that person. Hash it → `organisation_confirmation_sha256`
   (**required**, never `null`).
5. Assign a pseudonym `person_id` matching `[A-Za-z0-9_-]{1,64}`. Keep the legal-name mapping in the
   **restricted** register, outside every study artifact.

**The operator does not answer any declaration question on anyone's behalf, and no AI may.** The
declaration is the only thing behind the independence claim.

---

## Step 2 — Build the personnel register (`cpg-u1-personnel/v1`)

Restricted file; never published. Shape, with **every** identity left `UNASSIGNED`:

```json
{
  "schema": "cpg-u1-personnel/v1",
  "operator": { "person_id": "UNASSIGNED" },
  "assignments": [
    {
      "role": "enumerator",
      "person_id": "UNASSIGNED",
      "declaration": {
        "employed_by_developing_organisation": "",
        "contract_or_work_for_developing_organisation": "",
        "payment_other_than_study_fee": "",
        "financial_interest_in_developing_organisation": "",
        "close_relationship_with_developer_operator_or_role_holder": "",
        "implemented_cpg_protocol_tooling_or_registry": "",
        "ran_or_saw_cpg_output": ""
      },
      "study_fee_agreement_sha256": "UNASSIGNED",
      "organisation_confirmation_sha256": "UNASSIGNED"
    }
    // … one object per role, repeated for: reference-author, reference-confirmer,
    // reference-adjudicator, rater-1, rater-2, rating-adjudicator
    // (enumerator may appear more than once; every other role exactly once)
  ]
}
```

Each `declaration` value must be the literal string `"no"` in the real register. The blanks above
are deliberate: this document contains no filled register.

**Rules the file must satisfy** (`lib/personnel.mjs`):

| Rule | Failure class |
|---|---|
| `schema === "cpg-u1-personnel/v1"` | ERROR → exit 1 |
| `operator.person_id` present and matches `[A-Za-z0-9_-]{1,64}` | ERROR → exit 1 |
| Every one of the seven `INDEPENDENT_ROLES` has ≥ 1 assignment | **BLOCKED → exit 4** |
| Every role except `enumerator` has **exactly one** holder | ERROR → exit 1 |
| No `person_id` equals `operator.person_id` | ERROR → exit 1 (`ROLE COLLISION`) |
| No `person_id` holds two independent roles | ERROR → exit 1 (`ROLE COLLISION`) |
| All seven declaration keys equal `"no"` | ERROR → exit 1 |
| `study_fee_agreement_sha256` is 64 lowercase hex **or** `null` | ERROR → exit 1 |
| `organisation_confirmation_sha256` is 64 lowercase hex (never `null`) | ERROR → exit 1 |

---

## Step 3 — `check-personnel`

```sh
node cpg_u1_data.mjs check-personnel --personnel personnel.json
```

| Exit | Meaning |
|---|---|
| `0` | `personnel register: seven independent roles filled, mutually exclusive, operator in none, declarations complete` |
| `1` | Structural error: role collision, operator in a role, a declaration not `"no"`, a duplicate single-holder role, a malformed or missing hash |
| **`4`** | **BLOCKED — one or more roles UNFILLED.** Printed as `BLOCKED role <name> is UNFILLED`, one line per role. |

**Exit 4 is the normal state until real people are recruited.** It is the study's honest report that a
named human prerequisite is missing. The tooling **will not invent** the missing person, and neither
may the operator: no placeholder id, no synthetic pseudonym, no "TBD", and above all **no AI standing
in as enumerator, reference author, confirmer, adjudicator or rater**. The operator may not fill a
gap with themselves — `check-personnel` refuses that as a role collision.

Errors and blockers are reported **together**, so one run tells the operator both what is malformed
and who is missing.

---

## Step 4 — Build the assignment artefact (`cpg-u1-rater-assignment/v1`)

Keys must be **exactly** `schema, study_id, registration_id, assignments, nonce` — no more, no fewer
(`lib/assignment.mjs:16,22`).

```json
{
  "schema": "cpg-u1-rater-assignment/v1",
  "study_id": "CPG-U1-2026-01",
  "registration_id": "UNASSIGNED",
  "assignments": {
    "rater-1": "UNASSIGNED",
    "rater-2": "UNASSIGNED",
    "rating-adjudicator": "UNASSIGNED"
  },
  "nonce": "UNASSIGNED"
}
```

| Field | Requirement |
|---|---|
| `study_id` | Must equal `CPG-U1-2026-01` |
| `registration_id` | Non-empty string; the public OSF registration id |
| `assignments` | Maps **exactly** the three labels `rater-1`, `rater-2`, `rating-adjudicator` |
| each person id | `[A-Za-z0-9_-]{1,64}`, and all three **distinct** — `ROLE COLLISION: rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)` |
| `nonce` | **64 lowercase hex characters = 256 bits**, freshly generated, never reused |

With `--personnel`, each label's person must hold **exactly that role** in the personnel register,
and the whole register is re-checked; its errors and blockers are reported with a
`personnel register:` prefix (`lib/assignment.mjs:34-41`). So an assignment cannot name someone the
register does not put in that role.

### Why the 256-bit nonce exists

`fingerprint = sha256(canonicalJson(assignment))`. The assignment names only **pseudonymous ids**,
and there are very few of them — a published fingerprint over just three short ids drawn from a
small candidate pool could be **brute-forced**: an outsider (or the operator, later) could enumerate
every plausible permutation of a handful of ids, hash each, and read off which arrangement was
committed, or claim after the fact that a different arrangement had been committed. The **fresh
256-bit nonce makes the preimage unguessable**, so the published fingerprint is a real commitment to
one arrangement and to nothing else, while the assignment itself stays restricted until rating
completes (`lib/assignment.mjs:5-7`).

The nonce is generated once, never reused, and kept with the restricted assignment. **Losing the
nonce destroys the ability to open the commitment** — the assignment can then never be verified
against the published fingerprint, and `verify-rater-assignment` refuses.

---

## Step 5 — `rater-assignment-fingerprint`

```sh
node cpg_u1_data.mjs rater-assignment-fingerprint \
  --assignment assignment.json \
  --personnel  personnel.json
```

| Exit | Meaning |
|---|---|
| `0` | Prints `rater_assignment_fingerprint: <64 hex>` and the reminder: *"Publish this fingerprint BEFORE the held-out commitment transaction is broadcast (§4A.3). The assignment itself stays restricted until rating completes."* |
| `1` | `RATER_ASSIGNMENT_REFUSED: …` — wrong keys, wrong `study_id`, missing `registration_id`, bad nonce, duplicate person, or a personnel-register mismatch. Nothing is written. |

`--personnel` is **not** optional here: `cmdRaterAssignmentFingerprint` requires it, so the
fingerprint can never be computed over an assignment the register does not support.

---

## Step 6 — Publish the fingerprint, BEFORE the held-out commitment (§4A.3)

1. Publish the 64-hex fingerprint to a public, timestamped, append-only venue, together with the
   study id `CPG-U1-2026-01` and the registration id.
2. Record the **publication record**: venue, URL, exact published bytes, and the venue's own
   timestamp. This is what proves the ordering; the tooling cannot.
3. **Only then** broadcast the held-out commitment transaction.

Publish **only the fingerprint**. Do **not** publish the assignment, the nonce, the person ids or the
register. The assignment is opened after rating completes and is archived and published with the
per-rater sheets (§13.2).

> **The tooling cannot check when the fingerprint was published.** README, "What the tooling does not
> prove": *"When the rater-assignment fingerprint was published. The tooling checks that the
> assignment matches the fingerprint supplied; that it was published before the held-out commitment
> is the publication record's timestamp."* `lib/assignment.mjs:6-7` says the same. This ordering is
> a **procedural** guarantee carried by the publication record, and it is the single most
> falsifiable-by-inspection claim in the whole personnel chain: a published fingerprint later than
> the commitment transaction's block time is visible to any outsider.

**Human dependency: H2** — publishing to a timestamped public venue and holding the restricted
assignment are human acts; nothing in the tooling performs or witnesses them.

---

## Step 7 — `verify-rater-assignment`

```sh
node cpg_u1_data.mjs verify-rater-assignment \
  --assignment  assignment.json \
  --fingerprint <the published 64-hex fingerprint>
```

| Exit | Meaning |
|---|---|
| `0` | `rater assignment matches the published fingerprint <fp>` |
| `1` | `RATER_ASSIGNMENT_REFUSED: the assignment does not hash to the published fingerprint`, or a structural error |

Note this command takes **no `--personnel`**: it checks the assignment's structure and that it hashes
to the published fingerprint. That is what an **outsider** can do once the assignment is opened.

The same check runs implicitly, and unavoidably, downstream:

- `ingest-ratings` requires `--assignment` and `--assignment-fingerprint` and resolves the assigned
  person via `assignedPerson(...)`; every CSV row's `rated_by` must equal that person, or the sheet
  is refused (`lib/ratings.mjs:57`).
- `rating-adjudication-packet` and `resolve-rating-adjudication` resolve all three labels the same
  way, and refuse a sheet `rated_by` anyone else
  (`RATER_SHEET_REFUSED (<label>): not rated by the person the published assignment names`).
- `resolveRatingAdjudication` additionally refuses if both sheets were rated by the same person, or
  if the adjudicator is either rater (`lib/ratings.mjs:97-98`).

So a swapped rater is caught at ingestion, not at analysis.

---

## Step 8 — Standing prohibitions for this workflow

- **No AI in any independent role**, and no AI-produced declaration, register entry, frame row,
  reference record, rating or adjudication decision. The preparer of these documents holds no role.
- **The operator is never a rater**, never a reference person, never an enumerator, never an
  adjudicator.
- **No synthetic or example identities** anywhere in a register or assignment — not for testing on
  the real register, not as placeholders. Exit 4 is the correct state while roles are unfilled.
- **Never edit a register or assignment after its fingerprint is published.** The fingerprint is a
  commitment; a change is detectable and makes the results invalid on their face.
- `check-personnel` proves **structure**, never truth (`lib/personnel.mjs:3`). It cannot establish
  that the seven pseudonyms denote seven distinct real people, or that any answer is honest.

---

## Appendix — human dependency per step

| Step | Dependency | Class |
|---|---|---|
| 1. Fee agreed in writing before material release | A human signs a contract | **H1** (form prepared) / **H2** (the act) |
| 1. Declaration answered and signed | Only the person can answer | **H1** to collect, **H3** for its truth |
| 1. Organisation's no-relationship confirmation | The developing organisation writes and signs it | **H2** |
| 1. Pseudonym assignment and restricted mapping | Operator clerical act | **H1** |
| 2. Register assembled | Mechanical from collected inputs | **H0** |
| 3. `check-personnel` | Fully automated | **H0** |
| 3. Filling an UNFILLED role (exit 4) | Requires seven real independent people | **H3** |
| 4. Assignment artefact + 256-bit nonce | Mechanical; nonce from a CSPRNG | **H0** |
| 5. `rater-assignment-fingerprint` | Fully automated | **H0** |
| 6. Publishing the fingerprint before the commitment | A timestamped public act | **H2** |
| 6. Custody of the restricted assignment and nonce | Human custody | **H2** |
| 7. `verify-rater-assignment` | Fully automated | **H0** |
