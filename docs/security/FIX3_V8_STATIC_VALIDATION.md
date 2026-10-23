# FIX 3 — V8 CORRECTION AND STATIC REVALIDATION

Document-only correction and static validation. No database connection, no SQL executed or parsed,
no role or privilege change, no migration applied or modified, no container or CI harness, no
production access, no commit. **No runtime claim is made about the session, the project identity or
the effective privileges, and Fix 3 application remains separately unauthorized.**

---

## 1. OUTCOME

**V8 CORRECTIONS COMPLETE AND STATICALLY VALIDATED.** Not BLOCKED.

All four authorized corrections (J-1…J-4) and the authorized version-annotation alignment are
implemented and verified against the assembled files. The mandatory document-wide structural
validation found **no remaining non-authoritative live restatement** of the stop conditions, and
**no live instruction** that describes the transaction read-only setting as a database-enforced
guarantee. Every regression check passes. Zero SQL changed.

**Five pre-existing defects remain and were NOT corrected**, because this brief authorized exactly
five changes and none of these is among them (§6). All five predate v7; none alters, weakens,
removes or renames any stop condition, changes the gate's scope, or changes any verdict rule. I
judge none safety-relevant in the sense that triggers BLOCKED, and state that judgement explicitly
rather than leaving it implied — **K-3 is the closest call** and is described so the owner can
overrule me.

**Stage A itself remains BLOCKED.** That is unchanged, and is a prerequisite the owner has not yet
met (a dedicated, independently verified, database-enforced read-only session), not a finding of
this task. The two senses of "blocked" are deliberately kept apart here.

---

## 2. CHANGED FILES AND HASHES

| File | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V8.md` **(new)** | `1fe6eae32dd3b2c854cd1f1f389d3ca50f29298344cf2014845b08bc8cf9c0c1` | 1,692 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V8.md` **(new)** | `83973eb8c05bea9c14bc494faedaaee11ce49b88e1d7dedad3b2d732325c4e4b` | 202 |
| `docs/security/FIX3_V7_STATIC_VALIDATION.md` **(new)** | `68c445b6633d0d72d883929d9d2370893acb3e9d5e50bff48834013549de322b` | 236 |
| `docs/security/FIX3_V8_STATIC_VALIDATION.md` **(this file, new)** | recorded on delivery | — |

Nothing else was written. **No existing file was modified.**

**Why the V7 report is here.** The v8 package's revision row cites `FIX3_V7_STATIC_VALIDATION.md`.
That report had been produced but never installed, so the citation would have dangled and the
regression check "every referenced file accurate" would have failed. It is installed **verbatim**,
as the record of what the V7 pass concluded. §7 corrects its errors rather than editing it.

### Inputs verified before editing

| Artifact | Expected | Actual | |
|---|---|---|---|
| v7 package (1,670 lines) | `78ce050f0d351fc1…c40c` | same | **MATCH** |
| v7 steps (193 lines) | `f7fb70d727ec7232…82eb` | same | **MATCH** |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, **detached**, as required. Worktree
`C:/tmp/deploy-current-main` (gitdir `C:/virality/.git/worktrees/deploy-current-main`); the primary
working tree was not accessed.

### Preserved artifacts — unchanged, re-hashed AFTER the edits

| Artifact | SHA-256 | |
|---|---|---|
| Original Phase 98 package | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | **unchanged** |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | **unchanged** |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | **unchanged** |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | **unchanged** |
| CI harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | **unchanged** |
| v7 package | `78ce050f0d351fc135d79b2a73f83ed09b3e38dff3fd1ed5231dcba358cbd40c` | **unchanged** |
| v7 steps | `f7fb70d727ec7232c8f2ccc7c89ecc2f0da96b5dd9e26d2ce6326d65d74882eb` | **unchanged** |

v1 through v6 of both artifacts were not opened for writing and are untouched.

---

## 3. CORRECTIONS APPLIED

