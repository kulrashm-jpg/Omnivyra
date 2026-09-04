# REPOSITORY CONSOLIDATION 001 — branch + SQL/data inventory

**Date:** 2026-09-04 · **Remote:** `kulrashm-jpg/Omnivyra` · **`origin/main`:** `e5ea9f07`
**Method:** read-only inventory. No database operation, no migration, no merge, no deploy, no branch deletion.

---

## 1. Executive verdict

**The SQL/data organization is already sound. The branch topology is not.**

Those are two different problems and the evidence separates them cleanly:

| Concern | Verdict | Evidence |
|---|---|---|
| Duplicate SQL artifacts | **NONE** | 0 duplicate content hashes across all 447 tracked `.sql` files |
| `database/` duplicating `supabase/migrations/` | **NO** | 0 shared filenames, 0 shared content hashes |
| One canonical location per purpose | **ALREADY TRUE, and documented** | `database/README.md` and `db-utils/README.md` both declare `supabase/migrations/` as the sole schema authority |
| Filesystem dispersion | **NOT the problem** | every SQL directory has a declared, distinct purpose |
| **Branch dispersion** | **THIS is the problem** | 22 PI commits and 28 creator commits, none in `main`; `main` is 27 behind locally |
| Local filesystem clutter | **REAL, but untracked** | `.claude/worktrees/` holds **400 MB** across two orphaned full repo copies — 830 of the 1,634 `.sql` files found on disk |

**The owner's perception that files are "spread across the platform" is accurate, but the cause is not SQL
sprawl.** It is that the work lives on branches, and that a local-only agent-worktree directory doubles every
filesystem search. Neither is fixed by moving SQL files, and moving them would make the repository worse.

**Changes made by this task: one documentation file. Nothing was moved, deleted or merged.** §8 explains why
each candidate action was rejected on evidence.

---

## 2. Branch inventory

`origin/main` = `e5ea9f07`. Counts from `git rev-list --left-right --count origin/main...<branch>`.

| Branch | Local | Remote | Ahead | Behind | Unique (non-merge) | Unmerged work | Class |
|---|:--:|:--:|--:|--:|--:|:--:|:--:|
| `feat/pi-ws6-ws7-icp-attributes` | ✅ | ✅ | **22** | 12 | **22** | **YES — all PI** | **C** |
| `feat/creator-canonical-template-pool` | ✅ | ❌ **gone** | **28** | **425** | **28** | **YES** | **E** |
| `docs/pi-baseline-audit-001` | ✅ | ✅ | 3 | 12 | 3 | superset exists | **B** |
| `feat/recover-li4b-crm-provenance` | ✅ | ✅ | **1** | 0 | **1** | **YES** | **C** |
| `feat/docs/pi-w04-plan-correction` | ✅ | ✅ | 0 | 25 | 0 | no | **A** |
| `feat/pi-p1-w06-governance-dedup-observability` | ✅ | ✅ | 0 | 24 | 0 | no | **A** |
| `feat/pi-p1-w09d-manual-outcome-entry` | ✅ | ✅ | 0 | 22 | 0 | no | **A** |
| `feat/platform-novelty-capability` | ✅ | ✅ | 0 | 26 | 0 | no | **A** |
| `feat/recover-b41-campaign-association` | ✅ | ✅ | 0 | 26 | 0 | no | **A** |
| `fix/external-api-test-env-isolation` | ✅ | ✅ | 0 | 3 | 0 | no | **A** |
| `fix/report1-primary-gap-nullability` | ✅ | ✅ | 0 | 3 | 0 | no | **A** |
| `test/competitor-candidate-classification-expectation` | ✅ | ✅ | 0 | 11 | 0 | no | **A** |
| `test/credential-contract-coverage` | ✅ | ✅ | 0 | 22 | 0 | no | **A** |
| `test/payment-webhook-e2e-coverage` | ✅ | ✅ | 0 | 22 | 0 | no | **A** |
| `verify/main-9eaa6288` | ✅ | ❌ | 0 | 2 | 0 | no | **A** |
| `verify/main-e5ea9f07` | ✅ | ❌ | 0 | 0 | 0 | no — identical to main | **A** |
| `main` (local) | ✅ | ✅ | 0 | **27** | 0 | stale checkout | — |

**Class:** A = fully merged, safe to delete · B = superseded, safe to delete · C = unique valuable work,
integrate first · D = abandoned, archive first · E = unclear, owner decision.

### Notes on the non-A branches

