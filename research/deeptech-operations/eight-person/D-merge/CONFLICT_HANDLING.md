# CONFLICT_HANDLING — does an inter-enumerator conflict need a third human?

**Classification: PROPOSAL / METHODOLOGY DESIGN. NOT REGISTERED. NO PROTOCOL CHANGE. NO FROZEN BYTE ALTERED.**
DEEPTECH-PARALLEL-007 · AGENT D · 2026-09-24

## Answer, up front

**No. A genuine inter-enumerator judgement conflict needs no adjudicator, no new exclusion reason and
no schema change — for every conflict except one, and that one is handled by withdrawal.**

The mechanism is the protocol's own tri-state, not an invention:

> §5.1 (protocol line 200): "Each criterion is answered **yes / no / unknown**. **UNKNOWN means 'not
> established / insufficient evidence'. It never means false, and it never satisfies a criterion**
> [enforced: `checkFrameRow`; exhaustive 81-combination test]."

Two competent, independent, mutually blind enumerators reaching **opposite** answers from public
sources *is* insufficient evidence for that criterion. Recording `unknown` is therefore a truthful
statement of the evidential state — not a resolution, not a compromise, and not a decision in either
enumerator's favour. The frozen `checkFrameRow` then derives an exclusion reason that is **already in
the frozen closed list**.

## 1. The closed list — checked, all 16

From `lib/schema.mjs`, with its own comment citing candidate-002 §15.4 (the log that carries the
reason is §15.3):

```js
export const EXCLUSION_REASONS = Object.freeze([
  'A1_NOT_OPERATING_ENTITY', 'A1_NOT_ESTABLISHED',
  'A2_NO_CONTROLLED_DOMAIN', 'A2_NOT_ESTABLISHED',
  'A3_INVALID_IDENTIFIER', 'A3_NOT_ESTABLISHED',
  'A4_NO_INDEPENDENT_TIE', 'A4_NOT_ESTABLISHED',
  'A5_INACCESSIBLE_JURISDICTION', 'A5_NOT_ESTABLISHED',
  'A6_REFERENCE_NOT_OBTAINABLE', 'A6_NOT_ESTABLISHED',
  'OUTCOME_CLASS_NOT_ESTABLISHED',
  'MALFORMED_ROW',
  'NOT_DRAWN',
  'DEVELOPMENT_SURPLUS',
]);
```

**No reason names an inter-enumerator conflict.** That is confirmed, and it matters: inventing
`MERGE_CONFLICT` would edit `lib/schema.mjs`, change the tooling aggregate away from
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, and therefore require a
re-freeze and a fresh registration. **That must not be done, and this design does not need it.**

The reason is that the merger never *writes* an exclusion reason. Nothing can: the reason is
**derived**, inside the frozen validator, from the row's field values:

```js
  let exclusion = null;
  for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
    if (adm[k] !== 'pass') { exclusion = REASON[k][adm[k] === 'fail' ? 0 : 1]; break; }
  }
  if (!exclusion && r.expected_outcome_class === 'unknown') exclusion = 'OUTCOME_CLASS_NOT_ESTABLISHED';
```

with `const tri = (v) => (v === 'yes' ? 'pass' : v === 'no' ? 'fail' : 'unknown');`. So writing
`unknown` into a disputed field is *sufficient*; the frozen code supplies an in-list reason by itself.

## 2. Is `OUTCOME_CLASS_NOT_ESTABLISHED` genuinely reachable? Yes — checked

Three things had to be true, and all three are:

1. `'unknown'` is a **valid** value for `expected_outcome_class`, not a malformed one:
   `if (r.expected_outcome_class && ![...OUTCOME_CLASSES, 'unknown'].includes(r.expected_outcome_class))` —
   `'unknown'` is in the allowed set. (A *blank* class is malformed; the validator says so explicitly:
   `expected_outcome_class is blank — write "unknown" if it is not established`.)
2. Setting the class to `unknown` **releases** the `identity_hazard_note` requirement, which fires only
   `if (r.expected_outcome_class === 'identity-hazard'`. So downgrading a contested hazard row does not
   make it malformed.
3. The reason is assigned only when **no** A1–A6 exclusion fired first (`if (!exclusion && …)`). For a
   row that passes all six criteria and whose only conflict is the class, it fires.

Observed in the frozen `frame` command on a merged fixture (real output, §5 below):
`OUTCOME_CLASS_NOT_ESTABLISHED` was not printed because that fixture row *also* had a domain
conflict, so `A2_NOT_ESTABLISHED` fired first. **This is a real property worth stating:** when a group
carries several conflicts, the published reason names only the **earliest failing criterion** in
A1→A6→class order. The full conflict set is not recoverable from the screening log alone; it lives in
the merge transcript and `conflicts.csv`, which must therefore be sealed alongside.

## 3. Four dispositions, and why each is lawful

