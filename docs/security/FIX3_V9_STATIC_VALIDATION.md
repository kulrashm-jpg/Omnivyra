# FIX 3 — V9 MINIMAL DOCUMENT CLEANUP AND FULL STATIC REVALIDATION

Document-only work. No database connection, no SQL executed or parsed, no role or privilege change,
no migration applied or modified, no container or CI harness, no production access, no staging, no
commit. **No runtime claim is made about the session, the project identity or the effective
privileges, and Fix 3 application remains separately unauthorized.**

---

## 1. DISPOSITION

**READY FOR OWNER VERIFICATION — V9 DOCUMENTS STATICALLY VALIDATED**

All six defects reported in `FIX3_V8_STATIC_VALIDATION.md` §6 are corrected. Both flagged decisions
were handled as directed, not silently: factual provenance is preserved over cosmetic alignment, and
the `649-662` clarification is kept. Both complete assembled artifacts were read end to end after
editing, and a mechanical sweep confirms **no orphaned fragments, no malformed paragraph boundaries,
no ambiguous thematic breaks, no stale live version pointers and no inconsistent counts remain**.

Every preservation check holds: **zero SQL changed**, the §F query still hashes to
`e02bfecd0a16729f`, all eight stop conditions and their precedence are intact, and the V8 pair and
all five preserved artifacts are byte-unchanged.

**Two things to disclose up front.** During assembly I made a splice error — one line too many was
consumed, which orphaned the next bullet in the owner stop-condition list — and caught it by reading
the assembled output before installing anything (§4). And I made one change beyond the six
authorized: re-wrapping a 201-character prose line that my own v8 edit had created, with the word
stream proven identical (§3.7).

**Stage A itself remains blocked** on the owner-side read-only prerequisite. That is unchanged and
is not a finding of this task.

---

## 2. HASHES

### New (V9)

| File | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V9.md` | `2a1cd401467cb68dd0c6db13db5f9b410a541d63dd504762ed03b0cea5bcc8f7` | 1,697 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V9.md` | `d30245bf7d7e2d1c195103bfd8f354db91a13a37b14f3b7162db79d501ec7c50` | 207 |
| `docs/security/FIX3_V9_STATIC_VALIDATION.md` (this file) | recorded on delivery | — |

The steps artifact cites the V9 package by path and full hash at line 8, and by hash prefix at line
114. Both match the table above.

### Inputs verified before editing

| Artifact | Expected | Actual | |
|---|---|---|---|
| V8 package (1,692 lines) | `1fe6eae32dd3b2c854cd1f1f389d3ca50f29298344cf2014845b08bc8cf9c0c1` | same | **MATCH** |
| V8 steps (202 lines) | `83973eb8c05bea9c14bc494faedaaee11ce49b88e1d7dedad3b2d732325c4e4b` | same | **MATCH** |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, **detached**, as required.

### Preserved — re-hashed AFTER all edits

| Artifact | SHA-256 | |
|---|---|---|
| Original Phase 98 package | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | **unchanged** |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | **unchanged** |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | **unchanged** |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | **unchanged** |
| CI harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | **unchanged** |
| V8 package | `1fe6eae32dd3b2c854cd1f1f389d3ca50f29298344cf2014845b08bc8cf9c0c1` | **unchanged** |
| V8 steps | `83973eb8c05bea9c14bc494faedaaee11ce49b88e1d7dedad3b2d732325c4e4b` | **unchanged** |
| V8 report | `d7dd670574f81bbe106ab2a4654bdb710f6100f43a888afeb1285ea7dac1f49b` | **unchanged** |
| V7 package | `78ce050f0d351fc135d79b2a73f83ed09b3e38dff3fd1ed5231dcba358cbd40c` | **unchanged** |
| V7 steps | `f7fb70d727ec7232c8f2ccc7c89ecc2f0da96b5dd9e26d2ce6326d65d74882eb` | **unchanged** |

v1 through v6 of both artifacts were never opened for writing.

**One note on the CI harness.** `git status` reports it modified relative to HEAD. That modification
is **pre-existing** — it is one of the 78 tracked modifications this worktree has carried since
Phase 95 — and its content hashes to `63e8920b…`, the value recorded in every prior phase. It is
untouched by this task.