- **`docs/pi-baseline-audit-001` (B).** Its 3 commits (`6078dd49`, `5d87aa39`, `f41a657d`) are **fully
  contained** in `feat/pi-ws6-ws7-icp-attributes` — verified with `git merge-base --is-ancestor`. Deleting it
  loses nothing **provided the PI branch survives**. It must not be deleted first.
- **`feat/recover-li4b-crm-provenance` (C).** 1 unique commit, **0 behind** — it is `main` plus one commit.
  The cheapest branch on the list to resolve, and it is genuinely unmerged.
- **`feat/creator-canonical-template-pool` (E).** See §2.1 — this is the one that needs owner judgement.

### 2.1 `feat/creator-canonical-template-pool` — treat as valuable

Per the task's §12, this was inspected rather than assumed disposable. It is **not** disposable:

- **28 unique commits**, spanning campaign planner repair, per-post publish authorization, auth E2E CI
  hardening, payment provider enforcement, engagement/WhatsApp persistence and the creator template pool.
- **425 commits behind** `origin/main` — a very large divergence.
- **Its remote branch is GONE** (`[origin/…: gone]`) — deleted upstream while local work continued.
- **251 dirty working-tree paths** (93 modified, 158 untracked) that are **not committed anywhere**.

> ⚠ **The 251 uncommitted paths are the single largest work-loss risk in this repository.** They exist in
> exactly one place — the `C:/virality` working tree — with no commit, no branch and no remote. A checkout,
> reset or clean would destroy them. This report deliberately did not touch that working tree.

---

## 3. PI branch disposition

### Every PI commit is absent from `main`

All 18 milestones named in the task were tested with `git merge-base --is-ancestor <sha> origin/main`:

| Commit | In `origin/main`? | Kind |
|---|:--:|---|
| `a260e86e` WS-6/WS-7 ICP attribute extension | **NO** | code + **migration** |
| `41455669` WS-1 canonical prospect resolution | **NO** | code |
| `d60d431a` WS-2 enrichment planner/cost/result | **NO** | code |
| `f705025f` WS-4 ingestion integration | **NO** | code |
| `42713126` WS-2 enrichment orchestration seam | **NO** | code |
| `ef48afd4` intake → WS-2 seam | **NO** | code |
| `b9c626a5` WS-3 MarketPulse consumption | **NO** | code |
| `fd3e9268` WS-7 Account Intelligence | **NO** | code |
| `9c543467` WS-5 engagement + signals | **NO** | code |
| `94a6986a` WS-6 spine → scoring engines | **NO** | code |
| `6e06485a` WS-8 NBA + readiness | **NO** | code |
| `30188682` outcome corpus | **NO** | code |
| `6e740f1f` WS-10 API + UI | **NO** | code |
| `fc7616bf` manifest reconciliation | **NO** | docs |
| `98703c1a` WS-12 final validation | **NO** | docs |
| `bf956201` WS-12 certification caveat | **NO** | docs |
| `eed3b6ec` activation plan | **NO** | docs |
| `7bd8c1dc` Phase A/B report | **NO** | docs |
| `6d34e9a3` Phase B verification | **NO** | docs |

Plus 3 inherited baseline-audit doc commits (`6078dd49`, `5d87aa39`, `f41a657d`) — **22 unique in total**.

**None is already in `main`. None is redundant. All are still required.**

### What the PI branch actually changes vs `main`

| Area | Files |
|---|--:|
| `backend/tests/unit` | 21 |
| `docs/pmo/prospect-intelligence` | 8 |
| `backend/services/**` (prospectIdentity, leadIngestion, enrichment, leadUnderstanding, marketPulse, engagement, prospectOutreach, prospectOutcomes, prospectIcp) | 13 |
| `pages/api/prospects`, `pages/prospects`, `components/prospects`, `backend/apiHandlers/prospects` | 5 |
| **`supabase/migrations`** | **1** |

Classification: **13 code commits · 9 documentation commits · 1 migration file · 21 test files.**
Nothing on this branch is migration-only or docs-only in isolation — the migration ships inside `a260e86e`
alongside its code.

### The PI migration

| Property | Value |
|---|---|
| Path | `supabase/migrations/20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` |
| Introduced in | `a260e86e` — the only commit ever to touch it |
| SHA-256 | `e3599e56405bce091c356cd9c756456e29af7cd996a5fd577bad6e772472f4a0` |
| Git blob OID | `39f5e0b872d1c33b62ca978efb82e967bd8e304b` |
| Working tree = `a260e86e` = branch HEAD | **identical — all three** |
| On `origin/main` | **NO** |
| Modified since authoring | **No** |

