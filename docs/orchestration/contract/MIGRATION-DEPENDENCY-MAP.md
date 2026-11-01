# Migration dependency map

Derived from the SQL on `feat/orchestration-recovery` (`CREATE TABLE`, `REFERENCES`, `ALTER TABLE`), against main `5025f51d`. **None of these is applied to production by this work.** Memory records `prospect_lists` as live in production from an unmerged branch, and that needs measuring before any landing: see "Before landing".

## Orchestration stack (23 migrations)

| Version | Creates or changes | Needs from this stack | Touches existing |
|---|---|---|---|
| `20261127000000` | `prospect_lists`, `prospect_list_members` | | `canonical_leads`, `companies`, `users` |
| `20261226000000` | `prospect_campaigns` | | `companies` |
| `20261227000000` | `workflows`, `workflow_versions` | | `companies` |
| `20261228000000` | `execution_instances` | `20261226000000`, `20261227000000` | `companies` |
| `20261228000001` | `execution_plans`, `execution_plan_steps`, `execution_tasks` | `20261227000000`, `20261228000000` | `companies` |
| `20261228000002` | Step scheduling | `20261228000001` | |
| `20261229000000` | `outreach_bridge_handoffs` | `20261226000000`, `20261227000000`, `20261228000001` | `companies`, `outreach_tasks`, `unified_persons` |
| `20261230000000` | `execution_engine_requests` | `20261228000001` | `companies` |
| `20261231000000` | `prospect_campaign_lists`, `prospect_campaign_targets` | `20261127000000`, `20261226000000`, `20261228000000` | `canonical_leads`, `companies`, `prospect_icps`, `prospect_icp_versions`, `prospect_score_evaluations` |
| `20261231000001` | Engine CHECK values | `20261230000000` | |
| `20261231000002` | Community execution safety | | `community_ai_actions`, `rpa_retry_queue` |
| `20261231000003` | `community_action_journey_links` | `20261228000001` | `community_ai_actions`, `companies` |
| `20261231000004` | Social publish step channel | | |
| `20261231000005` | `rpa_auth_token_redemptions` | | |
| `20261231000006` | Community identity link | `20261231000003` | `unified_persons` |
| `20261231000007` | `identity_verification_attestations` | | `companies`, `unified_persons` |
| `20261231000008` | `engagement_request_idempotency` | | `companies` |
| `20261231000009` | Rerun safety | | |
| `20261231000010` | `rpa_session_invalidation_audit` | | |
| `20270113000000` | Handoff person link SET NULL (**needs D-2**) | `20261229000000` | `unified_persons` |
| `20270120000000` | `execution_journey_decisions` | `20261228000000`, `20261228000001` | `companies` |
| `20270120000001` | `email_outreach_content_evidence` | | `companies`, `outreach_attempts` |
| `20270120000002` | WhatsApp recipient unique key | | `whatsapp_broadcast_recipients` |

The execution contract adds **no migration**. Its fixes and the event view use existing tables.

The textual scan may miss dependencies through function bodies or dynamic SQL. Whole-chain replay on a disposable database is the check that settles order, and it passed on this branch.

## Work elsewhere that interacts with this stack

| Work | Versions | Where | Relationship |
|---|---|---|---|
| Release candidate erasure | `20270112000000`..`04`, `20270115000000` | `integration/release-candidate-5025f51d` `7bdd76ae` | Should land before E-1..E-5 erasure work. `20270113000000` sits inside this range |
| H-3 storage quarantine | `20270111000004` (RC), `20270116000000` (actor worktree) | Two copies | **Same migration under two versions: F-3** |
| PI actor-FK removal | `20270116000001`..`04` | `C:/tmp/pi-actor-fk-migrations`, uncommitted | Must be in place with writer validation before orchestration is enabled |
| PI list actors (proposed `0005`) | Not written | | `prospect_lists` actor columns armed by the same mechanism: F-4 |

## Required order

1. RC, including H-3 under one number.
2. PI actor-FK migrations with writer validation in the same change.
3. This stack, then `20270113000000` only if D-2 is signed.

## Before landing

| Check | Why |
|---|---|
| Measure which stack tables already exist in production | `prospect_lists` is recorded as live from a local-only branch. `IF NOT EXISTS` would hide a shape mismatch |
| Extend the release runbook | 19 stack migrations sort before production's 2027 versions (B-19) |
| Repeat the combined replay with the RC | Result in `RELEASE-READINESS.md` |
| Re-pin the verifier (A7-1) | B-20 |
