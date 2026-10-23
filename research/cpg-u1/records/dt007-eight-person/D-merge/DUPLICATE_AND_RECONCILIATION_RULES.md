# DUPLICATE_AND_RECONCILIATION_RULES — mechanical vs judgement, stated explicitly

**Classification: PROPOSAL / METHODOLOGY DESIGN. NOT REGISTERED. NO PROTOCOL CHANGE. NO FROZEN BYTE ALTERED.**
DEEPTECH-PARALLEL-007 · AGENT D · 2026-09-24
Companion documents: `FRAME_IDENTITY_CONTRACT.md`, `CONFLICT_HANDLING.md`. Tool: `merge/merge_frame.mjs`.

Scope boundary: **AGENT C owns partition assignment and the admissibility-recording audit.** This
document assumes allocations exist and only *checks* them. It owns duplicate detection, row
reconciliation, the deterministic merge and the frame hash.

---

## 1. The axes on which two enumerators can enumerate the same company

Two independent people working from public sources can arrive at the same legal entity by six
distinguishable routes. For each: is it a **true duplicate** (one row must survive), a **distinct
entity** (both rows must survive), or a **judgement call**?

| # | Axis | Verdict | Reasoning |
|---|---|---|---|
| D1 | Same `identifier_value` under the same `identifier_scheme` | **TRUE DUPLICATE — decisive** | CIK, SIREN, CNPJ and LEI each name exactly one registered legal person in their register. Two rows with the same scheme+value are the same entity, full stop. This is also the key the draw is ranked on, so two such rows would be two lottery tickets for one company. |
| D2 | Same `canonical_domain` | **TRUE DUPLICATE — decisive** | §5.1 A2 is "domain controlled, https". A registrable domain has one controller. Two admissible rows claiming the same registrable domain assert that two distinct legal entities each control it, which A2 cannot both certify. (A group and its subsidiary sharing a marketing domain is the realistic case — and it is precisely the case where only one of them controls it.) |
| D3 | Same `wikidata_qid` | **TRUE DUPLICATE — decisive, with a caveat** | A QID names one item. If two rows carry one QID they are asserting one item is two legal entities. The caveat is that a QID may denote a *brand* or a *group* rather than the legal person — but in that case the enumeration is wrong for at least one row, so collapsing and letting the conflict surface is still the right move, never keeping both silently. Recorded as decisive; the caveat is why `wikidata_qid` disagreement is itself a recorded conflict (rule R11). |
| D4 | Same `company_name` after case-folding and whitespace collapse | **JUDGEMENT CALL — report only** | Identical trading names across jurisdictions are common and lawful ("Apex Ltd" in three registries is three companies). Name equality is strong evidence and weak proof. |
| D5 | *Similar* `company_name` | **JUDGEMENT CALL — report only** | Same reasoning, weaker. Implemented as token-Jaccard ≥ 0.5 on the case-folded, whitespace-collapsed name. Report-only, so recall is preferred over precision. |
| D6 | Parent / subsidiary relationship | **DISTINCT ENTITIES — and NOT DETECTABLE from the 22 columns** | A parent and its subsidiary are two legal persons with two identifiers; both may legitimately be in the frame. Detecting the relationship requires ownership data that the frame does not carry and that this tool is forbidden to fetch (no network). See §1.2. |

### 1.1 Why name similarity must never auto-merge

Merging on a name is the one rule that can *destroy* a legitimate row. D1–D3 can only be wrong when
the enumeration is already wrong; D4/D5 can be wrong when both enumerations are correct. So the
asymmetry is deliberate: decisive axes collapse rows, name axes only raise a flag. A flagged pair
that is genuinely one company will normally also share a decisive axis, and be caught there.

### 1.2 Parent/subsidiary — what is honestly available

Nothing in `FRAME_COLUMNS` encodes ownership. The only surfaces on which a parent/subsidiary pair
*may* collide are D2 (shared marketing domain) and D3 (a QID naming the group). Neither is reliable.
The protocol's own instrument for "this identity is contestable" is the outcome class
`identity-hazard` with a mandatory `identity_hazard_note` naming the colliding entity:

```js
if (r.expected_outcome_class === 'identity-hazard' && !r.identity_hazard_note.trim()) {
  errors.push('identity_hazard_note is required for identity-hazard (name the colliding entity)');
}
```

