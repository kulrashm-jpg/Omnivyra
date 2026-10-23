# DR-9 — enumerator-facing instruction, quota-free (option (c)), ready to paste

**CLASSIFICATION: PREPARATION.** This file holds *replacement wording only*. It is not itself an
enumerator packet, it creates no part of the registered frame, and it may be handed to an enumerator
only after OSF registration (§5.5.1; §5.5 step 3). It replaces the section headed "**What an enumerator
should therefore target**" in `JURISDICTION_PARTITIONS.md` (line 166 of that file) for all
enumerator-facing purposes; that file as a whole remains **operator-only** and is not edited.

**Verification of this file, performed on the text as written.** Every digit run inside the
BEGIN/END block was extracted and enumerated: the complete set is
`{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}`, and every occurrence is either one of this instruction's own
section numbers (§1–§11) or part of a protocol citation (§4A, §4A.2, §5.1–§5.4, §5.2, §5.5, §5.7).
**No protocol-derived quantity appears anywhere in the block** — not the §5.7.2 floor (126 / 52 / 32),
not the 210 total, not the 236 / 136 / 60 / 40 plan, not the 34 / 15 / 10 per-family split, and no
ratio, percentage or margin from which any of them could be recovered. The word "three" occurs twice,
once for the three outcome classes of §5.2 and once for the three accessible national families, both of
which the enumerator can count for themselves from material they receive. Every number the text needs is
a `<< >>` placeholder for a human to fill with a working value that must not be derived from any of the
above.

**Provenance of §6 (classes):** `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md` §4 item 6,
unchanged. **Provenance of §2–§4:** the same document's items 1–4. **Provenance of §9:**
`C:/tmp/dt007-eight-person/E-scan-sufficiency/INFORMATION_BARRIER_ANALYSIS.md` §4.2 items 6–7.

---

## BEGIN INSTRUCTION TEXT — paste from here

### 1. Your material

You receive exactly this, and nothing else in this study is material for you:

- public sources;
- the frame template (`templates/candidate_frame.template.csv`);
- §4A and §5.1–§5.4 of the protocol;
- the jurisdiction-family list;
- the development-only registry (`rules/development_only_registry.json`).

If anything else is offered to you at any time, **do not read it**: record that it was offered, and tell
the operator. This list is closed by §4A.2 and it is closed in your favour — it is what makes your work
usable as evidence.

### 2. Your scope

You enumerate candidates in these jurisdiction families only: `<<UNFILLED: family list for this
enumerator>>`.

### 3. Family assignment rule

Assign the **most specific accessible family**. Use `LEI-ONLY` **only** for an entity whose jurisdiction
is not one of the three accessible national families. (§5.1: a company from an inaccessible jurisdiction
is admissible only as `LEI-ONLY`.)

### 4. Your identifiers

- Every `candidate_id` you create begins `<<UNFILLED: your prefix, e.g. E1->>`.
- Write **your** pseudonymous register ID in `enumerated_by` on every row, and the date you established
  the row in `enumerated_at` (`YYYY-MM-DD`).
- Write the public source URL you established the row from in `enumeration_source_url` (must be
  `https`).

### 5. Volume, and how the work is scheduled

- Work in **batches of `<<UNFILLED: batch size B>>` candidates submitted**. You will be asked for up to
  `<<UNFILLED: maximum number of batches>>` batches.
- **Count raw candidates you submit** — not rows that pass screening. You cannot know which rows pass,
  and you are not expected to.
- `<<batch size B>>` is a working batch size chosen for this study's scheduling convenience. **It is not
  derived from any threshold, target, quota, floor or margin, and you should read nothing into it.** The
  schedule was written down and published before you began, so that neither you nor anyone else can tune
  it to a number later.
- Expect to submit **materially more** candidates than end up counting for anything: every candidate that
  screens out stays in the file as a screened-out row. That is normal, expected, and not waste — see §10.

### 6. Classes

Rows must cover all three outcome classes of §5.2. `fill-expected` will be the commonest; deliberately
seek candidates of the other two kinds as well.

There is **no target mix, no ratio and no per-class number**. Do not aim for any particular mix. Assign
each row the class your own evidence supports, before any reference research, exactly as §5.2 defines it.

`identity-hazard` is the most demanding class — it requires you to find and **name** the second, real,
confusable entity in `identity_hazard_note` — so begin looking for such candidates early rather than
leaving them to the end.

### 7. Stopping

- You stop when you are told to stop, at the end of a batch.
- **"Continue" means only that the frame is not yet complete.** It never means that any class is short.
- **No one will tell you that any class is short.** If anyone does — or tells you a total, a threshold, a
  target, a margin, a remaining count, or how many rows the study has collected — **record exactly what
  you were told and by whom, and report it to the operator.** It is a breach of §4A.2 and it needs to be
  on the record, not buried.

