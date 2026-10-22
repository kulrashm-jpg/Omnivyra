# CLOSURE-015V — Final owner decision sheet

**Every decision is OUTSTANDING.** None has been approved: an entry changes only when the release owner records an explicit decision, with role and date.

Evidence and the fuller rationale are in `CLOSURE_015U_OWNER_DECISION_REGISTER.md` (`8415df63…`) and `CLOSURE_015T_RELEASE_READINESS_REVIEW.md` (`a1ce873b…`).

| ID | Decision | Evidence summary | Recommendation | Classification | Owner decision | Date |
|---|---|---|---|---|---|---|
| V-1 | Approve `4301771a` + `5444b0af` as **one release unit**; authorize a named production operator role for Phase A of the operator checklist | both local, unpublished; the CI real-schema tier fails on `4301771a` alone (015R §4); all local/cert/copy gates passed (015P–015S) | approve together; authorize Phase A | Release gate | **OUTSTANDING** | |
| V-2 | **Migration-first sequencing** (migrations 0001–0004 → 20261211000001 → deploy) | old app (`origin/main`) bootstrap writes SA directly, so 0002 → fail-closed bootstrap/promote outage until the web deploy; the DB guards protect the old app immediately (015U §3) | approve migration-first; keep the window short; freeze SA grants (break-glass: owner SQL) | Release gate | **OUTSTANDING** | |
| V-3 | **Confirm Railway auto-deploy behaviour** on merge to `main` | not determinable from the repo (`railway.json` has no trigger); the web deploy is manual (`vercel.json`) | operator records it from the dashboard (checklist P-8c) before the merge | Release gate | **OUTSTANDING** | |
| V-4 | **Authorize the non-production browser passkey test** | no app running; cert has 0 active and 0 invited SUPER_ADMIN rows; startup needs credential-bearing settings (015V sheet §1) | authorize: start the cert app with its configured env; create identities I-1, I-2, I-4 (confirm I-3); enroll a passkey for I-1; dedicated browser profile | Release gate | **OUTSTANDING** | |
| V-5 | Deferred RBAC contract | allowed only after C-7 E1–E5 pass and E6 is recorded; fresh version; separate review | decide after C-7 | Release gate (post-deploy) | **OUTSTANDING** (not decidable yet) | |
| V-6 | **53 pre-existing regression failures** (15 suites) | identical at test-name level across 015M→015R (0 new, 0 gone); not caused by Closure-015; list in `c15r/failnames.txt` | explicit acceptance with the list attached, or triage first | Fix-or-accept | **OUTSTANDING** | |
| V-7 | **`governance_performance_guard` race** | confirmed real, pre-existing (015K; 27fec12d); untouched by Closure-015 | accept with a tracking item, or fix separately | Fix-or-accept | **OUTSTANDING** | |
| V-8 | **10-minute reusable, unscoped step-up** | `consumed_at` never written; `scoped_capability` unenforced (015T SU-1); pre-existing design | accept as a trade-off, or schedule per-action / single-use step-up | Fix-or-accept | **OUTSTANDING** | |
| V-9 | **Company disable/delete UI gap** (no step-up flow; fails closed) | `CompanyUsersTab.tsx:334-371`, unchanged since `origin/main` (015T UI-1) | accept API/operator-only until a UI fix, or fix before release | Fix-or-accept | **OUTSTANDING** | |
| V-10 | Follow-ups:<br>(a) pin `disable_company_cascade` search_path;<br>(b) lock in the type-check baseline gain (`npm run typecheck:certification:baseline`);<br>(c) minor UI: optimistic provider toggle (UI-2), trust-device false failure (UI-3, confirm in J6), green challenge banner | 015O A1; 015R §5D (256/259, net-new 0); 015T §2.4 | schedule after the release | Follow-up | **OUTSTANDING** | |
| V-11 | **Cleanup of the retained `c15r-*` resources** | 4 exited containers (`c15r-ci` `b6aa66a6…`, `c15r-ci2` `5b4d06ae…`, `c15r-db` `df521f00…`, `c15r-rest` `fba4e8d9…`), 2 anonymous volumes, network `c15r-net` `313f0ddd…`; all labelled `closure015r-throwaway`; no secrets | approve after the evidence review; use the ID-based, label-verified command in the 015U register §3 | Follow-up | **OUTSTANDING** | |

**Release state: BLOCKED — OPERATOR EVIDENCE REQUIRED.**
