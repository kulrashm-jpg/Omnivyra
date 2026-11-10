# Outreach foundation: five-checkpoint programme dashboard

As of 2026-11-08. Foundation branch `outreach/foundation-base-20261104`, head `aa703406c` before this docs commit (local, unpushed).

**Governing sequence.** The five checkpoints of the owner ruling of 2026-11-04 (register, "Owner ruling, Checkpoint 1"): A T2 baseline → B migrations → C route fixes → D cross-workstream responses → closures.
- This dashboard does not extend that scope.
- Work discovered later is kept in `FOLLOW-UP-REGISTER.md`. It never substitutes for an original item.
- No checkpoint is marked complete on a proposal, a local implementation alone, or a passing test on a different commit.

**Release: NO-GO.** Nothing is pushed, merged to main, deployed or applied to a real database.

## Summary

| # | Checkpoint | State | Verification level and exact commit |
|---|---|---|---|
| 1 | T2 baseline at `1daf12601` | Done; evidence preserved | T2 at `1daf12601` only |
| 2 | Five migrations `20270125000000`–`04` | Done to the authorised level (local, disposable DB); not applied; not wired | Forward, rollback and re-forward at `3926654ce`; forward-only in every later T2 |
| 3 | Two route corrections | Each verified locally | Introduced at `086106170`; T2 at `7f2ca186f`; by name at `f89277e66` |
| 4 | External dependencies | Partial; blocked | — |
| 5 | Four closures A–D | **None complete.** Integrated acceptance not started | — |

## Checkpoint 1: T2 baseline

- **Original scope:** a T2 at unmodified `1daf12601`, reported before any migration.
- **Evidence (register Step A, commit `7da1d900d`):**
  - real-schema 73/75 suites passed, with 8 tests failed;
  - typecheck-ci and worker clean;
  - 10/10 gates passed;
  - whole-repo: 81 failures, 60 in the 31 Oct baseline and 21 attributed to W1/P-A at `5a8b5ed04`;
  - none attributed to foundation work.
- **This evidence covers `1daf12601` only.** Later T2 runs are separate evidence of later heads:

| Head | Coverage |
|---|---|
| `7f2ca186f` | full |
| `662d824be` | full |
| `7486e3ffb` | full |
| `34cbe9a04` | full |
| `73b79929a` | stages A and B only |
| `f89277e66` | full |

## Checkpoint 2: the five migrations

| Original migration | Commit | Owner | Depends on | Replay / rollback evidence | Status |
|---|---|---|---|---|---|
| `20270125000000_engagement_canonical_classification` | `3926654ce` | Outreach | SC7-R ratification (amend the CHECK if the codes change) | `3926654ce`: forward, idempotent re-apply, CHECK accept/refuse by name, rollback, re-forward | Unapplied; not wired |
| `20270125000001_outreach_outcome_complained` | `3926654ce` | Outreach | CR-4 (Orchestration, no response) | Same; the rollback refuses while a `complained` row exists | Unapplied; not wired |
| `20270125000002_outreach_outcome_recipient_link_source` | `3926654ce` | Outreach | SC-4 (Orchestration, no response) | Same; the rollback refuses while a `recipient_link` row exists | Unapplied; not wired |
| `20270125000003_engagement_auto_reply_default_off` | `3926654ce` | Outreach | Operator decision at apply time for existing tenants | Same | Unapplied |
| `20270125000004_social_accounts_meta_client_refs` | `3926654ce` | Outreach | `resolveClientRef` code fix; WhatsApp blocked | Same; refuses a database already holding an unsafe value | Unapplied |

- The five files and their rollbacks are byte-unchanged from `3926654ce` to the current head.
- Rollback is proven at `3926654ce` only. Later T2 runs apply them forward, most recently at `f89277e66` (136 migrations).
- **Precondition before wiring any writer:**
  - a real-schema write as `service_role`;
  - a separate non-owner, NOBYPASSRLS refusal test for `anon`/`authenticated`.

**Later migrations, kept separate.** These are not substitutes for the five.

| Migration | Commit | Owner | Status |
|---|---|---|---|
| `20270125000005` provider evidence reconciliation | `3f1c405a2` | Outreach (D2) | Integrated; `service_role` suite 9/9 |
| `20270126000000`–`03` community safety | `47a8c5388` | Orchestration (Prompt 3) | Integrated |
| `20270127000000` execution step not_before | `620a438fd` | Orchestration (Prompt 4) | Integrated |
| `20270127000001`–`05` G-11 | `8a0e7a037`, `d4aa71852`, `57104655a`, `d16a5e3ac` | Orchestration | Integrated; `0004` grant fix merged at `bdc45d8d2` |
| `20270127000006` reason redaction | `e3cc7f877` | Orchestration | Integrated |
| `20270128000000`–`03` | `96c314795` | Outreach (N/M fixes) | Integrated |
| `20270128000004` broadcast recipient person | `a37bb85f4` | Outreach | Integrated |
| `20270127000007` address/phone redaction | — | Orchestration | Design only |
| `20270127000008` guard hardening | — | Orchestration | Under review; **not in this integration** |
| `20270127000009` Block re-deciding | — | Orchestration | Held |
| `20270129000000` `enforced_channels` | reservation `7a34fa6ba` (merged at `aa703406c`) | Orchestration | Proposal only; version reserved, no file |