| Conflict on | Written | Frozen derives | Effect | Third human? |
|---|---|---|---|---|
| `a1_…`, `a2_…`, `a4_…`, `a6_…` | `unknown` | `A1/A2/A4/A6_NOT_ESTABLISHED` | row stays in the frame, **inadmissible** | **No** |
| `canonical_domain`, `jurisdiction_family`, `identifier_scheme`+`value` | `UNKNOWN` / `''` | `A2/A5/A3_NOT_ESTABLISHED` | row stays, **inadmissible** | **No** |
| `expected_outcome_class` | `unknown` | `OUTCOME_CLASS_NOT_ESTABLISHED` | row stays, **inadmissible** | **No** |
| `c1_2…`–`c1_5…` (contamination) | `unknown` | **no exclusion** | row stays **admissible** but **held-out-ineligible** | **No** — see §3.1 |
| `company_name` | — | — | **group WITHDRAWN** from the frame | **No** — see §3.2 |

The row is **never deleted** in the first four cases. It remains physically present in the frame CSV
and therefore gets its own §15.3 screening-log row with its reason — which is exactly the
transparency the task asks for. "Preserved explicitly as CONFLICT, never silently resolved" is
satisfied twice over: the row is published as excluded, and both enumerators' original values are
published verbatim in `conflicts.csv` and the transcript.

### 3.1 The contamination case is different, and the difference is easy to miss

A contamination-attestation conflict does **not** exclude the row. §5.3 (protocol line 239):

> "**For every contamination attestation, `unknown` is treated exactly like `yes`.** An unestablished
> contamination question makes a company ineligible [enforced]."

`checkFrameRow` implements it as a *contamination basis*, not an exclusion:

```js
  for (const c of CONTAMINATION_ATTESTATIONS) {
    if (r[c] === 'yes') contamination.push(LABEL[c]);
    if (r[c] === 'unknown') contamination.push(`${LABEL[c]} — NOT ESTABLISHED, treated as contaminated`);
  }
```

So the row stays admissible and becomes **held-out-ineligible**. Two consequences:

- It does not count toward §5.7.2 sufficiency, which counts
  `admissible.filter((r) => … && !ineligible.has(r.candidate_id))`. So the sufficiency cost is the
  same as an exclusion.
- It becomes **preferentially drawn into the development set**. `drawDevelopment` orders
  held-out-ineligible companies **first** — "they can serve nowhere else". This is intended protocol
  behaviour, not a defect: a possibly-contaminated company belongs in development, never in held-out.
  But it means a contamination conflict *actively promotes* a row into the pilot, which an owner
  should know before signing off on the rule.

Verified in the merger's own output: the fixture row with a `c1_4` conflict has `exclusion: null` and
`contamination: 1`, and the frozen `frame` command reports
`held-out-ineligible by attestation (before scan/registry): 1`.

### 3.2 The one conflict with no lawful token: `company_name`

`company_name` admits no `UNKNOWN`. The validator requires a non-empty, non-padded name, and writing
the literal string `UNKNOWN` as a company's name would be a false statement, not a not-established
token. There is no `IDENTITY_NOT_ESTABLISHED` reason in the closed list, and the only way to exclude
such a row would be to overwrite a field the two enumerators **agree** on (e.g. forcing `a1` to
`unknown`), which would be fabrication.

**The lawful disposition is to withdraw both rows from the frame, before the commitment.** This is
lawful because §5.5's *"Rows may never be added, removed, edited, re-identified or reclassified"*
binds **after the development commitment**, and §5.7.2 says that if sufficiency is unmet
*"no development commitment may be made; enumeration continues first"*. Pre-commitment the frame is
not an artefact yet, so removing a row costs two candidates and nothing else.

It needs no person, no new reason and no information flow to anyone. It is recorded in
`withdrawn[]` in the transcript and as a `WITHDRAW_GROUP` row in `conflicts.csv`, so it is not silent.

## 4. The option that was rejected, and why

The seemingly obvious alternative — **send the conflict back to the two enumerators** — is *not*
adopted, and the reason is a strict reading of §4A.2:

> "**Enumerators receive only:** public sources; the frame template; §4A, §5.1–§5.4; the
> jurisdiction-family list; the development-only registry."
>
> "**They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)."

A notice of the form *"another enumerator answered A4 differently for this entity"* is plainly not in
the **never** list — it is not CPG output, a pilot result, sizing output or a quota. But the
**receive only** list is exhaustive on its face, and a disagreement notice is not in it. So the
re-enumeration route is **arguably** but not **certainly** lawful, and it would additionally break the
mutual blinding that gives the two answers their independent value.

This proposal therefore does not use it. It is recorded as an open owner question, because if the
owner reads §4A.2's list as non-exhaustive, returning a conflicted row to its **own** author for
re-checking (without telling them what the other person said) would recover rows at no cost to
independence, and would be strictly better than withdrawal.

## 5. Real output of the FROZEN `frame` command on a merged frame

Merged 18 synthetic submitted rows from two enumerators (`fixtures/enum1.csv`, `fixtures/enum2.csv`)
into 12 frame rows, then ran the **frozen** CLI from a byte-identical scratch copy of
`research/cpg-u1/tooling` (aggregate recomputed to `f7699f05…`). `C:/tmp/dt002` was not written to.

