# REPOSITORY-HYGIENE-001 — Branch Isolation & Merge Readiness Certification

**Type:** Repository governance / certification-only. No product code changed; no history rewritten; no other agent's work modified.
**Branch under certification:** `feat/company-profile-conversation-intelligence` @ `a894652c`
**Verdict:** ✅ **COMMIT STACK IS MERGE-READY & FULLY ISOLATED.** ⚠️ Working tree is **not** clean — it carries an **actively-growing parallel workstream** that must be landed on its own branch by its owner. Merge CONV-INTEL **via commits only (PR / fast-forward)**; never `git add -A`.

---

## Executive Summary

The CONV-INTEL commit stack (8 commits, `f6cda8d0`…`a894652c`) is **linear,
single-purpose, independently attributable, and fast-forwardable onto `origin/main`**.
**Zero** of its commits touch any file of the concurrent competitor-intelligence
workstream. The only hygiene defect is in the **working tree**, not the commit
history: 18 uncommitted files belonging to a separate, **currently-active**
competitor-intel program share the checkout. Because a commit-based merge does not
carry uncommitted files, the CONV-INTEL stack is safe to merge today — provided the
merge is done through its commits and the working tree is not blindly staged.

Per this package's Stop Condition, the parallel work is **identified, classified,
and a corrective action is recommended** — it is **not** modified, stashed, or
committed here (it is another agent's live work; the file set grew 9 → 18 during
this certification, proving the workstream is active).

---

## Phase 1 — Repository State Report

| Item | State |
|---|---|
| Current branch | `feat/company-profile-conversation-intelligence` |
| HEAD | `a894652c` |
| Merge base with origin/main | `95babf96` |
| origin/main | `95babf96` |
| Local `main` | `bce850d9` (diverged from origin/main — cosmetic; do not use as merge reference) |
| Ahead / behind origin/main | **ahead 8 / behind 0** |
| Rebase / merge / cherry-pick / revert in progress | **none** |
| Upstream of current branch | tracks `origin/main` (never pushed to its own remote) |
| Uncommitted files | **18** (parallel competitor-intel workstream) |
| Staged files | 0 |
| Stashes | 3 (`BRANCH-001` ×2, `carousel-phase-a`) — other parties'; untouched |
| Other local feature branches | `feat/strategic-recommendation-intelligence` (0/5), `feat/intel-egress-coordination-foundation` (1/5), `feat/writer-wave0-stabilization` (26/0) |

---

## Phase 2 — Branch Ownership Matrix

Every modified file has exactly one owner. Two disjoint sets:

### Set A — CONV-INTEL commit stack (committed, in `origin/main..HEAD`)
| Owning program | Feature branch | Files |
|---|---|---|
| Company Profile Conversation Intelligence (CONV-INTEL-001…004) | `feat/company-profile-conversation-intelligence` | `companyKnowledgeGraph.ts`, `profileConversationOrchestrator.ts`, `chatKnowledgeExtraction.ts`, `pages/api/company-profile/{define-target-customer,define-campaign-purpose,index,completeness}.ts`, 12 test files, 3 `docs/pmo/CONV-INTEL-*.md` |

### Set B — Parallel workstream (uncommitted, in working tree only)
| Owning program | Destination | Files (18) | Confidence |
|---|---|---|---|
| Competitor Intelligence Re-Architecture (2026-07-23 "Embro" evidence-only fix) | **its own dedicated branch (does not yet exist)** | `entityArchetype.ts`; `companyProfileService{Core,Rest1Enrich,Rest1Rest2Competitors,Rest1Rest2Pulse}.ts`; `competitorEngineService{EngineDiscovery,EngineRankingFinal,EngineRankingScore,Model}.ts`; `competitorCandidateAssembly.ts`; `reportCompetitorIntelligenceService{Engine,Model}.ts`; tests: `competitorEngineService`, `reportCompetitorIntelligenceService`, `reportCompetitorStrategyService`, `snapshotReportService`, `competitorCandidateAssembly`, `competitorIdentityCapabilityGuard` | **HIGH** (filename domain + content signature + corroborating program record; zero overlap with Set A) |