---

## 3. EXACT CHANGES

Package: **seven hunks**. Steps: **two hunks**. Nothing else differs.

```
package:  26a27   250a252   311a314   394d   395a397   444,447c447,451   1427a1428
steps:    81c81   84c84   86,87c86,87   89a90,93   144,147c144,148
```

### 3.1 K-1 — orphaned duplicate fragment — **REMOVED**

V8 line 394 repeated the tail of line 393. It is deleted. The surrounding paragraph is complete and
ends correctly at V9 line 396:

> …None of `ABSENT`, `UNKNOWN` or `INCONCLUSIVE` may be read as "no write privilege". If
> `supabase_migrations` or its ledger relation is absent, Item 11 is INCONCLUSIVE and that is
> recorded, not inferred away.

No wording was changed; one duplicated line was removed. Mechanical check for the removed string
returns **0** occurrences.

### 3.2 K-2 — blank line restored — **FIXED** (V9 line 252)

"**What these six checks establish — and what they do not.**" now opens its own block instead of
merging into the 3f PID paragraph.

### 3.3 K-3 — STOP banner is a distinct block — **FIXED** (V9 line 314)

The banner at line 315 is now separated from the project-identity paragraph above it. Its eight
bullets follow immediately at lines 317-346, **unchanged in wording, order and meaning** — verified
by counting 8 bullets in the authoritative block and by reading all eight against V8.

### 3.4 K-4 — blank line restored — **FIXED** (V9 line 397)

"A separate, narrower condition: if 3b reports `sel = false`…" is its own paragraph, so the
narrower `sel = false` rule is no longer visually fused to the STOP-level `UNKNOWN` rule above it.

### 3.5 K-5 — thematic break unambiguous — **FIXED** (V9 line 1428)

The `---` at line 1429 is now preceded by a blank line, so it cannot be parsed as a setext heading
underline for the "Item 6 remains the authority…" list item. A sweep of **both** artifacts for any
`---` directly following non-blank text returns **0**.

### 3.6 M-1 — historical count corrected — **FIXED** (V9 lines 447-451)

Was "how **two** stale copies came to exist, one claiming six relations and one calling the
read-only transaction 'database-enforced'". Now:

> …restating it is how **three** stale copies came to exist, each claiming six relations and each
> calling the read-only transaction "database-enforced"; they were removed in v6, v7 and v8
> respectively. **[v9]** Read step 3's list directly, every time, and record against it.

This is checked against the record rather than merely incremented. All three copies claimed **both**
defects: the template block (G-2, removed in v6) "declared six relations … and contained a line
describing the read-only transaction as 'database-enforced; required'"; the section-1 list (H-4,
removed in v7) "said six relations … and called the read-only transaction 'database-enforced'"; the
closing instruction (J-1, removed in v8) did both. Hence "each", not "one and one". Consistent with
the V8 report, which records J-1 as the third.

### 3.7 Beyond the six — one re-wrap, disclosed

Steps V8 line 144 was a **201-character** prose line, created by my own v8 sed edit, in a document
that otherwise wraps near 100 columns. I re-wrapped it across five lines. **The word stream is
proven byte-identical** (`diff` on both regions with whitespace collapsed: identical), so this
changes presentation only. A scan of both artifacts for non-table prose lines over 115 characters
now returns only two, both pre-existing template lines inside the result-template code fence
(package 1583 and 1598, from v4 and v7).

Revert it with a re-wrap if you would rather the line stayed as it was.

---

## 4. THE SPLICE ERROR I MADE, AND HOW IT WAS CAUGHT

The M-1 bullet occupies four lines. My first splice replaced **five** — consuming line 448, the
opening line of the next bullet — which left this in the owner stop-condition list:

```
  v6, v7 and v8 respectively. **[v9]** Read step 3's list directly, every time, and record against
  it.
  in-database query can establish it;          <- orphaned continuation
- a read-only transaction cannot be **observed** `on` in the intended session …
```