**This migration must reach `main`.** It is the hard prerequisite for PI activation
(`PI-ACTIVATION-PLAN-001` §1), it exists nowhere else, and its absence from `main` is the confirmed reason the
Phase B apply did not happen — the database owner working from a `main` checkout would not have found the file.

**It was not moved, modified, recreated or applied by this task.**

---

## 4. Main-branch readiness

**`main` cannot become the sole canonical branch yet.** Three things must happen first, in this order:

1. **Resolve `feat/creator-canonical-template-pool`.** 28 unique commits, 425 behind, remote gone, and
   **251 uncommitted paths that exist in no commit anywhere.** This is an owner decision (§11) and the
   highest work-loss risk on the list.
2. **Merge `feat/pi-ws6-ws7-icp-attributes`.** 22 unique commits carrying the entire PI implementation and the
   activation-critical migration. WS-12 validated it: 1,739/1,739 tests, typecheck clean, certification
   net-new 0.
3. **Merge `feat/recover-li4b-crm-provenance`.** 1 unique commit, 0 behind — trivial.

Only then do the ten class-A branches become deletable, and `docs/pi-baseline-audit-001` (class B) becomes
deletable **after** the PI branch merges, not before.

**Local `main` is 27 behind `origin/main`** and should be fast-forwarded before any of this.

---

## 5. SQL / data inventory

**447 tracked `.sql` files.** (A filesystem scan finds 1,634 — the difference is §5.2.)

| Location | Tracked `.sql` | Category | Canonical? | Declared purpose |
|---|--:|---|:--:|---|
| `supabase/migrations/` | 391 | **A — production migrations** | ✅ **AUTHORITY** | Framework-required path |
| `supabase/migrations/rollbacks/` | 23 | A — paired rollbacks | ✅ | Co-located with their migrations |
| `supabase/migrations/_identity_spine_phase2b/` | 2 | E — historical | ✅ | Underscore-prefixed, CLI-ignored |
| `database/` | ~300 | **C/D/E — reference + operator + legacy** | ✅ | **`README.md`: "Production schema authority is `supabase/migrations/`… Do not bulk-apply this folder."** |
| `database/_archive/skipped-migrations/` | 3 | **E — archive** | ✅ | Parked so the CLI does not treat them as malformed migrations |
| `database/_archive/local-only-unused/` | 4 | E — archive | ✅ | Explicitly unused |
| `database/migrations/` | 2 | **H — ambiguous** | ⚠ | Name implies executable migration; location says otherwise |
| `db-utils/` | 11 | **C/D — legacy utilities** | ✅ | **`README.md`: "This folder is not production schema authority."** |
| `archive/legacy-lead-signals/` | 16 | **E — archive** | ⚠ | Path says archive; **no README** |
| `scripts/operator/sql/` | 3 | **D — operational** | ✅ | `seed-demo-data`, `setup-storage-buckets`, `quick-fix-migration` |
| `scripts/` (ci, ops, operator/auth) | 4 | D — operational | ✅ | Co-located with the scripts that use them |
| `docs/audit/` | 3 | **C — reference** | ✅ | Audit evidence |
| `modules/extension/database/` | 1 | F — module-owned | ✅ | Belongs to the extension module |
| **repository root** | **2** | **G/H — one-off generated rollbacks** | ❌ | `COMPANY_WEBSITE_BACKFILL_ROLLBACK.sql`, `PHASE10C_ROLLBACK.sql` |

### 5.1 `database/` is NOT a duplicate of `supabase/migrations/`

Tested directly:

- **0 shared filenames**
- **0 shared content hashes**

They are disjoint bodies of SQL with different purposes, and both READMEs say so. **Consolidating them would
destroy a documented distinction, not create clarity.**

### 5.2 The 1,634-vs-447 discrepancy — `.claude/worktrees/`

A filesystem scan finds **1,634** `.sql` files; git tracks **447**. The gap is almost entirely:

```
.claude/worktrees/agent-a2225e8e92d9ace0b/   → 392 migrations + 21 rollbacks + …
.claude/worktrees/agent-a212e37c91b008c96/   → 392 migrations + 21 rollbacks + …
```

- **Two complete, stale copies of the repository**, ~**400 MB**
- **Git-ignored** (`.git/info/exclude:11`), **0 tracked files**
- **NOT registered worktrees** — `git worktree list` does not include them; they are orphaned directories

**This is the single biggest contributor to the "files are spread everywhere" impression.** Every
`find`/`grep`/IDE search over the repository returns each SQL file three times.

**Not deleted by this task.** They are ignored, so they affect nothing in git, and this repository is known to
carry other agents' parked work — removing 400 MB of another agent's checkout without confirmation is not a
safe unilateral act. Exact owner command in §11.