### 8. What you will never be given, and must not ask for

- how many rows the study needs, in total or for any class;
- any threshold, floor, quota, target, minimum or margin;
- the number of rows collected so far, or the number still needed, for the study or for any class;
- any other enumerator's rows, identity, volume, progress or count;
- any pilot result, any sizing output, or any output of the system under study.

None of this is withheld because you are not trusted. It is withheld because your independence from
these numbers is the evidence: a frame composed by someone who knew the targets is not evidence that the
frame is unbiased, and that claim is the one your work exists to support.

### 9. What you may be given, every batch

- **Your own rows' row-level results** from the `frame` command: which of your rows are malformed and
  why (e.g. `enumerated_at must be YYYY-MM-DD`, `canonical_domain must be lowercase`,
  `identity_hazard_note is required for identity-hazard`), and each row's admissibility exclusion reason
  where one applies (e.g. `A3_NOT_ESTABLISHED`, `A4_NO_INDEPENDENT_TIE`).
- These are the protocol's own §5.1–§5.4 rules applied to your own work. They contain no count and
  nothing about anyone else, and you should ask for them every batch — they are what stops a systematic
  mistake being repeated across every row you write.
- **Your own** running count of rows you have submitted. That is your work and it is yours to know.

### 10. Screened-out rows are not waste

A row that fails admissibility, or that is found to be held-out-ineligible, stays in the file and is
recorded. Such rows are drawn into the development stage first and recorded as surplus; a frame that
contains them is **better**, not worse, than one that does not. Do not delete a row because you think it
will fail, and do not adjust your judgement to make a row pass. Answer each criterion on the evidence:
`unknown` means "not established / insufficient evidence", it never means false, and it is a legitimate
answer (§5.1).

### 11. Uniqueness and ordering

- **One row per legal entity** (§5.7). Duplicate identifiers and duplicate canonical domains are refused
  outright. Within your own scope this is yours to avoid; across scopes the family-assignment rule in §3
  and the `candidate_id` prefix in §4 make a collision impossible, and you are not to coordinate with
  anyone else to check.
- You deliver **one complete file, once**. The frame is enumerated after the public registration and
  before the development commitment, and after that commitment rows may never be added, removed, edited,
  re-identified or reclassified (§5.5). Nothing you submit can be revised later, so submit nothing you
  are not prepared to stand behind.

## END INSTRUCTION TEXT — paste to here

---

## Operator notes (NOT part of the instruction text — do not paste)

1. **Three placeholders to fill**, and only three: the family list (§2), the `candidate_id` prefix (§4),
   and the batch size plus maximum batch count (§5). Nothing else in the text requires a value.
2. **The batch size must not be a function** of `210`, `126`, `52`, `32`, `236`, `136`, `60`, `40`, and
   must not be any of those divided by the number of enumerators. Choose a round working number,
   generous relative to the floor, and **write down and hash the schedule before enumeration begins** —
   the whole auditability gain of option (c) over option (a) is that the schedule's non-derivation can
   be checked by an outsider after the fact.
3. **Symmetry.** If there are two enumerators, `<<batch size B>>` and `<<maximum number of batches>>`
   must be **identical** for both, and every round's ask must be issued to both at once. An asymmetric or
   staggered ask is itself a disclosure channel.
4. **Under option (a) (strict), delete §5 entirely** and issue the CONTINUE signal per batch instead.
   Under option (b) (permissive), §5 would state the §5.7.2 floor and the planned margin — that variant
   is deliberately not drafted, so that adopting (b) requires a positive decision rather than a paste.
5. **§6 fallback**, if the owner rules that "commonest" discloses too much: replace §6's first paragraph
   with — *"Rows must cover all three outcome classes of §5.2. Seek candidates of each kind deliberately;
   do not aim for any particular mix."* Keep the rest of §6 unchanged.
6. **Do not attach `JURISDICTION_PARTITIONS.md`**, in whole or in part, to any enumerator packet. Its §1
   and its plan table state the §5.7.2 floor, so redacting only the "What an enumerator should therefore
   target" heading does not make the file releasable.
7. This text is quota-free by construction, but it is **not** a substitute for the substantive
   enumerator material. It sits alongside `ENUMERATOR_WORKSPACE.md` §§1–7 (column meanings, identifier
   schemes, A1–A6, the C1 attestations, evidence requirements, refusal behaviour, ordering), which
   contains no quota and remains releasable. One correction to that file before release, found while
   preparing this one and **not** applied by us: its §6 says "the 23 template columns"; `FRAME_COLUMNS`
   has **22** entries and the template header has 22 fields.