**Classification of every file:** every file is either *belongs to current branch* (Set A,
committed) or *belongs to another active workstream* (Set B, uncommitted). **None**
uncertain; **none** shared between the two sets.

---

## Phase 3 — Parallel Workstream Isolation

| Question | Determination |
|---|---|
| Owner | Competitor Intelligence Re-Architecture workstream (separate active agent) |
| Destination branch | A dedicated competitor-intel branch — **must be created by its owner** (none of the existing local branches is its home) |
| Should it be committed? | **Yes — by its owner, on its own branch.** Not here. |
| Should it be stashed? | **No** — the workstream is active (file set grew 9→18 mid-certification); stashing would remove live files from under the working agent. |
| Should it be discarded? | **No** — it is real, type-clean, in-progress work. |
| Requires manual review? | **Yes** — owner must review/commit; note it also edits `companyProfileServiceRest1Rest2Pulse.ts`, which *defines* CONV-INTEL's `saveProfile` seam (see Phase 6 — no logical dependency, but the same file is edited by both programs). |

**Action taken here: isolation by identification only.** No file in Set B was
modified, moved, stashed, committed, or discarded — consistent with "do not modify
another agent's work" and this package's Stop Condition ("recommend the corrective
action; do not perform unrelated implementation work").

---

## Phase 4 — Commit Stack Certification

| Property | Result |
|---|---|
| Linear history | ✅ 0 merge commits in `origin/main..HEAD` |
| Independently certifiable commits | ✅ each certified at commit time (CONV-INTEL-001…004) |
| Mixed-purpose commits | ✅ none — every commit changes only company-profile-conversation files (+ its own docs/tests) |
| Unrelated changes in any commit | ✅ none — **0** of the 18 Set-B files appear in **any** of the 8 commits |
| Accidental squash effects | ✅ none — 8 discrete commits, one purpose each |

**Certified stack (base → tip):**
```
f6cda8d0  Phase A — knowledge graph foundation
ee255630  Phase B — canonical readiness
60fbcc33  Phase C — conversation orchestrator + pilot
39a396ee  Phase D — multi-field chat extraction
b777f1e2  Phase E — completion intelligence
6dd0e70f  CONV-INTEL-002 — readiness consolidation
e7625ef9  CONV-INTEL-003 — campaign-purpose adoption
a894652c  CONV-INTEL-004 — production certification (docs)
```

---

## Phase 5 — Merge Readiness Report

| Check | Result |
|---|---|
| Working tree clean | ❌ 18 parallel files dirty (Set B) — **not** in the commit stack |
| Staged unrelated files | ✅ none staged |
| Unresolved conflicts | ✅ none |
| Correct merge base | ✅ `95babf96` (origin/main) |
| Fast-forward status | ✅ `origin/main` is an ancestor of HEAD → **fast-forward possible** |
| Branch divergence | ✅ ahead 8 / behind 0 vs origin/main |
| Remote synchronization | branch not pushed; compares against `origin/main` |
| Merge target | `origin/main` |

**The COMMIT STACK is merge-ready.** The working-tree dirtiness does not enter a
commit-based merge, but a merge must therefore be performed via **PR or explicit
fast-forward of the commits** — **never** `git add -A` / `git commit -a`, which would
sweep Set B into the CONV-INTEL branch.

---

## Phase 6 — Repository Hygiene Validation

| Check | Result |
|---|---|
| Orphaned changes | ✅ none |
| Duplicated work | ✅ none (Set A vs Set B disjoint) |
| Hidden modifications | ✅ none — full working tree accounted for |
| Accidental dependency on another branch | ✅ none — CONV-INTEL builds only on `origin/main`; Set B is not required to compile Set A (backend certification of the stack passed at net-new 0) |
| Implementation leakage | ✅ none — no Set-B symbol referenced by Set-A commits |
| Feature flags unchanged | ✅ rollout kit (`lib/platform/rollout.ts`) **not** modified in the stack; every flag default declared in the stack is `'off'` |

**Note on the shared file `companyProfileServiceRest1Rest2Pulse.ts`:** it *defines*
`saveProfile` (CONV-INTEL's persistence seam) **and** is edited by Set B. CONV-INTEL
depends only on the **committed** (origin/main) version of `saveProfile`; Set B's
uncommitted edits to that file are not part of the CONV-INTEL stack and do not affect
it. This is a *file-level* overlap, not a *logical* dependency — but it is the one
place the two programs touch the same file, so the owner should merge in a
deterministic order (see Phase 8) to avoid a textual conflict.

---

## Phase 7 — Production Safety

| Check | Result |
|---|---|
| Production behavior changes | ✅ none (all flags default OFF; byte-identical OFF certified in CONV-INTEL-004) |
| Runtime changes | ✅ none on the OFF path |
| API changes | ✅ none when OFF |
| Configuration drift | ✅ no `config/` change in the stack |
| Environment drift | ✅ no `.env` / Vercel / Railway change |
| Migration drift | ✅ no `migration` / `.sql` change |
| CI drift | ✅ no `.github/` change |

---

## Phase 8 — Release Readiness & Recommendation

**Active branches vs origin/main:**
- `feat/company-profile-conversation-intelligence` — ahead 8 / behind 0 (**this branch; ready**)
- `feat/strategic-recommendation-intelligence` — ahead 5 / behind 0 (Strategic Recommendation Intelligence / PR #4 lineage; ready)
- `feat/intel-egress-coordination-foundation` — ahead 5 / behind 1 (Program B lineage; slightly stale)
- `feat/writer-wave0-stabilization` — ahead 0 / behind 26 (fully superseded; no unique work)
- Competitor Intelligence Re-Architecture — **no branch yet**; lives only as 18 uncommitted files

**Recommended merge sequence:**
1. **Competitor-intel owner first isolates their work:** create a dedicated branch and commit the 18 Set-B files there. This clears the working tree and gives that program an attributable home. (Owner action — not performed here.)
2. **Merge `feat/company-profile-conversation-intelligence`** to `origin/main` via PR/fast-forward (lands **dark** — zero runtime change).
3. Merge `feat/strategic-recommendation-intelligence` (independent).
4. The competitor-intel branch merges when its own certification completes; because it and CONV-INTEL both edit `companyProfileServiceRest1Rest2Pulse.ts`, whichever merges second rebases onto the first (trivial — disjoint regions of the file).

**PR / review / certification ownership:** each program owns its own PR, review, and
certification doc (`docs/pmo/CONV-INTEL-00{1..4}`, competitor-intel’s forthcoming doc).
**Rollback point:** `origin/main` @ `95babf96` — deterministic (CONV-INTEL is additive
+ flag-dark; reverting the 8 commits restores exactly `95babf96` behavior).

---

## Final Repository Certification

The `feat/company-profile-conversation-intelligence` **commit stack is certified
isolated, single-purpose, linear, production-safe, flag-dark, and fast-forwardable —
SAFE TO MERGE via its commits.**

Repository hygiene is **not yet fully restored at the working-tree level**: an active
competitor-intelligence workstream (18 uncommitted files) shares the checkout. This is
**classified and its corrective action recommended** (owner commits it to a dedicated
branch); it is **not** modified here.

**Success-criteria status:**
| Criterion | Status |
|---|---|
| every modified file has exactly one owner | ✅ (Set A / Set B, disjoint) |
| every engineering program isolated | ✅ at commit level; ⚠️ Set B awaits its own branch (owner action) |
| every branch has one purpose | ✅ CONV-INTEL branch is single-purpose |
| every commit independently attributable | ✅ |
| no unrelated work in the merge branch (commits) | ✅ |
| working tree clean | ❌ 18 active foreign files — recommend owner isolation before push |
| merge target correct | ✅ `origin/main` |
| branch production-ready | ✅ (as a commit stack) |
| rollback deterministic | ✅ `95babf96` |

**Bottom line:** CONV-INTEL is safe to merge now via PR/fast-forward. The single
required precaution is procedural: **do not `git add -A`**; let the competitor-intel
owner land Set B on its own branch to clear the working tree.
