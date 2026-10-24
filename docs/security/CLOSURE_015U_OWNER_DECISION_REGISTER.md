# CLOSURE-015U — Owner decision register

Every row below is **OPEN**. No item has been accepted or waived: acceptance requires an explicit owner decision recorded in the "Decision" column, with a name or role and a date.

**Classifications** (grounded in the cited evidence):
- **Blocker:** must be resolved before release.
- **Fix-or-accept:** release may proceed only after the owner either authorizes a fix or explicitly accepts the risk.
- **Follow-up:** not release-impacting; schedule it.

## 1. Release decisions

| ID | Decision required | Evidence | Options / recommendation | Decision |
|---|---|---|---|---|
| D-1 | Approve `4301771a` + `5444b0af` as **one release unit** and authorize an operator role for the production preflight (packet §2) | 015U packet §0; the CI real-schema tier fails on `4301771a` alone (015R §4) | approve both together, or neither | **OPEN** |
| D-2 | Deploy order | packet §3.2–3.3: (a) has a fail-closed bootstrap/promote outage from 0002 until the web deploy; (b) has no outage but no DB guards until the migrations land | **recommend (a)**, with a short window and a super-admin grant freeze | **OPEN** |
| D-3 | Confirm what deploys on merge to `main` | `railway.json` has no trigger (the dashboard setting is unknown); `vercel.json` `git.deploymentEnabled=false` | operator confirms via the Railway dashboard (P-8) | **OPEN** |
| D-4 | Authorize the real-browser passkey test (packet §5): a non-production app instance started with its configured environment, test identities A–D, a dedicated browser profile | 015T §2.1: no app running; starting one needs credential-bearing env files; no seeded SA with a passkey | authorize, and name the environment | **OPEN** |
| D-5 | Authorize the deferred RBAC contract **only after** C-7 E1–E6 pass, as a separately versioned migration | packet §4 | — | **OPEN** (not decidable until C-7) |

## 2. Risk register

| ID | Item | Existing evidence | Release impact | Proposed treatment | Classification | Decision |
|---|---|---|---|---|---|---|
| R-A | `governance_performance_guard` race: an `await` separates the check from the set | 015K (confirmed real, pre-existing, commit 27fec12d); not touched by Closure-015 | outside the Closure-015 change set; a pre-existing concurrency bug in production code | fix in a separate change, or accept with a tracking item | **Fix-or-accept** | **OPEN** |
| R-B | 53 pre-existing regression failures (15 suites, 355-suite gate) | identical at test-name level before and after every phase (0 new, 0 gone: 015M → 015R); 0 load failures | the failures exist on the release branch; Closure-015 did not cause them | accept explicitly with the list attached (`c15r/failnames.txt`), or require triage before release | **Fix-or-accept** | **OPEN** |
| R-C | **10-minute reusable, unscoped step-up**: `consumed_at` never written; `scoped_capability` not enforced; not bound to the action or the Idempotency-Key | `StepUpSessionService.ts:131-174`; resolver ignores scope (015T §2.4 SU-1) | one passkey ceremony authorizes all step-up-gated actions, including identity and lifecycle, for 10 min. Pre-existing design | accept as the deliberate convenience trade-off, or schedule per-action / single-use step-up | **Fix-or-accept** | **OPEN** |
| R-D | **Company disable/delete UI cannot step up**: bare `fetchWithAuth`; the routes require trusted-device step-up | `CompanyUsersTab.tsx:334-371` (unchanged since `origin/main`); `companies.ts:36-42, 80` | fails closed (error alert, no false success). The Closure-015 company-lifecycle guards can only be exercised by API or operator. Blocks journey J-UI-1 | fix the UI (wrap in `runStepUpFlowIfNeeded`), or accept API-only operation | **Fix-or-accept** | **OPEN** |
| R-E | `disable_company_cascade` search_path not pinned (`-- search-path-ok` annotation) | 015O A1: the function keeps its baseline body; it is SECURITY DEFINER | hardening gap carried from the baseline; not introduced by Closure-015 | a separate migration pinning `SET search_path = public` after release | **Follow-up** | **OPEN** |
| R-F | Lock in the type-check baseline gain (3 resolved errors) | certification PASS, 256/259, net-new 0 (015R §5D) | none; locking in prevents regressions | `npm run typecheck:certification:baseline` in a dedicated reviewed commit | **Follow-up** | **OPEN** |
| R-G | UI-2: provider-account toggle is optimistic | `ApiCatalogSection.tsx:305-322` | brief false success on screen; the server state is correct | fix in a later UI change | **Follow-up** | **OPEN** |
| R-H | UI-3: "Trust this device" may show a failure after succeeding (409 `ALREADY_TRUSTED` on the retry) | `superAdminStepUp.ts:43-54`; `trust.ts:59`; plausible from code, **unconfirmed in a browser** | false failure, not false success | confirm in J6, then fix | **Follow-up** | **OPEN** |
| R-I | `onChallengeStart` banners use the green "success" styling | 015T §2.4 (cosmetic) | cosmetic | later UI change | **Follow-up** | **OPEN** |

