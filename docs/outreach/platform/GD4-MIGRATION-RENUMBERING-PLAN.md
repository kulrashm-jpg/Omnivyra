# GD-4: migration renumbering plan for the 23 migration-quality violations

**Status: PLAN ONLY. No file is renamed.**
- Requested by the owner on 2026-11-09: "finish A first, design GD-4".
- Execution needs:
  - the owner's approval of this plan;
  - sign-off from each owning track (§5);
  - a read-only production ledger check (§6).

Basis: foundation `a746ad268` (local); the gate is `scripts/check-migration-quality.js`. **Release: NO-GO.**

## 1. What the 23 are

None is an SQL defect. All 23 are numbering problems.

| Group | Count | Rule broken |
|---|---|---|
| A | 19 | The version is at or below the attested applied boundary `20270111000003`, but the file is **not in the attestation** (`scripts/migrations/applied-boundary.json`, production catalog 2026-11-01, 93 ledger rows). The work was numbered into already-applied history. |
| B | 4 | The version is registered `occupied_elsewhere` in `version-reservations.json`, held by `integration/outreach-engines-20261102`. |

**Group A** (dates 2026-11-27 to 2026-12-31):
- `pi_prospect_lists`
- `pi_prospect_campaigns`
- `pi_workflow_definitions`
- `pi_execution_instances`
- `pi_execution_plans`
- `pi_execution_step_scheduling`
- `pi_outreach_bridge`
- `orchestration_engine_requests`
- `orchestration_campaign_targeting`
- `orchestration_engine_requests_engines`
- `community_execution_safety`
- `community_journey_link`
- `social_publish_step_channel`
- `extension_dispatch_safety`
- `community_identity_link`
- `identity_verification`
- `engagement_request_idempotency`
- `migration_rerun_safety`
- `rpa_legacy_session_invalidation`

**Group B:**
- `20270113000000_outreach_bridge_handoffs_person_erasure_set_null`
- `20270120000000_orchestration_journey_decisions`
- `20270120000001_pi_email_content_evidence`
- `20270120000002_whatsapp_broadcast_recipient_unique`

## 2. Why "above every other claim" cannot be applied literally

The recorded GD-4 note says to renumber "into the integration branch's block above every other claim". Doing that literally would put Group A **after** the migrations that build on it, so a fresh database build (CI real-schema, `supabase db push`) fails.

Dependencies measured by object name (a static scan, so it may under-report):

| Group A migration | Later migrations that use its objects |
|---|---|
| `pi_execution_instances` | `20270113000000`, `20270120000000`, `20270127000000` (`execution_instances`) |
| `pi_execution_plans` | `20270113000000`, `20270120000000`, `20270127000000` (`execution_plans`, `execution_plan_steps`, `execution_tasks`) |
| `pi_execution_step_scheduling` | `20270127000000` (`execution_step_anchor`, `advance_execution_plan`) |
| `pi_outreach_bridge` | `20270113000000`, `20270120000001` (`outreach_bridge_handoffs`) |
| `extension_dispatch_safety` | `20270120000010`, `20270126000001` (`claim_community_ai_browser_command`) |

Within Group A, the earlier files are used by the later ones (for example lists → campaigns → workflows → instances → plans), so their **relative order must be kept**.

## 3. Proposal

**R-1. Group A: move into the free gap, keeping the order.**
- **New versions:** `20270111100000` … `20270111100018`, in the current order. These sit above the boundary (`20270111000003`) and above `20270111000004` (the last attested-adjacent file).
- **Every dependent stays after them.** The first dependent is `20270113000000`, and the first possibly related later file is `20270112000000`.
- **The gap is free.** No reservation and no file exists in `20270111000005`–`20270111999999`; the only `20270111*` entries are `…000000`–`…000004`, all merged.
- **Content is unchanged.** Each file is a pure `git mv`, and its sha256 is proven equal before and after.
- **Gate effect:** the 19 "numbered into applied history" violations disappear. The ordering rule (floor `20261026000000`) and the reservation rule are both satisfied once the 19 versions are reserved with their slugs.

**R-2. `20270120000000`, `…0001`, `…0002`: no renumbering. Correct the registry instead.**
- Every branch that holds these versions carries the **byte-identical** file:

  | Version | Blob | Holders |
  |---|---|---|
  | `…0000` | `dd728eac2` | `feat/orchestration-recovery`, the integration branch, the foundation and 56 refs |
  | `…0001` | `2b19e4212` | the same |
  | `…0002` | `480130f2a` | the integration branch, `feat/orchestration-recovery` and the foundation |

- The holder named in the registry is an **ancestor** of this checkout. The "collision" is the same migration carried forward, not two migrations sharing a number.
- **Fix:** change those three registry entries from `occupied_elsewhere` to `reserved` with their slug. Renumbering them would only move the files away from their dependents.

**R-3. `20270113000000`: a real conflict; the owner decides.**

| Copy | Blob |
|---|---|
| The foundation (also on `feat/orchestration-recovery` and 56 refs) | `67d3b85b1` |
| `privacy/a6-10-bridge-setnull` | `ae1f87206`, a **different** file at the same version |
| `privacy/a6-10-rollbacks` | holds a rollback for it |

