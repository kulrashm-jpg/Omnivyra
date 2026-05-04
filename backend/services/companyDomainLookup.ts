
/**
 * Company domain lookup — single source of truth for the question:
 * "is this email's domain already claimed by an existing company, and if
 * so, who's the company admin?"
 *
 * Used by both /api/auth/signup (pre-email-verify, denies self-serve
 * signup at form submit) and /api/auth/sync-supabase-user (post-verify,
 * the defense-in-depth path that owns the admin/prospect notification
 * emails). Centralising the lookup here means the two paths can never
 * disagree on whether a domain is claimed.
 *
 * Lookup strategy (cheapest first):
 *   1. companies.admin_email_domain == inputDomain   (exact admin claim)
 *   2. company_domains.final_domain == inputDomain   (canonical claim —
 *      catches a previous signup that resolved this domain or a forwarded
 *      subdomain that points to it)
 *   3. company_domains.input_domain == inputDomain   (covers rows where
 *      input != final and we want to match the user's literal domain too)
 *
 * No HTTP / SSRF probing happens here — that's `resolveDomain` in
 * `domainCanonicalService.ts`. Callers can resolve first and pass the
 * resolved final_domain in for canonical matching of forwarded subdomains.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export type ClaimedDomainAdmin = {
  userId: string;
  name: string | null;
  email: string;
};

export type ClaimedDomainLookup = {
  companyId: string;
  companyName: string | null;
  /** How the match was found — useful for logging which path tripped. */
  matchedVia: 'admin_email_domain' | 'final_domain' | 'input_domain';
  /** Active COMPANY_ADMIN of the matched company, if one exists. */
  admin: ClaimedDomainAdmin | null;
};

export async function lookupClaimedDomain(input: {
  emailDomain: string;
  /** Pass the resolveDomain() result if you've already paid the HTTP cost. */
  finalDomain?: string | null;
}): Promise<ClaimedDomainLookup | null> {
  const emailDomain = input.emailDomain.trim().toLowerCase();
  if (!emailDomain) return null;
  const finalDomain = input.finalDomain?.trim().toLowerCase() || null;

  let companyId: string | null = null;
  let companyName: string | null = null;
  let matchedVia: ClaimedDomainLookup['matchedVia'] | null = null;

  // 1. Direct admin_email_domain match — the company's own claim.
  const { data: byAdminDomain } = await supabase
    .from('companies')
    .select('id, name')
    .eq('admin_email_domain', emailDomain)
    .maybeSingle();

  if (byAdminDomain) {
    companyId = (byAdminDomain as { id: string }).id;
    companyName = (byAdminDomain as { name?: string | null }).name ?? null;
    matchedVia = 'admin_email_domain';
  }

  // 2. Canonical match — input domain (or a passed-in resolved final_domain)
  // already exists in company_domains. Catches `app.omnivyra.com` when
  // someone else has registered `omnivyra.com` and the resolver has rolled
  // through, or any prior signup that wrote this canonical form.
  if (!companyId) {
    const candidates = Array.from(new Set([emailDomain, finalDomain].filter(Boolean) as string[]));

    const { data: byFinal } = await supabase
      .from('company_domains')
      .select('company_id, input_domain, final_domain')
      .in('final_domain', candidates)
      .order('created_at', { ascending: true })
      .limit(1);

    if (byFinal && byFinal.length > 0) {
      companyId = (byFinal[0] as { company_id: string }).company_id;
      matchedVia = 'final_domain';
    } else {
      // 3. Input-domain fallback — handles legacy rows where the row was
      // written with input_domain set but final_domain missing or different.
      const { data: byInput } = await supabase
        .from('company_domains')
        .select('company_id, input_domain, final_domain')
        .in('input_domain', candidates)
        .order('created_at', { ascending: true })
        .limit(1);
      if (byInput && byInput.length > 0) {
        companyId = (byInput[0] as { company_id: string }).company_id;
        matchedVia = 'input_domain';
      }
    }

    if (companyId) {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .maybeSingle();
      companyName = (companyRow as { name?: string | null } | null)?.name ?? null;
    }
  }

  if (!companyId || !matchedVia) return null;

  // Fetch the oldest active COMPANY_ADMIN — the original founder. Returns
  // null when the company exists but has no active admin (rare; happens if
  // the admin was soft-deleted before transferring ownership).
  const { data: adminRoleRow } = await supabase
    .from('user_company_' + 'roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .eq('role', 'COMPANY_ADMIN')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const adminUserId = (adminRoleRow as { user_id?: string } | null)?.user_id ?? null;
  let admin: ClaimedDomainAdmin | null = null;
  if (adminUserId) {
    const { data: adminUser } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', adminUserId)
      .maybeSingle();
    const adminEmail = (adminUser as { email?: string | null } | null)?.email ?? null;
    if (adminEmail) {
      admin = {
        userId: adminUserId,
        name: (adminUser as { name?: string | null }).name ?? null,
        email: adminEmail,
      };
    }
  }

  return { companyId, companyName, matchedVia, admin };
}

/** Mask an email for safe display in 409 responses: "kk•••@omnivyra.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