The stop condition "the target cannot be confirmed by project ref, **out-of-band from the platform
console**" would have lost its opening line. I found it by printing the spliced region immediately
after the splice, discarded the whole intermediate chain, and rebuilt from the verified V8 input
with the corrected range. Nothing defective was installed; the first write to `docs/security/`
happened after this was fixed.

It is recorded here because it is the same class of error as K-1 — which was itself a splice
artifact from an earlier phase — and because the V8 report's stated lesson was that **reading the
assembled output, not the splice command, is what catches these.** That is what caught this one.

---

## 5. THE TWO FLAGGED DECISIONS

### 5.1 Version tags — factual provenance preserved, v8's cosmetic alignment reverted

The four ownership rows in the operator steps are back to **`[v6]`** (steps lines 81, 84, 86, 87),
because that is when those fields were added to *that* document — which is precisely why v7's H-1
finding was that the **package** template lacked them while the steps template had them. The
package's matching rows correctly stay **`[v7]`**.

Rather than leave the mismatch looking like an oversight, the convention is now stated in the
template itself (steps lines 90-93):

> Version tags date each field's introduction in THIS document: the [v6] rows were added to these
> operator steps in v6; the package's matching rows are tagged [v7] because the package template
> gained them in v7. The tags are not aligned across the two documents, deliberately, so that each
> stays factually accurate. [v9]

Line 27's three `[v6]` tags were not touched; they date the gate *queries*, which were introduced in
v6, and were never in question.

### 5.2 Steps line 140 → 144 — clarification preserved, misleading pointer not restored

The clarification stands. It still distinguishes the original Phase 98 package's lines 649-662 —
where the `NEEDS REVIEW` refinement actually sits — from the identically numbered lines of the
corrected package, where those lines are Item 3's RLS SQL. The only change is that the forward
pointer now names the **v9** package rather than the v8 one, so it does not become a stale live
reference. The owner's canonical identifier "lines 649-662" is retained verbatim.

---

## 6. FULL-DOCUMENT VALIDATION

Both complete artifacts were read end to end after editing — 1,697 lines and 207 lines — not
sampled, and not inferred from the diffs or the prior reports. The mechanical checks below were run
in addition to that read, not instead of it.

| Check | Result |
|---|---|
| All six defects corrected | **PASS** — §3; each verified individually by mechanical test |
| Orphaned fragments or exact duplicate adjacent lines | **PASS** — a suffix-and-duplicate detector over both artifacts reports **none**. Its only hits are the two intentional second write-in lines of the v8 rationale and unresolved-conditions fields (package 1609, 1614) |
| Malformed paragraph boundaries | **PASS** — no bold block-opener in the preamble lacks a preceding blank line |
| Ambiguous thematic breaks | **PASS** — **0** `---` directly following non-blank text, in either artifact |
| Stale live version pointers | **PASS** — **0** "v6/v7/v8 package" references and **0** `CORRECTED_V1…V8` references in the steps; the only earlier-version mentions are the superseded-list and revision rows, labelled audit history |
| Inconsistent counts | **PASS** — **0** occurrences of "two stale copies"; "eight" stop conditions, "seven" relations, "six" gate queries and "eleven" items all consistent |
| STOP banner visually distinct, complete list follows | **PASS** — blank line at 314, banner at 315, all **8** bullets at 317-346 |
| Every referenced path and hash accurate | **PASS** — all 11 `FIX3_*.md` paths cited by the package resolve on disk, as do all 3 cited by the steps; the steps cite the V9 package's correct path and full hash |
| All headings retained | **PASS** — **27** in V8 and **27** in V9; steps **10** and **10** |
| Eleven-item roll-up intact | **PASS** — 11 `### ITEM`, one `#### ITEM 10b` sub-item, `Items PASS: ___ / 11` present |
| SQL blocks byte-identical to V8 | **PASS** — `cmp` on the extracted blocks: package **359 lines identical**; the steps contain no SQL blocks, as before |
| §F query byte-identical to its approved source | **PASS** — 20 lines, sha256 **`e02bfecd0a16729f`** |
| No new SQL or execution-scope change | **PASS** — **0** write-position keywords in the extracted SQL; no `SET ROLE`, no `DO`, no temporary object, no DDL, no dynamic SQL |
| Eight stop conditions, precedence, aggregate rules, mandatory-applicability escalation, recordable aggregate fields | **PASS** — 8 bullets; v5 precedence at 354-358; v6 aggregate at 360-366; v7 four-verdict at 368-374; v8 escalation at 376-382; rationale / unresolved / escalated fields at 1607-1616 and steps 101-107 |
| Seven-relation scope, both schemas, database-level powers | **PASS** — ledger named in both `VALUES` lists; template header at 1584 reads "seven relations, two schemas, and database-level powers" |
| All six `USAGE`/`MEMBER` ownership tests | **PASS** — 7 `pg_has_role(current_user…)` calls: 3 `USAGE` (89, 180, 219) + 3 `MEMBER` (90, 181, 220) + 1 escalation `MEMBER` (194); 9 `can_set_role` references in the package, 4 in the steps |
| Session continuity and project-identity requirement | **PASS** — 3f start/end PIDs, connection-mode limitation, out-of-band ref requirement all present and unchanged |
| Migration, verification artifact, harness, app code, env files, privileges, roles | **PASS** — none touched; hashes in §2 |
| V8 and every preserved artifact byte-identical | **PASS** — §2 |

