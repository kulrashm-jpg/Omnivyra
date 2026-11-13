/**
 * Cross-tenant access allow-list (tenant-seam plan, owner-approved 2026-11-12).
 *
 * A call that must stay on `ownedDbTable` / `supabase.from` against a TENANT table (it legitimately spans
 * tenants, or it runs before any tenant is known) carries a marker on the line directly above the call:
 *
 *     // cross-tenant: <id>
 *
 * and <id> must be an entry here. scripts/check-tenant-seam.js refuses a marker whose id is not listed, so the
 * allow-list cannot be self-granted inline. Adding an entry is a reviewed change (GOV-SECURITY 83 + 05).
 * Each entry names the table(s), the file it may appear in, why it is cross-tenant, and its owner.
 */
export type CrossTenantEntry = {
  id: string; tables: readonly string[]; file: string; reason: string; owner: string;
  /**
   * INTERIM entries only (e9 ruling 2026-11-13): the migration version whose PROD APPLICATION ends this entry.
   * scripts/check-tenant-seam.js FAILS (rule R11, in every mode) once version-reservations.json records that version
   * with applied_in_prod: true while this entry still exists - so an interim allow-list cannot silently become
   * permanent.
   */
  exitWhenApplied?: string;
};

export const CROSS_TENANT_ALLOW_LIST: readonly CrossTenantEntry[] = [
  {
    id: 'wa-webhook-shared-number',
    tables: ['social_accounts'],
    file: 'backend/queue/jobProcessors/whatsappWebhookProcessor.ts',
    reason: 'an inbound Meta webhook names a phone_number_id, not a tenant; the lookup resolves WHICH tenant owns it (the shared-number guard refuses ambiguity)',
    owner: 'virality-6f',
  },
  {
    id: 'content-architect-search',
    tables: ['company_profiles', 'campaigns', 'campaign_versions', 'recommendation_snapshots'],
    file: 'pages/api/content-architect/search.ts',
    reason: 'platform search for a Content Architect session (isContentArchitectSession, route-auth platform level): finds any company, campaign or recommendation by id, name or URL so the architect can open it; spans tenants by design and returns ids and names only',
    owner: 'virality-55',
  },
  {
    id: 'scheduled-lead-detection-fanout',
    tables: ['lead_jobs_v1'],
    file: 'backend/scheduler/schedulerIntelligenceJobs.ts',
    reason: "the scheduled lead-detection cron enumerates eligible companies and inserts ONE PENDING job row per company in a single bulk insert (HARDEN-004); each row's company_id is set from that system enumeration (rowFor(companyId)), never from input. The per-company fallback path uses tenantTable(systemTenantContext)",
    owner: 'virality-55',
  },
  {
    id: 'scheduled-posts-user-anchored-scheduler-schedule',
    tables: ['scheduled_posts'],
    file: 'pages/api/scheduler/schedule.ts',
    reason: "USER-ANCHORED campaign-less scheduled_posts write (no campaign => no tenant parent for the child seam; scheduled_posts has no company_id until 20270217000028). Every statement is predicated on the acting user: the INSERT stamps user_id from the session (requireUserId), never the body. Evidence: schedulerScheduleAccountOwnership.test.ts; s2UserAnchoredScheduledPosts.test.ts (static pin)",
    owner: 'virality-55',
    exitWhenApplied: '20270217000028', // 028 scheduled_posts.company_id: then convert to tenantTable on company_id (read the constraints first)
  },
  {
    id: 'scheduled-posts-user-anchored-schedule-reschedule',
    tables: ['scheduled_posts'],
    file: 'pages/api/schedule/reschedule.ts',
    reason: "USER-ANCHORED campaign-less scheduled_posts write (no campaign => no tenant parent for the child seam; scheduled_posts has no company_id until 20270217000028). Every statement is predicated on the acting user: .is('campaign_id', null).eq('user_id', session user). Evidence: scheduleRescheduleTenantBinding.test.ts (A on B's campaign_id NULL post -> 404)",
    owner: 'virality-55',
    exitWhenApplied: '20270217000028', // 028 scheduled_posts.company_id: then convert to tenantTable on company_id (read the constraints first)
  },
  {
    id: 'scheduled-posts-user-anchored-legacy-posts',
    tables: ['scheduled_posts'],
    file: 'backend/services/structuredPlanSchedulerExecDaily.ts',
    reason: "USER-ANCHORED campaign-less scheduled_posts write (no campaign => no tenant parent for the child seam; scheduled_posts has no company_id until 20270217000028). Every statement is predicated on the acting user: insert stamps user_id = input.userId (the route's session user); update / cancel / publish-now are .eq('id').eq('user_id', input.userId). Evidence: s2UserAnchoredScheduledPosts.test.ts (another user's legacy post is untouched by update / cancel / publish-now)",
    owner: 'virality-55',
    exitWhenApplied: '20270217000028', // 028 scheduled_posts.company_id: then convert to tenantTable on company_id (read the constraints first)
  },
  {
    id: 'scheduled-posts-user-anchored-scheduler-retry',
    tables: ['scheduled_posts'],
    file: 'pages/api/scheduler/retry.ts',
    reason: "USER-ANCHORED campaign-less scheduled_posts write (no campaign => no tenant parent for the child seam; scheduled_posts has no company_id until 20270217000028). Every statement is predicated on the acting user: .eq('user_id', user.id) on all 4 compare-and-set updates (Closure-010 owner authority). Evidence: schedulerRetryTenantAuthority.test.ts (a caller-supplied user id cannot reach a teammate's post: 404)",
    owner: 'virality-55',
    exitWhenApplied: '20270217000028', // 028 scheduled_posts.company_id: then convert to tenantTable on company_id (read the constraints first)
  },
  {
    id: 'intelligence-governance-sa-platform-presets',
    tables: ['external_api_sources'],
    file: 'backend/services/intelligenceGovernanceService.ts',
    reason: "Super Admin platform API preset writes (pages/api/admin/intelligence/api-presets.ts: requireSuperAdmin). external_api_sources is TENANT_OR_PLATFORM (e9 2026-11-14); a PLATFORM row (company_id NULL, is_preset) is reachable only on ownedDbTable by an SA path - tenantOrPlatformTable deliberately cannot modify platform rows",
    owner: 'virality-55',
  },
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