```
$ node merge_frame.mjs --instrument <tooling> --out <dir>     --submission fixtures/enum1.csv --submission fixtures/enum2.csv --allow-synthetic
merged 18 submitted row(s) -> 12 frame row(s)
  entity groups merged : 7 decisive-axis group(s)
  judgement conflicts  : 7
  withdrawn groups     : 1
  name suspects (report only): 2
frame_hash: 7ecfaddf8e207214a4211005e2d808d80967cd5b48cf29202cf6338b65377e44

$ node cpg_u1_data.mjs frame --frame <dir>/frame.csv --allow-synthetic
frame rows: 12  malformed: 0
  ADMISSIBLE                       10
  A3_NOT_ESTABLISHED               1
  A2_NOT_ESTABLISHED               1
  held-out-ineligible by attestation (before scan/registry): 1
frame_hash: 7ecfaddf8e207214a4211005e2d808d80967cd5b48cf29202cf6338b65377e44
exit 0
```

The merger's independently computed `frame_hash` is the same string. Both conflict-derived reasons are
in the frozen closed list. The frozen validator reports **0 malformed rows**, i.e. it accepts the
merged artefact without complaint.

For completeness, `conflicts.csv` for that run:

```
group,field,conflict_class,disposition,written_value,enumerator_values
E1DUP2+E2DUP2,identifier_scheme/identifier_value,IDENTITY_FIELD,NOT_ESTABLISHED_EXCLUDES,UNKNOWN/'',ENUM-1=LEI:SYNTHE1DUP2XXXXXXX30 ; ENUM-2=LEI:SYNTHE2DUP2XXXXXXX71
E1DUP2+E2DUP2,a4_tie_independent_of_cpg,ADMISSIBILITY_TRISTATE,NOT_ESTABLISHED_EXCLUDES,unknown,ENUM-1=yes ; ENUM-2=no
E1DUP3+E2DUP3,canonical_domain,IDENTITY_FIELD,NOT_ESTABLISHED_EXCLUDES,UNKNOWN,ENUM-1=e1dup3.example ; ENUM-2=e2dup3.example
E1DUP3+E2DUP3,identifier_scheme/identifier_value,IDENTITY_FIELD,NOT_ESTABLISHED_EXCLUDES,UNKNOWN/'',ENUM-1=LEI:SYNTHE1DUP3XXXXXXX65 ; ENUM-2=LEI:SYNTHE2DUP3XXXXXXX09
E1DUP3+E2DUP3,expected_outcome_class,OUTCOME_CLASS,NOT_ESTABLISHED_EXCLUDES,unknown,ENUM-1=fill-expected ; ENUM-2=abstention-expected
E1DUP4+E2DUP4,c1_4_prior_cpg_execution,CONTAMINATION_TRISTATE,NOT_ESTABLISHED_INELIGIBLE_NOT_EXCLUDED,unknown,ENUM-1=no ; ENUM-2=yes
E1DUP5+E2DUP5,company_name,NO_LAWFUL_TOKEN,WITHDRAW_GROUP,,ENUM-1=SYNTHETIC-NAME-A ; ENUM-2=SYNTHETIC-NAME-B
```

Both enumerators' values survive, verbatim, in a sealable artefact. Neither is asserted as correct.

## 6. What it costs

Each excluded or withdrawn row is one fewer candidate against §5.7.2's `E ≥ 126 / 52 / 32`
(210 rows). Two facts bound the cost:

1. **Nothing is spent from the §15.5(2) 90 %-VALID budget.** That budget covers post-draw observation
   failures. A merge conflict happens before the frame exists, so the row is never drawn and never
   observed. Conflict handling is **free** in evidentiary strength and paid only in enumeration labour.
2. **The shortfall is recoverable.** §5.7.2: *"If unmet, no development commitment may be made;
   enumeration continues first."* The unrecoverable failure is committing to an insufficient frame
   (`STAGE_VOID_FRAME_INSUFFICIENT`, slot consumed, no retry) — which is precisely what
   `check-frame-sufficiency` and `commitment-payload` exist to prevent.

So: **exclusion is lawful, sufficiency still holds provided enumeration continues to 210 eligible
admissible rows after merging, and the model needs no adjudicator.** The 7-independent-person
minimum of §4A.3 is unchanged; nothing here adds an eighth.

## 7. What would make this wrong

Stated plainly, so the claim can be falsified rather than trusted:

1. If an owner rules that `unknown` may only be written by the **person** who could not establish the
   criterion, and never by a tool inferring non-establishment from a disagreement, then the design
   fails and the only lawful routes are withdrawal of every conflicted group (more expensive, still
   needs no adjudicator) or a new exclusion reason (a re-freeze).
2. If `EXCLUSION_REASONS` or `checkFrameRow` changes, every derivation above must be re-verified
   against the new aggregate.
3. If enumerators are permitted **overlapping** allocations by design — for example a deliberate
   double-enumerated subset used to measure inter-enumerator agreement — then conflicts stop being
   exceptions and become the measurement, and a policy of excluding them would systematically remove
   the hardest companies from the frame. That is a selection effect on frame composition and would
   need its own analysis. The merger refuses overlapping allocations partly for this reason.
