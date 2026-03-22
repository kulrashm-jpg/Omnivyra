/**
 * GET /api/admin/external-users
 *
 * Super-admin only. Returns visibility into users who joined the platform
 * via public email domains (Gmail, Yahoo, etc.) rather than corporate SSO.
 *
 * Two types of external user:
 *   influencer  — approved an access_request (self-applied, admin-approved)
 *   consultant  — added by a company admin via team invite (join_source='invited')
 *                 and identified as a public-domain user from the users table
 *
 * Response per user:
 *   user_id            — Supabase auth UID
 *   email              — login email
 *   name               — from access_requests or users table
 *   type               — 'influencer' | 'consultant'
 *   organizations      — all active memberships: { company_id, company_name, role }
 *   total_credits_used — sum of credits_used from credit_usage_log
 *   last_active        — most recent credit usage event (proxy for activity)
 *
 * Auth: super_admin_session cookie OR Bearer + profiles.is_super_admin
 *
 * Query params:
 *   type   — filter by 'influencer' | 'consultant' | 'all' (default: all)
 *   limit  — max records (default 100, max 500)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// ── Response shape ────────────────────────────────────────────────────────────

interface OrgMembership {
  company_id:   string;
  company_name: string;
  role:         string;
}

export interface ExternalUser {
  user_id:             string;
  email:               string;
  name:                string | null;
  type:                'influencer' | 'consultant';
  organizations:       OrgMembership[];
  total_credits_used:  number;
  last_active:         string | null;  // ISO or null if no usage recorded
}

// ── Auth helper (cookie OR Bearer + is_super_admin) ───────────────────────────

async function assertSuperAdmin(
  req: NextApiRequest,
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return false;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  return !!(profile as any)?.is_super_admin;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  if (!await assertSuperAdmin(req, supabase as any)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }

  const typeFilter = (req.query.type as string) ?? 'all';
  const limitNum   = Math.min(500, Math.max(1, parseInt((req.query.limit as string) ?? '100', 10)));

  try {
    // ── Phase 1A: influencers — approved access requests ─────────────────────
    // access_requests stores email + organization_id (company created by admin at approval).
    // We need to find the auth user_id for each email via user_company_roles.
    const influencerRows: ExternalUser[] = [];
    const influencerOrgIds: string[]     = [];

    if (typeFilter === 'all' || typeFilter === 'influencer') {
      const { data: approvedRequests } = await supabase
        .from('access_requests')
        .select('email, name, organization_id')
        .eq('status', 'approved')
        .not('organization_id', 'is', null)
        .limit(limitNum);

      for (const req of (approvedRequests ?? []) as Array<{
        email: string; name: string | null; organization_id: string;
      }>) {
        influencerOrgIds.push(req.organization_id);
        // Seed the map — user_id resolved in phase 2
        influencerRows.push({
          user_id:            '',  // filled below
          email:              req.email,
          name:               req.name,
          type:               'influencer',
          organizations:      [],
          total_credits_used: 0,
          last_active:        null,
        });
      }
    }

    // ── Phase 1B: consultants — team-invited public-domain users ──────────────
    // user_company_roles.join_source='invited' covers all admin-added users.
    // We then filter to only those whose email domain is a public provider.
    const consultantRows: ExternalUser[] = [];

    if (typeFilter === 'all' || typeFilter === 'consultant') {
      const { data: invitedRoles } = await supabase
        .from('user_company_roles')
        .select('user_id, company_id, role')
        .eq('join_source', 'invited')
        .eq('status', 'active')
        .limit(limitNum * 5);  // over-fetch; many will be corporate domains

      const invitedUserIds = [...new Set((invitedRoles ?? []).map((r: any) => r.user_id))];

      if (invitedUserIds.length > 0) {
        // Get emails for invited users
        const { data: userRows } = await supabase
          .from('users')
          .select('id, email, name')
          .in('id', invitedUserIds);

        const userEmailMap = new Map<string, { email: string; name: string | null }>();
        for (const u of (userRows ?? []) as Array<{ id: string; email: string; name: string | null }>) {
          userEmailMap.set(u.id, { email: u.email, name: u.name });
        }

        // Filter to public-domain users only
        const domains = [...new Set(
          [...userEmailMap.values()]
            .map(u => u.email.split('@')[1])
            .filter(Boolean),
        )];

        const { data: publicDomainRows } = await supabase
          .from('public_email_providers')
          .select('domain')
          .in('domain', domains);

        const publicDomains = new Set((publicDomainRows ?? []).map((r: any) => r.domain));

        // Build consultant entries (deduplicated from influencer set by user_id)
        const influencerEmails = new Set(influencerRows.map(r => r.email));

        for (const userId of invitedUserIds) {
          const u = userEmailMap.get(userId);
          if (!u) continue;

          const domain = u.email.split('@')[1];
          if (!publicDomains.has(domain)) continue;     // corporate email — skip
          if (influencerEmails.has(u.email)) continue;  // already counted as influencer

          consultantRows.push({
            user_id:            userId,
            email:              u.email,
            name:               u.name,
            type:               'consultant',
            organizations:      [],
            total_credits_used: 0,
            last_active:        null,
          });
        }
      }
    }

    // ── Phase 2: resolve influencer user_ids from user_company_roles ──────────
    if (influencerOrgIds.length > 0) {
      const { data: influencerRoles } = await supabase
        .from('user_company_roles')
        .select('user_id, company_id, role')
        .in('company_id', influencerOrgIds)
        .eq('status', 'active');

      const orgToUserId = new Map<string, string>();
      for (const r of (influencerRoles ?? []) as Array<{ user_id: string; company_id: string; role: string }>) {
        orgToUserId.set(r.company_id, r.user_id);
      }

      for (const row of influencerRows) {
        // Match via organization index (order preserved — zip with influencerOrgIds)
        const idx = influencerRows.indexOf(row);
        row.user_id = orgToUserId.get(influencerOrgIds[idx]) ?? '';
      }
    }

    // Merge all external users, drop any without a resolved user_id
    const allUsers = [...influencerRows, ...consultantRows].filter(u => u.user_id);

    if (allUsers.length === 0) {
      return res.status(200).json({ users: [], total: 0 });
    }

    const allUserIds = [...new Set(allUsers.map(u => u.user_id))];

    // ── Phase 3: org memberships for all external users ───────────────────────
    const { data: allRoles } = await supabase
      .from('user_company_roles')
      .select('user_id, company_id, role')
      .in('user_id', allUserIds)
      .eq('status', 'active');

    // Get company names for all referenced company_ids
    const allCompanyIds = [...new Set((allRoles ?? []).map((r: any) => r.company_id))];
    const { data: companies } = allCompanyIds.length > 0
      ? await supabase
          .from('companies')
          .select('id, name')
          .in('id', allCompanyIds)
      : { data: [] };

    const companyNameMap = new Map<string, string>();
    for (const c of (companies ?? []) as Array<{ id: string; name: string }>) {
      companyNameMap.set(c.id, c.name);
    }

    // Build user_id → memberships map
    const membershipMap = new Map<string, OrgMembership[]>();
    for (const r of (allRoles ?? []) as Array<{ user_id: string; company_id: string; role: string }>) {
      if (!membershipMap.has(r.user_id)) membershipMap.set(r.user_id, []);
      membershipMap.get(r.user_id)!.push({
        company_id:   r.company_id,
        company_name: companyNameMap.get(r.company_id) ?? 'Unknown',
        role:         r.role,
      });
    }

    // ── Phase 4: credit usage aggregation ─────────────────────────────────────
    const { data: usageRows } = await supabase
      .from('credit_usage_log')
      .select('organization_id, credits_used, created_at')
      .in('organization_id', allCompanyIds)
      .order('created_at', { ascending: false });

    // Map company_id → user_id so we can aggregate per user
    const companyToUserId = new Map<string, string>();
    for (const [userId, memberships] of membershipMap.entries()) {
      for (const m of memberships) {
        companyToUserId.set(m.company_id, userId);
      }
    }

    const creditsMap   = new Map<string, number>();     // user_id → sum
    const lastActiveMap = new Map<string, string>();    // user_id → ISO date

    for (const row of (usageRows ?? []) as Array<{
      organization_id: string; credits_used: number; created_at: string;
    }>) {
      const userId = companyToUserId.get(row.organization_id);
      if (!userId) continue;

      creditsMap.set(userId, (creditsMap.get(userId) ?? 0) + (row.credits_used ?? 0));
      if (!lastActiveMap.has(userId)) {
        lastActiveMap.set(userId, row.created_at); // rows are DESC — first hit is latest
      }
    }

    // ── Phase 5: assemble final response ──────────────────────────────────────
    for (const u of allUsers) {
      u.organizations      = membershipMap.get(u.user_id) ?? [];
      u.total_credits_used = creditsMap.get(u.user_id) ?? 0;
      u.last_active        = lastActiveMap.get(u.user_id) ?? null;
    }

    // Sort: most recently active first; users with no activity go to the end
    allUsers.sort((a, b) => {
      if (!a.last_active && !b.last_active) return 0;
      if (!a.last_active) return 1;
      if (!b.last_active) return -1;
      return b.last_active.localeCompare(a.last_active);
    });

    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.status(200).json({ users: allUsers, total: allUsers.length });

  } catch (err: any) {
    console.error('[admin/external-users]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