The package diff is **four hunks plus the revision row, and nothing else**; the steps diff is nine
hunks. Both diffs were read line by line.

```
package:  26a27   371a373,380   397,400c406,412   1589a1602,1611
steps:    8,9c8,9   27c27   79c79   81c81   84c84   86,87c86,87   94a95,103   101c110   131c140
```

### J-1 — single authoritative stop-condition list — **FIXED** (package 406-411)

The third stale live restatement is gone. It no longer enumerates a narrower scope and no longer
calls the transaction read-only; it points at the authoritative list and at the template that
records it:

> If every stop condition is clear, do **not** write "read-only verified". Record what step 3's
> stop-condition list establishes, field by field, against the read-only gate block of the result
> template in section 6. **That list is authoritative and is not restated here** — read it
> directly, every time. Record `transaction_read_only` as **observed `on` in this session**, which
> is a **session safeguard and not a database-enforced guarantee**, and record the project ref as
> confirmed out-of-band. That is what was established, and no more. **[v8]**

The observed-versus-enforced distinction is preserved and now stated at the point of recording.

### J-2 — aggregate-verdict recordability — **FIXED** (package 1602-1611, steps 97-103)

Rationale, unresolved conditions and an escalation field added in **both** artifacts. The four
conjuncts, the verdict line, the NOT-READY rule and "fill LAST" are all retained unchanged above
them. Unresolved conditions must list every STOP / FAIL / UNKNOWN-on-present / INCONCLUSIVE **and
every mandatory check whose applicability could not be established**, with `NONE` permitted only
when there are none — so the field cannot be left silently empty.

### J-3 — escalation — **FIXED** (package 373-379, steps 95-96)

A new `[v8]` paragraph immediately after the four-verdict rule:

> **[v8] Where applicability is mandatory or unresolved, `NOT APPLICABLE` is not available.** If a
> check is mandatory, or if whether it applies cannot be established from the evidence actually
> obtained, the disposition is `INCONCLUSIVE`, the aggregate verdict is **not ready**, and the
> condition must be **escalated to the owner or platform administrator** — entered in the result
> template's unresolved-conditions field and raised, not merely filed. …

Fail-closed precedence (v5), aggregate readiness (v6), the four-verdict rule (v7) and all eight
stop conditions are untouched and still precede it.

### J-4 — Markdown rendering — **FIXED** (package 412)

Blank line inserted; `4. **Wrap the work in a read-only transaction**` now renders as a distinct
list item.

### Version annotations — **ALIGNED AS INSTRUCTED** (steps 81, 84, 86, 87)

`[v6]` → `[v7]` on the four ownership rows. Field semantics unchanged.

**One caveat the owner should know, because the instruction was explicit and I followed it.** The
`[v6]` tags were *provenance-accurate for the steps document*: those four fields were added to the
steps template in v6, which is precisely why v7's H-1 finding was that the **package** template
lacked them while the steps template had them. Tagging them `[v7]` makes the two documents
consistent, which is what was asked, at the cost of implying the steps fields are newer than they
are. Line 27's three `[v6]` tags were **left alone** — they date the gate *queries*, not these
template rows, and were outside the instruction. Reverting the four tags is a one-line change if
you prefer accuracy over consistency here.

### Stale pointers — **FIXED** (steps 8, 9, 27, 79, 110, 140)

Required by the regression list ("no stale V6/V7 references except clearly labelled provenance").

| Line | Was | Now |
|---|---|---|
| 8 | v7 path + hash | **v8 path + `1fe6eae3…c0c1`** |
| 9 | superseded list ended at v6 | **v7 added** (`78ce050f0d351fc1…`), labelled audit history |
| 27 | "gate queries in the **v6 package's** section 1" | **v8 package's** |
| 79 | "Read-only gate (**v6 package**, step 3)" | **v8 package** |
| 110 | "`78ce050f0d351fc1…`, the CORRECTED package" | **`1fe6eae32dd3b2c8…`, the CORRECTED v8 package** |

