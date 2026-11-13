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
export type CrossTenantEntry = { id: string; tables: readonly string[]; file: string; reason: string; owner: string };

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
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