So the correct disposition is: **automated parent/subsidiary detection is out of scope and is declared
so**; the enumerator instructions should require that a known parent/subsidiary relation be recorded
as `identity-hazard` with the counterpart named. That is an instruction change, not a tooling change,
and it belongs to whoever writes the enumerator brief. Listed as an open owner question.

### 1.3 What the FROZEN instrument already catches — exactly

Searched `lib/frame.mjs`, `lib/select.mjs`, `lib/schema.mjs`, `cpg_u1_data.mjs`.

**Caught:**

| Check | Where | When it fires | Scope |
|---|---|---|---|
| duplicate `candidate_id` | `cpg_u1_data.mjs:99` in `loadFrame` | `frame` (exit 1) and `check-frame-sufficiency` (`refuseMalformed`) | **all rows** |
| duplicate `identifier_scheme:identifier_value` | `assertUnique`, `lib/select.mjs:44-51` | `frameSufficiency` (`lib/frame.mjs:42`), `drawDevelopment`, `drawHeldOut` | **admissible rows only** |
| duplicate `canonical_domain` | same `assertUnique` | same | **admissible rows only** |

```js
export function assertUnique(admissible) {
  const ids = new Set(); const domains = new Set();
  for (const c of admissible) {
    if (ids.has(idKey(c))) throw new Error(`duplicate identifier ${idKey(c)} — one row per legal entity`);
    if (domains.has(c.canonical_domain)) throw new Error(`duplicate canonical_domain ${c.canonical_domain} — one row per legal entity`);
    ids.add(idKey(c)); domains.add(c.canonical_domain);
  }
}
```

**NOT caught:**

1. **Duplicate `wikidata_qid`** — never checked, anywhere.
2. **Duplicate name** (exact or similar) — never checked.
3. **A duplicate pair in which either row is inadmissible.** `assertUnique` only ever sees
   `checked.filter((x) => x.res.exclusion === null)`. A pair where one row fails A6 is invisible; the
   inadmissible twin still occupies a `candidate_id`, still appears in the sealed §15.3 screening log,
   and still consumed enumeration effort — but nothing says the two rows were one company.
4. **The same company under two different identifier schemes** (CIK in one row, LEI in the other). The
   `idKey`s differ, so `assertUnique` passes. It is caught *only* if the two rows also agree on
   `canonical_domain`. Two plausible domains for one group (`example.com` and `example.co.uk`) defeat it.
5. **Parent/subsidiary**, as above.
6. **Timing.** `assertUnique` is reached only at `check-frame-sufficiency`, which additionally
   requires `--scan` and `--registry`. So even the duplicates the instrument *does* catch surface late
   and one at a time (the function throws on the first), after a repository scan has been run.
   It is legible (`FRAME_INVALID: duplicate identifier …`) but it is a stop-the-line error, not a report.

Items 1, 3, 4 and 6 are the gap this merger closes. It reports **all** duplicate groups on **all**
decisive axes over **all** rows including inadmissible ones, before any scan, as a list.

---

## 2. Mechanical versus judgement — the sharp line

**Mechanical difference**: two submissions that encode *the same assertion* differently, or encode the
same entity twice. A deterministic rule may resolve it with no human, because no one is being
overruled.

**Genuine judgement conflict**: two enumerators assert *different things* about the same entity. No
deterministic rule may pick a winner, because picking one silently discards a competent
independent observation. It must be preserved explicitly as a CONFLICT and given a disposition that
does not assert either value.

### 2.1 The mechanical set is smaller than it looks — and that is a finding

The intuition "most differences will be formatting" is **wrong here**, because the frozen validator
already forbids almost every non-canonical form *at input*:

```js
if (!r.company_name.trim() || r.company_name !== r.company_name.trim()) errors.push('company_name empty or padded');
if (r.canonical_domain !== r.canonical_domain.toLowerCase()) errors.push('canonical_domain must be lowercase');
if (/^www\./.test(r.canonical_domain)) errors.push('canonical_domain must not start with "www." (canonical form)');
if (/[/:?#\s]/.test(r.canonical_domain)) errors.push('canonical_domain must be a bare host (no scheme, port, path or whitespace)');
for (const c of [...]) if (!ATTESTATIONS.includes(r[c])) errors.push(`${c} must be exactly "yes", "no" or "unknown" (blank is not an answer)`);
```