**Line 140 is a change beyond the five enumerated corrections, flagged for that reason.** It read
"The refinement at **package lines 649-662** is unapproved". I verified both readings: lines
649-662 of the **original Phase 98 package** are exactly the `NEEDS REVIEW` refinement, while lines
649-662 of the v7/v8 package are Item 3's RLS SQL — so the pointer silently misdirected any
operator who followed it into the package they are told on line 8 to run from. It now reads "the
refinement at the **ORIGINAL Phase 98 package's** lines 649-662 … in the v8 package it is the block
marked `NEEDS REVIEW` inside Item 10. **[v8]**". This preserves the owner's own canonical identifier
for that refinement verbatim and changes nothing about which block is condemned. Revert it if you
would rather it stayed as it was.

---

## 4. DOCUMENT-WIDE RESTATEMENT INVENTORY

Not limited to the four known locations. Both complete artifacts were read in full, and every
mention of the stop conditions, of the relation/schema scope and of "database-enforced" was
enumerated and classified.

### Package — stop-condition mentions

| Line(s) | Mention | Class |
|---|---|---|
| **320-352** | the eight-bullet list | **AUTHORITATIVE** |
| 353-357 | "Still eight conditions" change log | commentary — no scope claim |
| 36-38 | "what changed from the original … its stop conditions" | historical |
| 27-33 | revision rows v2…v8 | **historical provenance**, labelled |
| 102 | `CREATEROLE` rationale, "would otherwise pass every stop condition" | live reference |
| 347 | "No ninth stop condition has been added" | live reference |
| 351-357 | v5 precedence rule | live reference |
| 358-362 | v6 aggregate readiness | live reference |
| 364-371 | v7 four-verdict rule | live reference |
| **373-379** | **v8 escalation rule (new)** | live reference |
| 381-385 | session continuity, "separately from the eight" | live reference |
| 387-397 | NULL / absent / UNKNOWN rule | live reference |
| 399-403 | no discipline-only route | live reference |
| **406-411** | **"what to write" (was J-1)** | **live reference** ✔ fixed |
| 440-456 | "Stop conditions for the owner" | live reference (fixed in v7) |
| 458-460 | no discipline-only fallback | live reference |
| 1587-1588 | template fail-closed line | live reference |
| 1596-1601 | template aggregate block | live reference |
| 1650-1655 | section 7 | live reference |

**No non-authoritative live restatement remains.** Every live mention either references step 3's
list or states a rule about how verdicts combine; none re-enumerates the conditions or the scope.

### Scope — "six" versus "seven"

Two mentions of "six" survive, both correct:

- **253** — "for the **seven** named relations only — the six `public` relations plus
  `supabase_migrations.schema_migrations`" — an accurate decomposition of seven.
- **445** — "…one claiming six relations…" — **historical**, describing the removed stale copies
  inside the v7 cross-reference.

Scope is stated consistently as **seven relations, both schemas, and database-level powers**:
package 253-257 (prose), 320-352 (the list), 1579-1586 (template header and rows); steps 27, 79-87.
The migration ledger is named in both `VALUES` lists (3b, 3c) and has its own template rows in both
documents.

### "database-enforced" — 14 mentions, none a live claim about the transaction setting

| Class | Lines |
|---|---|
| Historical revision rows | 27, 28, 29 |
| The owner's requirement for a read-only **session** (not the transaction) | 40, 399, 459, 1653, 1655 |
| Correctly locating enforcement in **privilege and ownership** (3a/3b/3c/3e) | 267, 452 |
| Correct **negations** — "SC-6 alone does not establish database-enforced read-only access" | 276, 336 |
| Correct negation, **new in v8** — "session safeguard and not a database-enforced guarantee" | 410 |
| Historical quotation of the removed claim, labelled | 446 |

