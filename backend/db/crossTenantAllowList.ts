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
    id: 'intelligence-access-global-defaults',
    tables: ['company_intelligence_config'],
    file: 'pages/api/settings/intelligence-access.ts',
    reason: "the PLATFORM default intelligence profile (super-admin, mode 'global') is keyed by the sentinel company_id '__GLOBAL_DEFAULT__' - not a tenant and not a uuid, so it cannot be written through tenantTable; tenant overrides go through the seam",
    owner: 'virality-e1',
  },
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