---

## 6. Duplicate analysis

**No duplicates exist.**

```
git ls-files "*.sql" | sha256sum each | sort | uniq -d   →   0 results
```

**Zero duplicate content hashes across all 447 tracked `.sql` files.** No file is byte-identical to another,
so there is nothing whose removal could be justified on duplication grounds. Not one deletion candidate was
found on this criterion.

Filename-level check between the two largest directories: **0 collisions**.

---

## 7. Target repository structure

The repository already implements the correct structure. Documenting it — rather than changing it — is the
useful action:

```text
supabase/
  migrations/            # A. THE schema authority. Framework-semantic path.
    rollbacks/           #    Paired rollbacks, co-located by design.
    _identity_spine_*/   #    Underscore-prefixed → CLI-ignored historical sets.

database/                # C/D/E. Legacy / reference / operator SQL.
  README.md              #    Declares: NOT schema authority.
  _archive/
    skipped-migrations/  # E. Parked drafts, deliberately not CLI-visible.
    local-only-unused/   # E. Explicitly unused.

db-utils/                # C/D. Legacy utilities. README declares NOT authority.

archive/                 # E. Historical, superseded subsystems.

scripts/
  operator/sql/          # D. Approved operational SQL, beside its runner.
  ci/ · ops/             # D. Same principle.

docs/
  audit/                 # C. Reference SQL used as audit evidence.
  pmo/                   # Programme documentation.

modules/*/database/      # F. Module-owned SQL.
```

**Two deviations from this structure remain, both requiring owner input** — see §9 and §11.

---

## 8. Changes actually made

**One file created:**

- `docs/pmo/repository/REPOSITORY-CONSOLIDATION-001.md` — this report.

**No file was moved. No file was deleted. No branch was merged, created for code, or deleted.**

Every candidate consolidation action was evaluated and rejected **on evidence**, not caution:

| Candidate action | Rejected because |
|---|---|
| Remove duplicate SQL | **None exist** — 0 duplicate hashes (§6) |
| Merge `database/` into `supabase/migrations/` | Would break Supabase CLI semantics and destroy a documented distinction (§5.1) |
| Move the 2 root `.sql` files into `database/` | **They are referenced by TypeScript** — `scripts/backfill-company-website.ts` and `scripts/backfill-company-identity-10c.ts`, plus two companion reports. Moving them alters runtime paths. **Task §10: stop and report instead** |
| Delete `.claude/worktrees/` (400 MB) | Untracked, and may hold another agent's work — not a safe unilateral deletion (§5.2) |
| Delete the 10 class-A branches | Owner-only destructive action; commands provided in §11 |

### Why this report is on a new branch

It was **not** committed to the current checkout `feat/creator-canonical-template-pool`. That branch carries
**251 uncommitted paths of unrelated work**; adding a repository-organization commit there would entangle this
report with unfinished feature work and push to a remote that no longer exists.

This report sits on `docs/repository-consolidation-001`, branched from `origin/main` — trivially mergeable,
trivially deletable, entangled with nothing.

---

## 9. Changes deliberately NOT made

- **Production migrations** — all 391 untouched. Nothing renamed, moved, squashed or edited.
- **The PI migration** — hash-verified, not moved, not modified, not recreated, **not applied**.
- **Unique branch work** — nothing merged, rebased, squashed or deleted. The 22 PI and 28 creator commits are
  intact.
- **The 251 uncommitted paths** — untouched. The `C:/virality` working tree was not modified.
- **Remote branches** — none deleted. No force push.
- **Ambiguous files** — `database/migrations/` (2 files, name conflicts with location) and
  `archive/legacy-lead-signals/` (16 files, no README) left as-is for owner classification.
- **Application code, database, schema** — no change of any kind.

---

## 10. Risk assessment

| Risk | Severity | Status |
|---|---|---|
| **251 uncommitted paths on the creator branch exist in no commit** | **HIGH** | Untouched here. One `git checkout`/`reset`/`clean` destroys them |
| Creator branch's remote is gone; 28 commits are local-only | **HIGH** | Local `.git` is the only copy |
| PI work (22 commits + activation migration) absent from `main` | **MEDIUM** | Safe on the branch and pushed to origin |
| `.claude/worktrees/` 400 MB debris | LOW | Untracked; wastes disk and pollutes search only |
| Root-level one-off SQL | LOW | Referenced and working; cosmetic only |
| `database/migrations/` naming ambiguity | LOW | Could mislead a future operator into applying it |
| Live schema drift — **29 tables missing authoritative definitions** | **MEDIUM** | Pre-existing; see below |