The steps artifact contains **zero** occurrences of "database-enforced" and **zero** of "six
relation". `transaction_read_only` is described as a session safeguard at package 272-277, 278-283,
452-453 and 1589, and at steps 104 — consistently, and never as a substitute for privilege
verification.

---

## 5. REGRESSION RESULTS

| Check | Result |
|---|---|
| Five preserved artifacts byte-unchanged (re-hashed after editing) | **PASS** — §2 |
| v7 pair byte-unchanged; v1-v6 untouched | **PASS** |
| V8 artifact paths and cross-references correct | **PASS** — steps cite the v8 path and full hash; 0 `CORRECTED_V7` and 0 "v6 package" references remain; the v8 revision row's citation of `FIX3_V7_STATIC_VALIDATION.md` now resolves |
| Headings retained | **PASS** — **27** in v7 and **27** in v8; none lost, none added |
| Eight stop conditions intact, none added or weakened | **PASS** — 8 bullets in the authoritative block |
| Ownership `USAGE` and `MEMBER` fields distinct in both templates | **PASS** — separate named columns and separate fields; 9 `can_set_role` references in the package, 4 in the steps |
| All six ownership tests represented | **PASS** — 7 `pg_has_role(current_user…)` calls: 3 `USAGE` (88, 179, 218) + 3 `MEMBER` (89, 180, 219) + 1 escalation `MEMBER` (193) |
| Aggregate verdict: four conjuncts + rationale + unresolved conditions + escalation | **PASS** — both artifacts |
| `NOT APPLICABLE` never a silent PASS; escalation required where applicability is mandatory or unresolved | **PASS** — package 364-379, steps 93-96 |
| Approved Phase 96 §F query byte-identical | **PASS** — extracted and hashed: **`e02bfecd0a16729f`**, 20 lines |
| Item 10b still a sub-item; eleven items; `/ 11` roll-up | **PASS** — 11 `### ITEM`, one `#### ITEM 10b`, roll-up present |
| Markdown list rendering around step 4 | **PASS** — blank line at 412; step 4 is a distinct item |
| No new SQL write operation or expanded execution authority | **PASS** — every SQL block is **byte-identical to v7** (`cmp` on the extracted 359 lines). The only two keyword hits are benign: `'TRUNCATE'` as a privilege *name* inside `has_table_privilege`, and the mandated `SET TRANSACTION READ ONLY` |
| No migration change, no scope change | **PASS** — migration hash unchanged; scope still seven relations, two schemas, database-level powers |

Nothing was marked INCONCLUSIVE. Every result above was established from the assembled files.

---

## 6. REMAINING DEFECTS — NOT CORRECTED, NOT AUTHORIZED

All five predate v7. None is among the five authorized corrections, so none was touched.

| ID | Defect | V8 line | Class |
|---|---|---|---|
| **K-1** | **Orphaned duplicate fragment.** Line 393 ends "…Item 11 is INCONCLUSIVE and that is recorded, not inferred away." and line 394 repeats its tail: "INCONCLUSIVE and that is recorded, not inferred away." A splice artifact. | **394** | duplicated text, no semantic change |
| **K-2** | No blank line before "**What these six checks establish — and what they do not.**"; it merges into the 3f PID paragraph. | **251** | rendering |
| **K-3** | No blank line before "**STOP — do not run items 1 through 11 — if any of these holds:**"; the STOP banner renders inside the preceding project-identity paragraph instead of as its own block. | **312** | rendering — **the closest call** |
| **K-4** | No blank line before "A separate, narrower condition: if 3b reports `sel = false`…". | **395** | rendering |
| **K-5** | `---` on line 1424 immediately follows list text on 1423 with no blank line, so the thematic break is ambiguous with a setext heading underline. | **1424** | rendering |
| **M-1** | "restating it is how **two** stale copies came to exist" — three have now been found; J-1 was the third. The v8 revision row records it correctly, so the document is internally inconsistent on the count. | **445** | stale historical count |

