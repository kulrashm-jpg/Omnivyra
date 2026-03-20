/**
 * Company Match Service
 *
 * Detects whether a newly-signing-up user belongs to an existing company
 * by comparing the user's email domain against the company's website domain.
 *
 * Example:
 *   Company website: www.drishiq.com  →  stored website_domain = "drishiq.com"
 *   New user email:  jane@drishiq.com  →  email domain = "drishiq.com"
 *   → Match found → user added as CONTENT_CREATOR, company admin notified.
 *
 * Match priority:
 *   1. companies.website_domain == user email domain  (indexed, primary)
 *   2. companies.admin_email_domain == user email domain  (fallback for companies
 *      created without a real website URL)
 *   3. Normalised company name  (last resort)
 *
 * Free/public email providers (gmail, yahoo, …) are never matched by domain.
 */

import { supabase } from '../db/supabaseClient';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me',
  'aol.com', 'mail.com',
  'zoho.com', 'yandex.com',
  'gmx.com', 'gmx.net',
  'tutanota.com',
]);

/** Extract the domain portion from a URL or email address, stripping www. */
export function extractDomain(input: string): string | null {
  if (!input?.trim()) return null;
  try {
    const raw = input.trim().toLowerCase();
    // Email address (contains @)
    if (raw.includes('@')) {
      const after = raw.split('@').pop()?.trim();
      return after || null;
    }
    // URL — ensure protocol prefix for URL constructor
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** True when the domain belongs to a free/public email provider. */
export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase().trim());
}

/** Normalise a company name for fuzzy comparison (strips legal suffixes). */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sas|bv|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type MatchedCompany = {
  company_id: string;
  company_name: string;
  /** How the match was made — shown in the notification to the admin. */
  match_type: 'website_domain' | 'admin_email_domain' | 'name';
};

export type CompanyAdmin = {
  user_id: string;
  email: string | null;
};

/**
 * Find an existing active company that the signing-up user likely belongs to.
 *
 * Matching order:
 *   1. Website URL they entered  →  companies.website_domain  (primary, always checked)
 *      e.g. panaceathebook@hotmail.com enters "www.drishiq.com"
 *           → websiteDomain = "drishiq.com" → matches existing Drishiq company
 *      *** Email provider is irrelevant here — the website is the signal. ***
 *
 *   2. Corporate email domain  →  companies.website_domain or admin_email_domain
 *      e.g. jane@drishiq.com (no website entered)
 *           → emailDomain = "drishiq.com" → matches existing Drishiq company
 *      Skipped for free providers (gmail, hotmail, etc.).
 *
 *   3. Normalised company name  (last resort, website-unaware users)
 */
export async function findMatchingCompany(params: {
  companyName: string;
  website?: string | null;
  userEmail?: string | null;
}): Promise<MatchedCompany | null> {
  const { companyName, website, userEmail } = params;

  // ── 1. Website URL the user entered (primary, no email-domain restriction) ─
  const enteredWebsiteDomain = website ? extractDomain(website) : null;
  if (enteredWebsiteDomain && !isFreeEmailDomain(enteredWebsiteDomain)) {
    const { data: rows, error } = await supabase
      .from('companies')
      .select('id, name')
      .eq('status', 'active')
      .eq('website_domain', enteredWebsiteDomain)
      .limit(1);

    if (!error && rows?.length) {
      return {
        company_id: rows[0].id,
        company_name: rows[0].name,
        match_type: 'website_domain',
      };
    }
  }

  // ── 2. Corporate email domain (skipped for gmail/hotmail/etc.) ────────────
  const emailDomain = userEmail ? extractDomain(userEmail) : null;
  const isCorporateEmail = emailDomain != null && !isFreeEmailDomain(emailDomain);

  if (isCorporateEmail) {
    // 2a. Against website_domain
    const { data: wRows } = await supabase
      .from('companies')
      .select('id, name')
      .eq('status', 'active')
      .eq('website_domain', emailDomain)
      .limit(1);

    if (wRows?.length) {
      return {
        company_id: wRows[0].id,
        company_name: wRows[0].name,
        match_type: 'website_domain',
      };
    }

    // 2b. Against admin_email_domain (fallback for companies without a real website)
    const { data: aRows } = await supabase
      .from('companies')
      .select('id, name')
      .eq('status', 'active')
      .eq('admin_email_domain', emailDomain)
      .limit(1);

    if (aRows?.length) {
      return {
        company_id: aRows[0].id,
        company_name: aRows[0].name,
        match_type: 'admin_email_domain',
      };
    }
  }

  // ── 3. Normalised name match (last resort) ────────────────────────────────
  if (companyName?.trim()) {
    const normalised = normaliseName(companyName);
    if (normalised.length >= 3) {
      const firstWord = normalised.split(' ')[0];
      const { data: rows } = await supabase
        .from('companies')
        .select('id, name')
        .eq('status', 'active')
        .ilike('name', `%${firstWord}%`)
        .limit(30);

      if (rows?.length) {
        for (const row of rows) {
          if (normaliseName(row.name) === normalised) {
            return { company_id: row.id, company_name: row.name, match_type: 'name' };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Get all active COMPANY_ADMIN users for a given company (for notifications).
 */
export async function getCompanyAdmins(companyId: string): Promise<CompanyAdmin[]> {
  const { data: roles } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active');

  if (!roles?.length) return [];

  const admins: CompanyAdmin[] = [];
  for (const row of roles) {
    try {
      const { data } = await supabase.auth.admin.getUserById(row.user_id);
      admins.push({ user_id: row.user_id, email: data?.user?.email ?? null });
    } catch {
      admins.push({ user_id: row.user_id, email: null });
    }
  }
  return admins;
}

/**
 * Insert an in-app notification for every COMPANY_ADMIN of the company,
 * informing them that a new user self-joined via domain match.
 */
export async function notifyCompanyAdminsOfSelfJoin(params: {
  companyId: string;
  companyName: string;
  newUserId: string;
  newUserEmail: string | null;
  matchType: 'website_domain' | 'admin_email_domain' | 'name';
}): Promise<void> {
  const { companyId, companyName, newUserId, newUserEmail, matchType } = params;

  const admins = await getCompanyAdmins(companyId);
  if (!admins.length) return;

  const emailDomain = newUserEmail ? extractDomain(newUserEmail) : null;
  const matchReason =
    matchType === 'website_domain'
      ? `company website (${companyName.toLowerCase().replace(/\s+/g, '')})`
      : matchType === 'admin_email_domain'
      ? `email domain (@${emailDomain ?? 'unknown'})`
      : `company name "${companyName}"`;

  const now = new Date().toISOString();
  const notifications = admins.map((admin) => ({
    user_id:    admin.user_id,
    type:       'self_join',
    title:      'New user joined your company',
    message:    `${newUserEmail ?? 'A new user'} signed up and was automatically added to ${companyName} as a Content Creator — matched by ${matchReason}. You can manage their access in Team Settings.`,
    metadata: {
      company_id:     companyId,
      new_user_id:    newUserId,
      new_user_email: newUserEmail,
      match_type:     matchType,
      joined_at:      now,
    },
    is_read:    false,
    created_at: now,
  }));

  const { error } = await supabase.from('notifications').insert(notifications);
  if (error) {
    console.error('[companyMatch] notification insert failed:', error.message);
  }
}
