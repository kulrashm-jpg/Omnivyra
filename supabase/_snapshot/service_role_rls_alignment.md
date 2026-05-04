# Service-Role / RLS Alignment — 2026-05-04 (Phase D, Step 5)

Phase D's baseline policy (`service_role_all`) explicitly grants service role full access to all 50 newly-secured tables. This document records why that is correct and where service-role usage should be tightened later.

## Service-role usage scan

`grep -rE "SUPABASE_SERVICE_ROLE_KEY|createClient.*service_role|supabaseAdmin|getServiceClient" backend/` returned **30 matches across 20 files**:

```
backend/db/supabaseClient.ts                                  Central admin client factory (1 hit)
backend/auth/tokenStore.ts                                    Auth token storage uses service role
backend/auth/oauthState.ts                                    OAuth state persistence uses service role
backend/scheduler/cron.ts                                     Cron worker boot uses service role
backend/workers/main.ts                                       Worker bootstrap uses service role
backend/workers/campaignPlanningWorker.ts                     Campaign planning worker uses service role
backend/services/featureCompletionService.ts                  Feature completion writes
backend/services/featureCompletionSyncService.ts              Feature completion sync
backend/services/extensionSessionService.ts                   Extension session writes
backend/services/invitationService.ts                         Invitation create/accept
backend/services/intentExecutionService.ts                    Intent execution writes
backend/services/rpaWorker/rpaAuthTokens.ts                   RPA worker token storage
backend/services/mediaService.ts                              Media upload writes
backend/utils/validateEnv.ts                                  Env validation (mention only)
backend/scripts/liveExecutionDebug.ts                         Debug script (2 hits)
backend/scripts/fullIntelligenceSystemVerification.ts         Verification script
backend/scripts/engagementPlatformIntegrationsVerify.js       Integration verification
backend/scripts/engagementPhase1Validation.js                 Phase 1 validation
backend/scripts/engagementCommandCenterDiagnostics.ts         Diagnostics
backend/tests/integration/campaign_company_scope_fix.test.ts  Integration test
```

**Pattern:** every backend code path that writes to the database goes through a service-role-backed Supabase client. Reads from anon/authenticated SDK happen primarily in:
- The Next.js client UI (via `@supabase/auth-helpers-nextjs` or similar)
- A small number of `pages/api/**` routes that use the request user's session

## Implication for Phase D's `service_role_all` baseline

For the 50 problem tables:
- **34 RLS-OFF tables**: enabling RLS + adding service_role_all → backend (service role) keeps full access; anon/auth get blocked. Backend behavior unchanged.
- **16 RLS-ON-no-policy tables**: adding service_role_all → policy made explicit; effective access unchanged (service role still has access via bypass; anon/auth were already blocked).

**Net behavior change:** anon and authenticated SDK clients lose ability to read the 34 previously-open tables. None of these tables are surfaced through the user-facing UI via the anon SDK (verified by grep: no direct `from('whatsapp_*')`, `from('active_lead*')`, etc. calls outside backend service files).

## Tables where service role is JUSTIFIED (no further hardening needed)

These tables are pure backend concerns; service-role-only is the correct end state:

| Table | Reason |
|---|---|
| `email_jobs`, `api_idempotency_keys`, `creator_execution_*`, `decision_priority_queue`, `referrals`, `report_automation_events`, `whatsapp_*` | Worker/queue internals — anon/auth never need to see these |
| `analytics_*`, `super_admin_audit_logs`, `credit_admin_grants` | Privileged-only (admin or system) — surfaced via API routes that do their own RBAC, not via direct SDK reads |
| `llm_models`, `llm_providers`, `llm_model_pricing` | Reference catalogs — service-role read is fine; could optionally add anon read later if any UI needs the model list |
| `external_api_*` | Backend telemetry — never user-visible |
| `intelligence_actions`, `lead_signals`, `canonical_backlink_signals` | Pipeline internals |

## Tables where service role is OPERATIONAL TODAY but should be HARDENED LATER (Phase D2)

These tables do have user-facing reads/writes through `pages/api/**` routes. The API does its own auth check, then writes via service role — so RLS isn't enforcing tenant isolation; the API code is. That works but is fragile (one missed `enforceCompanyAccess()` and the door opens).

| Table | Tenant column | Phase D2 task |
|---|---|---|
| `active_lead_*` (4) | `company_id` | Add `authenticated SELECT` policy keyed on `company_id` matching `auth.uid()` membership |
| `company_llm_configs`, `company_setup_progress` | `company_id` | Same |
| `creator_template_registry`, `creator_execution_audit_logs` | `company_id` (+ `user_id` for audit logs) | Same |
| `engagement_platform_preferences` | `company_id` + `user_id` | Add user-scoped policy |
| `external_api_assignments`, `external_api_connections`, `external_api_usage_logs` | `company_id` | Same |
| `feedback_submissions` | `organization_id` + `user_id` | User-scoped insert + own-read |
| `market_pulse_*` (4) | `company_id` | Company-scoped |
| `post_analytics_polls` | `company_id` + `user_id` | User-scoped |
| `report_automation_configs` | `company_id` + `user_id` | User-scoped (own-config) + admin override |
| `whatsapp_broadcasts`, `whatsapp_conversations`, `whatsapp_media_cache`, `whatsapp_templates` | `company_id` | Company-scoped |
| `contacts` | `organization_id` | Org-scoped |
| `analytics_integrations` | `company_id` | Company-scoped |
| `company_blog_*` (3 with `company_id`) | `company_id` | Company-scoped |
| `earn_credit_actions` | `organization_id` + `user_id` | User-scoped |
| `intelligence_actions` | `company_id` | Company-scoped |
| `lead_signals` | `organization_id` | Org-scoped |

**Total candidates for Phase D2: 28 tables.** None are blocked by Phase D — Phase D unblocks them by getting RLS on with a working baseline.

## Recommended Phase D2 prerequisites

Before layering authenticated policies on the 28 tables above:

1. Audit `pages/api/**` for any direct anon-key read of these tables — should be zero, but verify.
2. Define a canonical SQL helper:
   ```sql
   CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
     SELECT EXISTS (
       SELECT 1 FROM public.user_company_roles
       WHERE user_id = auth.uid()
         AND company_id = p_company_id
         AND status = 'active'
     );
   $$;
   ```
3. Add an integration test that asserts: anon SDK read of each table returns 0 rows; authenticated SDK read returns only rows for the user's companies.
4. Apply the layered policies one table at a time, with the test gating each.

This sequencing is deferred from Phase D so that the conservative baseline lands first and broken layered policies don't get bundled with the lockdown.

## What does NOT need follow-up

The 240+ pre-existing `service_role_all` tables outside Phase D scope. They are at the same baseline. Hardening them is a Phase D3 (out of current plan).
