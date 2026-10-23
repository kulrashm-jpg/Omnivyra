# FIX 3 — PHASE 100: STAGE A OWNER HANDOFF

Handoff preparation only. **Stage A has not been performed.** No production access, no SQL executed
against any database, no database or container started, no migration or schema change, no commit,
no deployment.

---

## A. WHAT THIS PHASE PRODUCED

| Artifact | Path | SHA-256 |
|---|---|---|
| Operator steps (the handoff checklist) | `docs/security/FIX3_PHASE100_STAGE_A_OPERATOR_STEPS.md` | `b490c648fd174c97884a7147204b098fdb7c233cce9a5f6f6455f360d975599f` |
| This report | `docs/security/FIX3_PHASE100_STAGE_A_HANDOFF.md` | computed on completion; recoverable with `sha256sum` |

The checklist is 174 lines. It **points to** the approved Phase 98 evidence package and deliberately
copies **none** of its SQL: zero fenced `sql` blocks, zero `SELECT`/`FROM`/`JOIN` statement lines.
The only SQL-shaped text in it is two procedural one-liners — `SELECT current_user, session_user;`
and the `BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;` wrapper — which are session hygiene, not
evidence queries. This keeps exactly one copy of each evidence query in the repository, so the
package cannot silently drift from a duplicate.

### Filename note

`FIX3_PHASE100_STAGE_A_OPERATOR_CHECKLIST.md` was the natural name and is **matched by
`.gitignore:50` (`*_CHECKLIST.md`)**, which would have hidden it from `git status`. It was renamed
to `..._OPERATOR_STEPS.md`, which is visible. Both output paths were checked against `.gitignore`
before creation, and neither existed beforehand.

---

## B. SOURCE ARTIFACTS REVIEWED

All verified by hash before use. None was modified by this phase.

| Artifact | SHA-256 |
|---|---|
| `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` (approved package) | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` |
| `docs/security/FIX3_PHASE98_OWNER_DECISIONS_AND_STAGE_A.md` | `5ccf68cac36edc550149e412d6c30c275cc23d61d3d28c55522ef5a62a0798bd` |
| `docs/security/FIX3_PHASE99_PREFLIGHT_RECONCILIATION.md` | `67c3ef826c53f9e9f197103a4d1f4ee201026baee507efa464d73c7578e8a232` |
| `docs/security/FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` (review-only) | `c6523428bfb637c050db3fab0b89fdeaf57c5acf01b3d688b960ef1b57c865ef` |
| `docs/security/FIX3_PHASE96_BEHAVIORAL_VALIDATION.md` | `ec932aa1c503c1a1c1b4af63ce0fbb3c7a2860c10cb05464562552eaa299fe9d` |
| `docs/security/FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md` | `a2374fb2ed1588989f912ee2bfb8059962c53d9103962766e0e368f0e7767a72` |
| `docs/security/FIX3_ISSUE_REGISTER.md` | `3194ea3bd4954b9b20fcd6a88b96640e97f370ad40b300fd27ca46bd97ccdc17` |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |
| Harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` |

---

## C. THE EIGHT HANDOFF STATEMENTS, VERIFIED AGAINST SOURCE

Each was checked mechanically rather than taken on trust.

| # | Statement | How verified | Result |
|---|---|---|---|
| 1 | The Phase 96 §F preflight is reproduced **verbatim** in the approved package | Extracted both blocks and compared byte-for-byte | **CONFIRMED** — 20 lines each, both sha256 `e02bfecd0a16729f`, `cmp` identical |
| 2 | Phase 99 found the original query adequate for the four composite-FK relationships | Read the Phase 99 coverage table | **CONFIRMED** — R1-R4 each `ADEQUATE`, R5 `ADEQUATE — correct exclusion` |
| 3 | The unapproved refinement at package lines 649-662 must not be used | Located the block; the `NEEDS REVIEW` marker sits at line 650, the block spans 649-662 | **CONFIRMED** — line range still accurate |
| 4 | The Phase 99 correction remains review-only, never executed or approved | Counted the explicit markers | **CONFIRMED** — "NOT EXECUTED" ×4, "not approved" ×5, plus "none of the SQL below has been parsed by PostgreSQL" |
| 5 | On a target without the expected lifecycle CHECK, STEP 6 may scan `public.content` and abort with `23514` | Read STEP 6's branches in the migration | **CONFIRMED, with a precision refinement — see section D** |
| 6 | A zero-row preflight result is not proof the migration is safe to apply | Package line 686 | **CONFIRMED** — already stated in the package |
| 7 | RLS configuration evidence is not proof of runtime authorization behavior | Package lines 775, 777 | **CONFIRMED** — already stated, with the four layers kept separate |
| 8 | Lock and scan exposure remain unresolved for production | Phase 96 line 405, Phase 97 line 585, Phase 99 line 347 | **CONFIRMED** — recorded `UNRESOLVED` in all three |