Nothing was marked INCONCLUSIVE. Every result was established from the assembled files.

### Observations — not defects, not corrected

Recorded so they are visibly judged rather than missed. None affects rendering, meaning or safety,
and none is in the authorized set.

1. **Package 1281-1282** — a double blank line before `#### ITEM 10b`. Renders identically to one.
   Pre-existing since v3.
2. **Package 1586, 1589, 1590, 1591** — four result-template lines begin at column 0 while their
   neighbours are indented two spaces. Inside a code fence the text renders exactly as written, so
   this is visual only. Pre-existing since v7.
3. **Steps line 9** — "…are **preserved as audit history** … — **its** read-only gate, Item 1
   instrument…". The singular "its" now trails a list of eight superseded packages. Grammar only;
   pre-existing since v2.

---

## 7. SAFETY BOUNDARY AND FINAL STATE

| | |
|---|---|
| Production access or any database connection | **NO** |
| SQL executed or database-parsed, incl. disposable databases and containers | **NO** |
| Role or privilege provisioned, modified or switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Staged, committed, pushed, PR'd or deployed | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** — all work in the `deploy-current-main` worktree |
| Credentials, connection strings, tokens or secrets printed | **NO** |
| Gate executed, or Fix 3 applied | **NO** |
| Any existing file modified | **NO** — three new files only |

**No claim is made that the database session is read-only, that the project identity is confirmed,
or that runtime privileges are safe.** Those are establishable only by running the gate as the
intended role in the intended session, which has not happened.

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — unchanged |
| staged | **0** |
| modified (tracked) | **78** — all pre-existing, none touched by this task |
| untracked | **55**, plus this report — including the two new V9 artifacts |

---

## 8. NEXT OWNER ACTION

1. **Verify the two V9 hashes** in §2 against the files before anything else is done with them.
2. **Confirm the two flagged decisions** read as intended (§5) — the `[v6]` tags kept factual, the
   `649-662` clarification kept — and the one disclosed re-wrap (§3.7).
3. **Provision and independently verify the dedicated, database-enforced read-only session**, run
   3a-3f as that role in the session that will run the items, and establish the connection mode.
   This remains the one thing blocking Stage A.
4. **Confirm the project ref `klkiseupptzbecbxwrky` out-of-band** from the platform console.
5. **Execute only the V9 pair** — package `2a1cd401467cb68d…`, steps `d30245bf7d7e2d1c…` — and
   return the eleven sanitized result blocks, the roll-up, and the aggregate verdict with its
   rationale and unresolved-conditions fields completed last.

**Stage A remains blocked until the owner independently establishes the read-only prerequisite, the
session, the connection mode and the project identity. Fix 3 application remains separately
unauthorized.**

---

**READY FOR OWNER VERIFICATION — V9 DOCUMENTS STATICALLY VALIDATED**