Options:
- **R-3a.** Reconcile the two into one canonical file at `20270113000000`. Privacy and PI decide which content wins; registry as in R-2.
- **R-3b.** Renumber the foundation's copy to `20270113100000`. It has no later dependent, and it still sorts after `pi_outreach_bridge` (R-1) and the `20270112*` erasure migrations.

**Recommendation: R-3a.** Two different migrations meant for the same table should not both ship.

## 4. Blast radius (every file that names one of the 23 versions)

Counted on the foundation, excluding `supabase/`, `node_modules` and `.git`: **about 300 references**, from 7 to 29 per version. They include:
- **Application code:** `backend/services/prospectLists/store.ts` and `backend/services/rpaWorker/rpaRetryQueue.ts`, which name versions in messages and requirements. Each must be read before editing, to tell a comment from a contract.
- **Release tooling:** `scripts/release/catalog-fingerprint.sql` and `scripts/release/grants-acl-check.sql`.
- **The programme record:** `docs/programme/milestones.json`.
- **About 10 unit suites that pin versions**, including:
  - `communityExecutionSafety.migration`
  - `extensionDispatchSafety.migration`
  - `migrationRerunSafety`
  - `orchestrationCampaignTargets`
  - `orchestrationCommunityJourneyLink`
  - `orchestrationTargetingContract`
  - `piLists002MigrationContract`
  - `safetyTestSuitesSelector`
  - `verifySchemaParityCoverage`
- **Rollbacks:** 1–8 rollback files per version reference it, and some rollbacks are **named** by version (for example the a6-10 rollback).
- **PI's certification fingerprints:** any fingerprint over these files' names or paths must be re-pinned by PI. This includes the four held PI fingerprint updates on `ca5f3082f`.

The exact per-file list is regenerated at execution time by the scan in §7. It is not frozen here, because other tracks keep adding references.

## 5. Ownership (sign-off needed before execution)

| Files | Owner | Sign-off |
|---|---|---|
| `pi_*` (8 files, including `20270120000001`) | PI | Content unchanged; fingerprints re-pinned |
| `orchestration_*`, `community_*`, `extension_dispatch_safety`, `social_publish_step_channel`, `identity_*`, `engagement_request_idempotency`, `migration_rerun_safety`, `rpa_legacy_session_invalidation`, `20270120000000` | Orchestration (c7) | c7 is currently unreachable (sessions restarted 2026-11-09) |
| `20270113000000` (R-3) | Privacy (a6-10) with PI | Canonical content decision |
| `20270120000002_whatsapp_broadcast_recipient_unique` | Outreach | Registry change only (R-2) |

Outreach does not rename another track's file without that track's sign-off ("Do not modify c7-owned files without coordination").

## 6. Production prerequisite (read-only, needs authorization)

Renumbering is only safe for migrations that are **not applied anywhere real**. If production's ledger already holds one of these versions, renaming it makes `db push` apply the same DDL a second time.

**Required before execution:** a read-only query of `supabase_migrations.schema_migrations` in production for the 23 old versions and the 19 new ones, by a path that creates no login role.

**The attestation is no longer current:**
- On 2026-11-09, `20270202000000` was applied to production out-of-band, deliberately without a ledger row.
- The same read should therefore re-attest the boundary.

Staging and beta: the same check, if they are kept.

## 7. Execution steps (after approval)

1. **Branch:** create `outreach/gd4-renumber` from the foundation head.
2. **Re-scan:** re-run the reference scan (`gd4deps.js`, a read-only Node script in the planning session's scratchpad; to be added under `scripts/migrations/` if the plan is approved) and freeze the list.
3. **R-1:** `git mv` the 19 files to `20270111100000`–`…18`, proving each sha256 unchanged. Rename the version-named rollbacks the same way.
4. **R-2 and R-3:** apply the R-2 registry change, and R-3 as decided.
5. **Registry:** add the 19 new reservations (slug, owner, `CODE_VERIFIED`, "renumbered from …"), and mark the old versions `retired` with a pointer. The registry format may need a `retired` status; if the gate does not know it, that is a gate change and a separate review.
6. **References:** update every reference from step 2. Application-code strings are read individually; tests that pin a version are updated, never deleted.
7. **Verify:**
   - migration-quality: the 23 resolved, nothing new;
   - a fresh real-schema chain build on pg-sandbox;
   - replay and rollback of the renamed files on a copy;
   - the full real-schema suite;
   - typecheck-ci and the backend-tests typecheck, compared by name;
   - then a combined T2 against the current foundation.
8. **Handover:** one commit per owning track (PI, Orchestration, Outreach), so each track reviews only its own files. The privacy item is a separate commit.

**Expected result:** migration-quality goes from 23 violations to 0, or to 1 if R-3 is still open. The 7 known FK/NOT NULL findings are separate (`set-null-known-defects.json`, forward remediation) and are not affected.

## 8. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| GD4-1 | Approve R-1: the order-preserving gap, not "above every other claim" | Approve |
| GD4-2 | Approve R-2: registry correction, no renumbering, for the three identical copies | Approve |
| GD4-3 | R-3a (reconcile) or R-3b (renumber) for `20270113000000` | R-3a |
| GD4-4 | Authorize the read-only production ledger check and re-attestation (§6) | Authorize |
| GD4-5 | Route PI and Orchestration sign-off; Orchestration needs a reachable session or its owner | — |