**On K-3, explicitly.** The banner's text is present, bold, and immediately followed by the eight
bullets, which render correctly because line 313 is blank. What degrades is prominence, not content
or completeness, and no stop condition is altered. That is why I did not treat it as a
safety-relevant failure — but it is the one I would put in front of the owner first, and overruling
me costs one blank line.

Fixing all six is six mechanical edits — five blank-line insertions, one deleted line, one word —
with no semantic change. They are offered as a v9, not taken.

---

## 7. CORRECTIONS TO THE V7 REPORT

The V7 report is installed verbatim as the record of that pass. Three of its statements are wrong
and are corrected here rather than by editing it:

1. **"Headings: 26 in v6 and 26 in v7."** The count is **27** in both. The check that mattered —
   that no heading was lost between versions — held, and still holds at 27 in v8; the number
   reported was wrong.
2. **"Every referenced file and hash accurate — 0 stale v6 pointers."** Wrong. The steps artifact
   carried **two** stale "v6 package" pointers, at lines 27 and 79, both inside live instructions.
   Both are fixed in v8. A third incorrect reference — the `649-662` line pointer — was also
   missed.
3. **"Orphaned or duplicated lines: none found."** Wrong. K-1 was present at v7 line 385, and four
   missing-blank-line defects (K-2…K-5) were also missed; the V7 report asserted that paragraph
   boundaries were "correct throughout the gate and aggregate sections" on the basis of four
   spot-checked line numbers rather than a full boundary scan.

The V7 report's substantive findings — both hashes matching, H-1 passing, and J-1 through J-4 — are
confirmed by this pass.

**Root cause, stated plainly.** Three audits in a row found a stale restatement, and this audit
found that the previous one had also under-reported. The common cause in both cases is **checking a
property at the locations where it was last found instead of across the whole document**. The
restatement class is now closed by inventory (§4). The rendering class is **not** closed: K-1…K-5
were found only because this pass read both files end to end, and a full boundary scan — not a spot
check — is what would keep them closed.

---

## 8. SAFETY BOUNDARY AND FINAL STATE

| | |
|---|---|
| Production access or any database connection | **NO** |
| SQL executed or database-parsed, incl. disposable databases and containers | **NO** |
| Role or privilege provisioned, modified or switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Commit, stage, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** — work was in the `deploy-current-main` worktree |
| Credentials, connection strings, tokens or secrets printed | **NO** |
| Gate executed, or Fix 3 applied | **NO** |
| Any existing file modified | **NO** — four new files only |

**No claim is made that the database session is read-only, that the project identity is confirmed,
or that runtime privileges are safe.** Those are establishable only by running the gate as the
intended role in the intended session, which has not happened.

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — unchanged |
| staged | **0** |
| modified (tracked) | **78** — all pre-existing, none touched by this task |
| untracked | **53** — including the four new files |

---

## 9. NEXT OWNER ACTION

1. **Review the five enumerated corrections and the two flagged extras** — the `[v6]`→`[v7]`
   provenance trade-off (§3) and the `649-662` disambiguation (§3, steps line 140). Both are
   single-line reverts.
2. **Decide on K-1…K-5 and M-1** (§6). Six mechanical edits; none changes meaning.
3. **Provision and independently verify the dedicated, database-enforced read-only session**, then
   run 3a-3f as that role, in the session that will run the items, and establish the connection
   mode. This remains the one thing blocking Stage A.
4. **Confirm the project ref `klkiseupptzbecbxwrky` out-of-band** from the platform console.
5. **Execute only the v8 pair** — package `1fe6eae32dd3b2c8…`, steps `83973eb8c05bea9c…` — and
   return the eleven sanitized result blocks plus the roll-up and the new aggregate fields.

**Stage A remains BLOCKED on the read-only prerequisite, and application of Fix 3 remains
separately unauthorized.**