A submission carrying `WWW.Example.COM ` is `MALFORMED_ROW`, not a formatting difference to be
smoothed over. The merger runs `checkFrameRow` on every **input** row and refuses the submission,
rather than repairing it — repairing would mean the merger editing a human's answer.

What genuinely remains mechanical is therefore a short, closed list: **Unicode normalisation form,
byte-order mark, the file's line endings, CSV quoting style, and the existence of two rows for one
entity.** Nothing else.

### 2.2 The rule table

Every one of the 22 columns has exactly one named rule. The merger throws
`no merge rule for column X` if `FRAME_COLUMNS` ever gains a column, so the table cannot silently
fall out of date (test `T18`).

| Rule | Applies to | Condition | Action | Kind |
|---|---|---|---|---|
| **N1** | every field | any field | `normalize('NFC')`; count recorded in the transcript | **Mechanical** |
| **N2** | every field | field contains CR, LF or a control character | **REFUSE the submission** | Mechanical (refusal) |
| **N3** | submission | header ≠ the 22 columns exactly, or any row fails frozen `checkFrameRow` | **REFUSE** | Mechanical (refusal) |
| **R0** | a group of one | no duplicate | copy the row verbatim | Mechanical |
| **R1** | `candidate_id` | duplicate group | keep the code-unit-smallest id in the group; the others are recorded as `dropped` | **Mechanical** — and *provably draw-neutral* (`rankKey` ignores `candidate_id`) |
| **R2** | any field | all members agree | take the agreed value | Mechanical |
| **R3** | `enumerated_by`, `enumerated_at`, `enumeration_source_url`, `identifier_domain_evidence_url`, `identifier_domain_evidence_note`, `identity_hazard_note` | members differ | carry the **donor's** value (donor = owner of the surviving `candidate_id`); every non-donor value preserved verbatim in the transcript | **Mechanical, debatable — see §2.3** |
| **R4** | `a1_…`, `a2_…`, `a4_…`, `a6_…` | members differ | write `unknown`; record CONFLICT | **JUDGEMENT** |
| **R5** | `c1_2…`, `c1_3…`, `c1_4…`, `c1_5…` | members differ | write `unknown`; record CONFLICT | **JUDGEMENT** |
| **R6** | `expected_outcome_class` | members differ | write `unknown`; record CONFLICT | **JUDGEMENT** |
| **R7** | `canonical_domain`, `jurisdiction_family`, `identifier_scheme`+`identifier_value` | members differ | write `UNKNOWN` (and `identifier_value = ''`, as the frozen schema requires); record CONFLICT | **JUDGEMENT** |
| **R8** | `expected_outcome_class` | class is agreed `identity-hazard` but the notes differ | write `unknown` (conservative default) | **JUDGEMENT, debatable — see §2.3** |
| **R9** | `company_name` | members differ | **WITHDRAW the whole group** from the frame; record CONFLICT | **JUDGEMENT** |
| **R10** | `wikidata_qid` | exactly one member recorded a QID | adopt it | **Mechanical, mildly debatable — see §2.3** |
| **R11** | `wikidata_qid` | members recorded *different* QIDs | clear to `''`; record CONFLICT | **JUDGEMENT** |

### 2.3 Where the line is genuinely debatable — stated, not hidden

Three rules sit on the line. Each is flagged in the code and each is an owner decision, not a
technical fact.

**R3, donor-carried provenance.** Rationale: a merged row must remain attributable to one real
person. §15.3's screening log carries `screened_by`; §4A's whole architecture is per-person
accountability. A row whose `enumerated_by` is `"ENUM-1+ENUM-2"` and whose evidence URL came from a
third place is attributable to nobody. So provenance is never blended.
*The debatable part*: when both enumerators answered `a4 = yes` but cited **different** evidence
URLs, that is corroboration, not conflict — yet the merger still writes only one citation into the
frame. The non-donor citation is preserved verbatim in the transcript, so nothing is destroyed, but
the *frame* shows one of two independent ties. An owner may reasonably prefer that this be recorded
as a CONFLICT instead. It is not currently, because doing so would exclude a row on which the two
enumerators actually **agree**, which is the opposite of conservative.