**Release blockers** (from the existing release criteria, not from this register):
- the production preflight evidence;
- the browser passkey evidence;
- explicit push/merge/deploy authorization;
- the production migrations;
- C-7 before the deferred contract.

See the packet, §6.

## 3. Disposable resources: retained, cleanup prepared (NOT executed)

All are labelled `purpose=closure015r-throwaway`, `restart=no`, bound to 127.0.0.1, and **exited**. They hold no secrets: the throwaway passwords and JWT secrets were deleted in 015R.

| Resource | Full ID | Image | State | Owned resources | Evidence it holds |
|---|---|---|---|---|---|
| container `c15r-ci` | `b6aa66a6c7ada49ab7b49c755086eb6bc4f172132709896b0d343b4c57011086` | `pgvector/pgvector:pg17` | exited | anonymous volume `04099220eaae4deabb21885e1b0f908ceea59ff1a16911d941539f35472cdd43` (used only by `c15r-ci`) | **the original 015P CI-mode failure**: its `w6` DB holds the downgraded guard |
| container `c15r-ci2` | `5b4d06aeca0b05e50701eb041f9b07bac98f5b24570c2b3840cc224cb5892b33` | `pgvector/pgvector:pg17` | exited | anonymous volume `fc859d75535bc76863d4a7aa185d70df26904413809e2f0279c094e2e7bb8149` (used only by `c15r-ci2`) | the CI-mode replays `w6`, `w6final`, `w6final2`, `w6p`, `w6p2` |
| container `c15r-db` | `df521f00a730391c22ee6b40680abc4c108c723eac164aac0be7a62a93e97cfc` | `supabase/postgres:17.6.1.167` | exited | none (no mounts) | the Supabase-faithful copy (interim contract) |
| container `c15r-rest` | `fba4e8d92ad1b13f948e4f1026acc9180ecb3d95dd7cfcdc7bdb5bc8d37b8eea` | `supabase/postgrest:v16.2` | exited | none | PostgREST for the copy |
| network `c15r-net` | `313f0ddd980e718f3deba922829263d39d8800db9bb0943daf9aa878ca5a2927` | — | no members attached | — | — |

**What to keep.** The textual evidence lives in the session scratchpad (`c15r/`, `c15s/`) and in the reports. The containers matter only if the owner wants to **re-inspect** the original failure (`c15r-ci`) or the copies.

**Decision D-6:** authorize cleanup after the evidence review. **OPEN.**

**Prepared command (for later approval).** It removes resources by full ID, only after each ID's label is re-verified, and touches nothing else (`cert-supabase` and `par-test` are excluded):
```bash
set -e
for id in b6aa66a6c7ada49ab7b49c755086eb6bc4f172132709896b0d343b4c57011086 \
          5b4d06aeca0b05e50701eb041f9b07bac98f5b24570c2b3840cc224cb5892b33 \
          df521f00a730391c22ee6b40680abc4c108c723eac164aac0be7a62a93e97cfc \
          fba4e8d92ad1b13f948e4f1026acc9180ecb3d95dd7cfcdc7bdb5bc8d37b8eea; do
  [ "$(docker inspect "$id" --format '{{index .Config.Labels "purpose"}}')" = "closure015r-throwaway" ] || { echo "label mismatch for $id — abort"; exit 1; }
done
docker rm -v b6aa66a6c7ada49ab7b49c755086eb6bc4f172132709896b0d343b4c57011086 \
             5b4d06aeca0b05e50701eb041f9b07bac98f5b24570c2b3840cc224cb5892b33 \
             df521f00a730391c22ee6b40680abc4c108c723eac164aac0be7a62a93e97cfc \
             fba4e8d92ad1b13f948e4f1026acc9180ecb3d95dd7cfcdc7bdb5bc8d37b8eea   # -v removes their anonymous volumes
[ "$(docker network inspect 313f0ddd980e718f3deba922829263d39d8800db9bb0943daf9aa878ca5a2927 --format '{{index .Labels "purpose"}}')" = "closure015r-throwaway" ] \
  && docker network rm 313f0ddd980e718f3deba922829263d39d8800db9bb0943daf9aa878ca5a2927
```