### Pre-existing finding, recorded not fixed

`npm run check:schema-authority` **exits 1**:

```json
{ "ok": false, "livePublicTableCount": 869, "authoritativeSqlFileCount": 392,
  "authoritativeTableCount": 610, "missingAuthoritativeCount": 29,
  "missingRuntimeDirectReferenceCount": 15 }
```

**29 live production tables have no authoritative migration**, and 15 runtime-referenced tables are missing.
That is genuine schema drift, unrelated to this task and out of scope, but it materially qualifies the claim
that `supabase/migrations/` is the complete schema authority — today it covers 610 of 869 live tables.

---

## 11. Exact owner actions

**None of the following was executed. All are owner-only.**

### 11.1 Protect the uncommitted work (do this first)

```bash
cd C:/virality
git status --short          # expect 251 paths
git add -A && git commit -m "wip(creator): checkpoint uncommitted work"
git push -u origin feat/creator-canonical-template-pool    # its remote was deleted; this recreates it
```

### 11.2 Fast-forward local `main`

```bash
cd C:/virality && git fetch origin && git checkout main && git merge --ff-only origin/main
```

### 11.3 Get PI into `main` (unblocks activation Phase B)

```bash
gh pr create --base main --head feat/pi-ws6-ws7-icp-attributes \
  --title "PI: WS-1..WS-12 implementation, validation and activation plan"
```
22 commits. **Carries `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` — the activation prerequisite.**

### 11.4 Merge the one-commit branch

```bash
gh pr create --base main --head feat/recover-li4b-crm-provenance --title "Preserve LI4B CRM provenance"
```

### 11.5 Reclaim 400 MB (verify first)

```bash
git worktree list | grep .claude          # expect NO output — they are orphaned, not registered
du -sh .claude/worktrees                  # expect ~400M
# Only after confirming no other agent session is using them:
rm -rf .claude/worktrees/agent-a2225e8e92d9ace0b .claude/worktrees/agent-a212e37c91b008c96
```

### 11.6 Delete merged branches — ONLY after 11.3 and 11.4 land

```bash
# Class A — 0 unique commits each, verified
for b in feat/docs/pi-w04-plan-correction \
         feat/pi-p1-w06-governance-dedup-observability \
         feat/pi-p1-w09d-manual-outcome-entry \
         feat/platform-novelty-capability \
         feat/recover-b41-campaign-association \
         fix/external-api-test-env-isolation \
         fix/report1-primary-gap-nullability \
         test/competitor-candidate-classification-expectation \
         test/credential-contract-coverage \
         test/payment-webhook-e2e-coverage; do
  git branch -d "$b" && git push origin --delete "$b"
done

# Local-only verify branches
git branch -d verify/main-9eaa6288 verify/main-e5ea9f07

# Class B — ONLY after the PI branch has merged (it is a strict subset of it)
git branch -d docs/pi-baseline-audit-001 && git push origin --delete docs/pi-baseline-audit-001
```

`git branch -d` (lowercase) refuses to delete anything unmerged — it is the safety net. **Never use `-D`
here.**

### 11.7 Owner decisions required

1. **`feat/creator-canonical-template-pool`** — finish, merge, or archive? 28 commits + 251 uncommitted paths.
2. **Root `.sql` files** — leave, or move and update the two TypeScript scripts that reference them?
3. **`database/migrations/`** (2 files) — the name conflicts with the location. Rename or relocate?
4. **`archive/legacy-lead-signals/`** — add a README declaring archive status?
5. **29 tables missing authoritative definitions** — schedule the schema-authority reconciliation?

---

## 12. Final recommended topology

```text
main                          ← the only long-lived branch

  ← feat/pi-ws6-ws7-icp-attributes        (22 commits, incl. the activation migration)
  ← feat/recover-li4b-crm-provenance      (1 commit)
  ← feat/creator-canonical-template-pool  (28 commits + 251 uncommitted — OWNER DECISION)

then delete: 10 class-A branches · 2 verify branches · docs/pi-baseline-audit-001 (after PI merges)
```

File structure: **unchanged from §7** — it is already correct. The remaining work is branch consolidation and
the removal of 400 MB of untracked local debris, not SQL reorganization.

---

## 13. Confirmation

- **No database operation** — no SQL executed, no migration applied, no `db:push`, no schema or data mutation.
- **No production change.** No deploy. No merge. No branch deleted. No force push.
- **No application code, business logic or database semantics changed.**
- **No PI work modified.** The PI migration was hash-verified and left exactly as authored in `a260e86e`.