**R8, hazard-note disagreement.** Both enumerators say `identity-hazard`; they name different
colliding entities. Both may be telling the truth (a company can collide with several). Writing one
note and publishing both in the conflict report is defensible. But the class `identity-hazard` is
only meaningful with an established hazard, and if *which* hazard is contested then arguably the
class is not established. The merger's **default is the conservative reading** — class becomes
`unknown`, the row is excluded, the conflict is published. `--hazard-note-donor-carried` selects the
permissive reading, and the choice is recorded in the transcript and therefore in its hash.
This is a live owner decision. The conservative default was chosen because it can only ever remove a
row, never admit one.

**R10, QID union.** An empty `wikidata_qid` means "I did not record one", not "none exists" — the
column is optional and `checkFrameRow` validates it only when present. Adopting the one recorded QID
is treated as mechanical. *The debatable part*: it does import information that one enumerator did not
have. The risk is bounded because `wikidata_qid` has **no admissibility effect whatsoever** — it
appears in no `adm.*` computation — so R10 can never turn an inadmissible row admissible. It can only
affect duplicate detection on the D3 axis, in the direction of *finding more* duplicates.

### 2.4 Rules that are deliberately absent

- **No name canonicaliser.** Stripping "Inc", "Ltd", "GmbH", "SA" is the obvious mechanical-looking
  rule and it is wrong: those tokens distinguish legal persons. A name canonicaliser would make
  `Acme Inc` and `Acme GmbH` one row.
- **No id renaming.** On a `candidate_id` collision between enumerators the merger **refuses**. It
  does not auto-prefix, because renaming would hide the possibility that the two rows are also an
  identity conflict.
- **No majority vote.** With N = 2 there is no majority. With N = 3 a 2–1 vote would be a resolution
  by headcount, which is exactly the adjudication the model is trying to avoid, performed worse. The
  merger treats any disagreement, at any N, as not-established.
- **No repair of a malformed input row.** Refuse, return it to its own enumerator.

---

## 3. Duplicate cost, and why it is affordable

A conflict or a withdrawal removes exactly one candidate from the eligible-admissible count measured
against §5.7.2's `E ≥ 126 / 52 / 32` (210 rows, protocol line 409; recomputed here from
`lib/frame.mjs`, not typed in).

Two properties make this cheap:

1. **Pre-frame exclusions do not touch the §15.5(2) VALID budget.** §15.5(2) makes a run INCONCLUSIVE
   when fewer than 90 % of held-out company × field *observations* are VALID. That budget is consumed
   by post-draw failures (`INVALID`, `REFERENCE-CONFLICT`, `REFERENCE-STALE`, `REFERENCE-AMBIGUOUS`).
   A merge conflict happens **before** the frame exists, so the row is never drawn, never observed,
   and consumes none of that budget. A merge conflict costs enumeration labour and nothing else.
2. **Conflicts scale with the duplicate rate, not the frame size.** A conflict requires two
   enumerators to have reached the *same* entity, which under a disjoint allocation is the exception.
   If `d` is the fraction of submitted rows that fall in a cross-enumerator duplicate group and `k`
   the fraction of those groups that carry a conflict or withdrawal, the gross submission needed per
   class is approximately `E_c / (1 − d/2 − (d/2)·k)`: half of `d` is lost to collapsing (two rows
   become one) and a further `k` of the collapsed rows is lost to exclusion. At `d = 0.10`,
   `k = 0.30` that is `E_c / 0.935` — about 7 % over-enumeration, 225 rows instead of 210.

So the model does not need an adjudicator **and** does not need a large sufficiency buffer. It needs
the allocation to be disjoint and a modest margin. The margin is bought by continuing to enumerate,
which §5.7.2 explicitly permits before the commitment.

---

## 4. Interface with AGENT C (allocation)

The merger does not assign partitions. It consumes an allocation artefact and refuses on overlap:

```json
{ "key_fields": ["jurisdiction_family"],
  "enumerators": [ { "enumerated_by": "ENUM-1", "keys": ["US-SEC", "FR-SIRENE"] },
                   { "enumerated_by": "ENUM-2", "keys": ["BR-CNPJ", "LEI-ONLY"] } ] }
```

Checks performed: pairwise key-set intersection must be empty; every row's key (the `key_fields`
joined by `|`) must be in its own enumerator's set; every `enumerated_by` must have an allocation.
Any failure refuses the whole merge with nothing written. `--allocation` is optional; without it the
merge still runs and still detects duplicates, but it cannot tell an *intended* overlap from an
accident, so its use is recommended.