**No source conflicts were found.** Every statement the handoff rests on is supported by the
artifact it claims to come from.

---

## D. THE ONE REFINEMENT WORTH RECORDING

Statement 5 is correct but slightly imprecise as written, and the checklist uses the sharper
version. STEP 6 has **two** branches that issue `ADD CONSTRAINT … CHECK` and therefore scan
`public.content`, not one:

| STEP 6 branch | DDL | Scans `content`? | Can abort `23514`? |
|---|---|---|---|
| No CHECK covers `lifecycle_status` (`v_ncons = 0`, migration line 2434) | adds the nine-value CHECK (line 2446) | **yes** | **YES** |
| Exactly one, eight-value predecessor form (line 2498) | drops and re-adds (line 2516) | **yes** | **no** — nine values is a strict superset of eight, so every row that satisfied the old CHECK satisfies the new one |
| Exactly one, nine-value form, validated (line 2493) | none — "LEFT UNCHANGED (no DDL, no revalidation scan)" | no | no |
| More than one CHECK | none — refuses `FIX3-LIFE-02` before touching data | no | no |

So "may scan" is true of two branches; "may abort with `23514`" is true of exactly one. The
checklist records all four states and asks the operator to report which is found. This is a
sharpening of the brief's wording, not a contradiction of it.

---

## E. UNRESOLVED SOURCE AMBIGUITY

**None.** All eleven source artifacts matched their recorded hashes, all eight statements were
confirmed, and the single imprecision found (section D) resolved cleanly against the migration
source without guessing.

Two pre-existing items remain open but are **not** ambiguities in the sources — they are findings
the sources already record, and the checklist carries both forward explicitly:

1. The unapproved refinement at package lines 649-662 is defective (Phase 99) and must not be used.
   It is already labelled `NEEDS REVIEW` inside the package, so the package is safe to run as
   published.
2. Item 10 covers the foreign-key failure class only. The lifecycle-CHECK condition in section D is
   not covered by any item's data check; item 6 reveals which state the target is in, which is what
   the owner needs in order to decide.

---

## F. CONFIRMATIONS

| | |
|---|---|
| Was any SQL executed, against production or any other database? | **NO** |
| Was a production connection made or attempted? | **NO** — the configured `supabase` MCP server previously returned `CONNECT_TIMEOUT`; no connection was attempted and no alternative path was improvised |
| Was any container or database started? | **NO** |
| Does the approved evidence package remain unchanged? | **YES** — `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b`, byte-identical |
| Were there any migration or schema changes? | **NO** — the Fix 3 migration, frozen predecessor, verification artifact and harness are all byte-unchanged |
| Any commit, push, merge or deployment? | **NO** — HEAD remains `5604b50bdebd23efd6d040b90f5802954413b656`, detached |
| Was `C:\virality` accessed, traversed, read or modified? | **NO** |
| Were credentials, connection strings or secret-derived values read or exposed? | **NO** |
| Were any prior reports modified? | **NO** |
| Were the owner decisions OD-11 / OD-12 reopened or changed? | **NO** |
| **Has Stage A been performed or passed?** | **NO.** It has not been performed by this coding session, and nothing here should be read as a Stage A result. |

### Worktree

| | Before | After |
|---|---|---|
| HEAD | `5604b50b…`, detached | identical |
| staged / modified / untracked | 0 / 78 / 19 | 0 / 78 / **21** (+2 new documents) |

---

## G. PRECISE NEXT ACTION FOR THE OWNER

1. **Verify the package hash** `a0327d2ae48ba3be…` before starting. If it differs, stop.
2. **Complete the six confirmations** in section 1 of `FIX3_PHASE100_STAGE_A_OPERATOR_STEPS.md` —
   target, effective role, the role's real read-only privileges, a safe execution context, a
   non-secret target identifier, and a safe output-capture method. **If any cannot be independently
   verified, stop.**
3. **Run the eleven items** from the Phase 98 package, as published, in one session. Do not
   substitute the lines 649-662 refinement and do not run anything from the Phase 99 proposed
   correction.
4. **Return the eleven filled-in result blocks**, sanitized — no credentials, connection strings,
   tokens, personal data or raw row payloads.

Then, and only then, this programme can analyse the results. Two decisions follow that analysis and
neither is taken now: whether to adopt the Phase 99 proposed corrections, and — separately and
explicitly — whether to apply Fix 3 at all.

**Preparing this handoff is not permission to apply Fix 3.** Application requires a separate owner
decision after the Stage A evidence and an operational plan are reviewed.

This session now stops and awaits the owner's sanitized Stage A results.