All are local, applied only to disposable pg-sandbox clusters.

## Checkpoint 3: two route corrections

| Item | Change | Security / regression evidence | Exact commits |
|---|---|---|---|
| **5. Super-admin thread resume** | `resumeThreadPublish` applies `authorizePostPublish`; 409 `THREAD_NOT_AUTHORIZED`, audited | `publishThreadUncertainOutcome`: 5 refusals and 2 controls. Gate-removed mutant: the 5 refusals fail and the controls pass | Introduced at `086106170`; T2 at `7f2ca186f`; at `f89277e66`: 31/31, `executionAuthorityInventory` 38/38 |
| **6. Direct LinkedIn/X reply removed** | `social/comments` reply answers 410 `REPLY_REMOVED`; no replacement call | `socialCommentsReplyRemoved`; egress "removed" row (no fetch, plus a control); `routeAuth001SocialOAuth` (cross-tenant and own account); stale allowlist entry removed (FU-10 `5ee390cc6`) | Introduced at `086106170`; FU-10 `5ee390cc6`; at `f89277e66`: 6/6, egress 20/20, 83/83, `routeAuthOrdering` 36/36 |

- The route implementation files are unchanged since `086106170`.
- **Gap:** item 6 has no recorded mutation run.

## Checkpoint 4: external dependencies (actual responses)

| Party | Response recorded | Accepted interface → existing implementation, owner | State |
|---|---|---|---|
| Content Platform | None. Named accountable (ruling item 2), but no person or session assigned | — | Blocked: C-CP-1; A-3 and A-4 blocked |
| Platform AI | None recorded. Named accountable (ruling item 3) | — | Blocked: C-6 (cache bypass, `gpt-chat`/`claude-chat`) |
| PI | **SC-7:** technical read, amendments adopted into the draft. **CR-PI1:** no `unified_person_id` writer; the governance store is canonical, but social/community use is not proven | Codes in Outreach's own columns (`20270125000000`); consent reuses `contact_governance_records` (PI). No new store | Partial: CN-1..CN-3 are owner decisions |
| Orchestration | **CR-X-01:** accepted (`0679a5908`). **D-02:** delivered and integrated (`9c460a238`). **CR-SC7 Q-4, CR-SC4/CR-4, SC-3, SC-6:** no response recorded. **CR-OR-RACE:** requested, closure not recorded | D-02 approval binding (Orchestration) | Partial |
| Billing | CR-BL1 not sent: no lead | — (no ledger write; charged sends blocked) | Blocked: BL-A |

## Checkpoint 5: the four closures

**No closure is complete. The integrated acceptance scenario has not started.**

| Closure | Design | Authorisation | Implementation / verification | Missing |
|---|---|---|---|---|
| **A Content** | Reconciliation matrix; `CONTENT-LIMITS-AUTHORITY.md` | Ruling items 2, 8 | A-1, A-2 verified T1 (`4ce2d83ed`); D3 `12c161305` | A-3, A-4 (C-CP-1); SC-3; not wired to a send path |
| **B Engagement** | SC-7 vocabulary; `SHARED-CONTRACTS-D4.md` | Ruling item 9 (requests) | B-1 verified T1 (`c889087b9`) | SC7-R, Q-4; migration `…0000` unapplied; B-2, B-3 blocked |
| **C Governance** | Matrix; entry-path inventory | Ruling items 1, 5, 6 | C-1 integrated; C-2 D-02 (`9c460a238`); C-4 verified T2; CR-X-01 `0679a5908` | C-3 operator decision; C-5 race follow-ups; C-6 Platform AI |
| **D Engines** | `ENGINE-READINESS-D7.md` | Ruling item 7 | D-1 with D2 verified T2 (`3f1c405a2`; `service_role` 9/9 at `f89277e66`); D-2 documented | D2-R; D-3 WhatsApp blocked; D-4 release integration; D-5 (SC-4, BL-A) |

## Outstanding owner decisions (original scope)

| ID | Decision |
|---|---|
| GD-4 / REL-07 | Renumber the 23 migrations flagged by migration-quality (the gate fails until then) |
| D2-R | Who runs reconciliation: a cron job (with `ALWAYS_RUN_JOBS`) or an operator |
| SC7-R | Ratify the codes; answer Q-1, Q-2, Q-3 and Q-5 |
| BL-A | Appoint the Billing lead, or answer CR-BL1 directly |
| CN-1..CN-3 | Consent store scope, action-scoped restrictions, positive consent before DMs |
| C-CP-1 | Name the Content Platform owner |
| CL-1..CL-6 | Content-limit discrepancies, for their owners |
| Security owner | `PROSPECT_PERSON_ERASE` in the security-owned capability files |
| — | Notes held in append-only evidence |
| — | Widening the permanent-failure code list |

## Dependencies and blockers

- No named Content Platform owner and no Billing lead.
- No Platform AI response.
- Orchestration owes Q-4, SC-4/CR-4, SC-3, SC-6 and CR-OR-RACE.
- The migration-quality gate fails on the 23 GD-4 files.
- `pi_email_send_path_041a`: 10 real-schema failures in every full T2 since `73b79929a`. The suite passes alone; the cause is not established.
