/**
 * Phase-10 — Historical Company Identity Audit (READ-ONLY).
 *
 * Audits every existing company against the new authoritative identity rules.
 * Performs ONLY SELECT reads + bounded outward HEAD probes (resolveDomain) for
 * the subset where a bucket decision requires it. Writes NOTHING to the DB and
 * runs NO migrations. Emits DOMAIN_IDENTITY_BACKFILL_REPORT.md.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/audit-company-identity.ts
 *
 * Buckets:
 *   A MATCHED          stored website domain == admin email domain
 *   B AUTO_FIXABLE     website missing, corporate email domain hosts a live canonical site
 *   C WEBSITE_MISSING  website missing AND no derivable corporate identity (free/no admin email)
 *   D DOMAIN_MISMATCH  stored website domain != admin email domain
 *   E NO_ACTIVE_ADMIN  no active COMPANY_ADMIN
 *   F NO_WEBSITE_FOUND corporate email domain, but no live canonical site resolves
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { normalizeCompanyDomain } from '../lib/shared/domain/companyDomain';
import { resolveDomain } from '../backend/services/domainCanonicalService';

// Free/personal email providers (audit-local copy — read-only classification).
const FREE = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.co.in','yahoo.ca',
  'outlook.com','hotmail.com','live.com','msn.com','icloud.com','me.com','mac.com',
  'protonmail.com','proton.me','aol.com','mail.com','zoho.com','yandex.com',
  'gmx.com','gmx.net','tutanota.com','mail.ru','qq.com','163.com','foxmail.com',
]);
const isFree = (d: string) => FREE.has(d.toLowerCase().trim());

const PROBE_CAP = 600;      // bound outward HEAD probes
const PROBE_CONCURRENCY = 6;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

type Company = {
  id: string; name: string | null; website: string | null;
  website_domain: string | null; admin_email_domain: string | null;
  status: string | null; created_at: string | null;
};

type Bucket = 'A_MATCHED' | 'B_AUTO_FIXABLE' | 'C_WEBSITE_MISSING' | 'D_DOMAIN_MISMATCH' | 'E_NO_ACTIVE_ADMIN' | 'F_NO_WEBSITE_FOUND';

type Row = {
  id: string; name: string; status: string; created_at: string;
  adminRole: string | null; adminEmailDomain: string | null; storedWebsite: string | null;
  normalizedEmailDomain: string; normalizedStoredDomain: string;
  resolvedWebsite: string | null; bucket: Bucket; proposed: string;
};

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from(table).select(columns).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < size) break;
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx]); }
  }));
  return res;
}

(async () => {
  console.log('[audit] reading companies…');
  const companies = await pageAll<Company>('companies', 'id, name, website, website_domain, admin_email_domain, status, created_at');
  console.log(`[audit] ${companies.length} companies`);

  console.log('[audit] reading active admin roles (COMPANY_ADMIN + legacy admin + SUPER_ADMIN)…');
  // Legacy data uses role='admin' (lowercase) alongside the canonical
  // 'COMPANY_ADMIN'. Pick the highest-priority ACTIVE admin per company.
  const ADMIN_ROLE_PRIORITY: Record<string, number> = { COMPANY_ADMIN: 3, admin: 2, SUPER_ADMIN: 1 };
  const roles = (await pageAll<{ user_id: string; company_id: string; role: string; status: string }>(
    'user_company_roles', 'user_id, company_id, role, status',
  )).filter((r) => r.status === 'active' && ADMIN_ROLE_PRIORITY[r.role] != null);

  const bestByCompany = new Map<string, { user_id: string; pri: number; role: string }>();
  for (const r of roles) {
    const pri = ADMIN_ROLE_PRIORITY[r.role];
    const cur = bestByCompany.get(r.company_id);
    if (!cur || pri > cur.pri) bestByCompany.set(r.company_id, { user_id: r.user_id, pri, role: r.role });
  }
  const adminUserByCompany = new Map<string, string>();
  const adminRoleByCompany = new Map<string, string>();
  for (const [cid, v] of bestByCompany) { adminUserByCompany.set(cid, v.user_id); adminRoleByCompany.set(cid, v.role); }

  const userIds = Array.from(new Set(Array.from(adminUserByCompany.values())));
  const emailByUser = new Map<string, string | null>();
  for (let i = 0; i < userIds.length; i += 500) {
    const slice = userIds.slice(i, i + 500);
    const { data, error } = await db.from('users').select('id, email').in('id', slice);
    if (error) throw new Error(`users: ${error.message}`);
    for (const u of (data ?? []) as any[]) emailByUser.set(u.id, u.email ?? null);
  }

  // First pass — classify everything that does NOT need a probe; collect probe targets.
  const rows: Row[] = [];
  const probeTargets: { row: Row; domain: string }[] = [];

  for (const c of companies) {
    const adminUser = adminUserByCompany.get(c.id);
    const adminEmail = adminUser ? emailByUser.get(adminUser) ?? null : null;
    const adminEmailDomain = adminEmail ? (adminEmail.split('@')[1] ?? '').toLowerCase().trim() : null;
    const normalizedEmailDomain = adminEmail ? normalizeCompanyDomain(adminEmail) : '';
    const storedWebsite = c.website && !/^[0-9a-f-]{36}$/i.test(c.website) ? c.website : null; // UUID placeholder → none
    const normalizedStoredDomain = normalizeCompanyDomain(c.website_domain || storedWebsite || '');

    const row: Row = {
      id: c.id, name: c.name ?? '(unnamed)', status: c.status ?? '', created_at: c.created_at ?? '',
      adminRole: adminRoleByCompany.get(c.id) ?? null,
      adminEmailDomain, storedWebsite, normalizedEmailDomain, normalizedStoredDomain,
      resolvedWebsite: null, bucket: 'C_WEBSITE_MISSING', proposed: '',
    };

    if (!adminUser) { row.bucket = 'E_NO_ACTIVE_ADMIN'; row.proposed = 'Assign / verify an active COMPANY_ADMIN before any identity backfill.'; rows.push(row); continue; }

    const corporate = !!normalizedEmailDomain && !!adminEmailDomain && !isFree(adminEmailDomain);

    if (normalizedStoredDomain) {
      if (corporate && normalizedStoredDomain === normalizedEmailDomain) {
        row.bucket = 'A_MATCHED'; row.proposed = 'None — already consistent.';
      } else if (corporate && normalizedStoredDomain !== normalizedEmailDomain) {
        row.bucket = 'D_DOMAIN_MISMATCH';
        row.proposed = `Review: stored "${normalizedStoredDomain}" ≠ email "${normalizedEmailDomain}". Do NOT auto-change; manual decision.`;
      } else {
        // stored website present but admin email is free/empty — keep stored, flag.
        row.bucket = 'D_DOMAIN_MISMATCH';
        row.proposed = `Review: admin email domain is free/absent (${adminEmailDomain ?? 'n/a'}); cannot confirm identity from email.`;
      }
      rows.push(row); continue;
    }

    // Website missing.
    if (!corporate) {
      row.bucket = 'C_WEBSITE_MISSING';
      row.proposed = `No website and no derivable corporate identity (admin email: ${adminEmailDomain ?? 'n/a'}). Needs manual website capture.`;
      rows.push(row); continue;
    }

    // Corporate email + missing website → needs a probe to split B vs F.
    rows.push(row);
    probeTargets.push({ row, domain: normalizedEmailDomain });
  }

  // Bounded probe pass.
  const toProbe = probeTargets.slice(0, PROBE_CAP);
  const skipped = probeTargets.length - toProbe.length;
  console.log(`[audit] probing ${toProbe.length} email domains (cap ${PROBE_CAP}; ${skipped} skipped)…`);

  await pool(toProbe, PROBE_CONCURRENCY, async ({ row, domain }) => {
    try {
      const r = await resolveDomain(domain);
      if (r.resolution_failed || r.resolution_blocked) {
        row.bucket = 'F_NO_WEBSITE_FOUND';
        row.proposed = `No live site resolves for ${domain}. Manual website capture required.`;
      } else if (r.input_domain !== r.final_domain || r.is_forwarding) {
        row.bucket = 'F_NO_WEBSITE_FOUND';
        row.resolvedWebsite = r.final_domain;
        row.proposed = `Non-canonical/forwarding (${domain} → ${r.final_domain}). Manual review; not auto-fixable.`;
      } else {
        row.bucket = 'B_AUTO_FIXABLE';
        row.resolvedWebsite = `https://www.${domain}`;
        row.proposed = `Backfill website = https://www.${domain} (validated live + canonical).`;
      }
    } catch (e) {
      row.bucket = 'F_NO_WEBSITE_FOUND';
      row.proposed = `Probe error for ${domain}; manual review.`;
    }
  });

  for (const { row, domain } of probeTargets.slice(PROBE_CAP)) {
    row.bucket = 'F_NO_WEBSITE_FOUND';
    row.proposed = `Probe skipped (cap ${PROBE_CAP}); re-run audit to resolve ${domain}.`;
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const order: Bucket[] = ['A_MATCHED','B_AUTO_FIXABLE','C_WEBSITE_MISSING','D_DOMAIN_MISMATCH','E_NO_ACTIVE_ADMIN','F_NO_WEBSITE_FOUND'];
  const byBucket = new Map<Bucket, Row[]>(order.map((b) => [b, []]));
  for (const r of rows) byBucket.get(r.bucket)!.push(r);

  const esc = (s: string) => String(s).replace(/\|/g, '\\|');
  const table = (rs: Row[]) => rs.length === 0 ? '_none_\n' : (
    '| company_id | name | admin role | admin email domain | stored website domain | resolved | proposed update |\n' +
    '|---|---|---|---|---|---|---|\n' +
    rs.map((r) => `| ${r.id} | ${esc(r.name)} | ${r.adminRole ?? '—'} | ${r.adminEmailDomain ?? '—'} | ${r.normalizedStoredDomain || '—'} | ${r.resolvedWebsite ?? '—'} | ${esc(r.proposed)} |`).join('\n') + '\n'
  );

  const labels: Record<Bucket, string> = {
    A_MATCHED: 'A. MATCHED', B_AUTO_FIXABLE: 'B. AUTO_FIXABLE', C_WEBSITE_MISSING: 'C. WEBSITE_MISSING',
    D_DOMAIN_MISMATCH: 'D. DOMAIN_MISMATCH', E_NO_ACTIVE_ADMIN: 'E. NO_ACTIVE_ADMIN', F_NO_WEBSITE_FOUND: 'F. NO_WEBSITE_FOUND',
  };

  const stamp = new Date().toISOString();
  let md = `# DOMAIN_IDENTITY_BACKFILL_REPORT.md\n\n`;
  md += `Phase-10 historical company-identity audit. **READ-ONLY** — no writes, no migrations, no record changes.\n\n`;
  md += `- Generated: ${stamp}\n- Total companies: **${companies.length}**\n`;
  md += `- Probes performed: ${toProbe.length} (cap ${PROBE_CAP}, concurrency ${PROBE_CONCURRENCY}${skipped ? `, ${skipped} skipped` : ''})\n\n`;
  md += `## Count per bucket\n\n| Bucket | Count |\n|---|---|\n`;
  for (const b of order) md += `| ${labels[b]} | ${byBucket.get(b)!.length} |\n`;
  md += `| **Total** | **${rows.length}** |\n\n`;

  for (const b of order) {
    md += `## ${labels[b]} — ${byBucket.get(b)!.length}\n\n${table(byBucket.get(b)!)}\n`;
  }

  md += `## Proposed updates (NOT applied)\n\n`;
  md += `- **B AUTO_FIXABLE** → backfill \`website = https://www.<emailDomain>\` (validated live + canonical). Lowest-risk, deterministic.\n`;
  md += `- **C WEBSITE_MISSING** → manual website capture (no derivable identity).\n`;
  md += `- **D DOMAIN_MISMATCH** → manual review only; never auto-change a stored website.\n`;
  md += `- **E NO_ACTIVE_ADMIN** → assign/verify an admin before any identity action.\n`;
  md += `- **F NO_WEBSITE_FOUND** → manual website capture; domain has no live canonical site.\n`;
  md += `- **A MATCHED** → no action.\n\n`;

  md += `## Risk assessment\n\n`;
  md += `| Action | Risk | Notes |\n|---|---|---|\n`;
  md += `| Backfill B (auto-fixable) | Low | Deterministic www.<domain>, probe-confirmed live+canonical. Reversible. |\n`;
  md += `| Touch D (mismatch) | High | Stored website may be intentionally different (rebrand/holding co). Manual only. |\n`;
  md += `| Touch E (no admin) | Med | Identity unverifiable without an admin; do not infer. |\n`;
  md += `| Probe accuracy | Low | Uses the production SSRF-hardened resolveDomain; transient failures → F (re-runnable). |\n`;
  md += `| Free-email admins | Med | Legacy companies whose admin used a personal email cannot be identity-verified from email. |\n\n`;
  md += `## Method & guarantees\n\n`;
  md += `- Reads only: \`companies\`, \`user_company_roles\`, \`users\` (SELECT + range pagination).\n`;
  md += `- Outward probes: HEAD via \`resolveDomain\`, bounded to missing-website corporate domains (the only bucket decision needing a live check).\n`;
  md += `- No INSERT/UPDATE/DELETE/UPSERT/RPC. No migrations. No schema changes.\n`;

  const outPath = path.join(__dirname, '..', 'DOMAIN_IDENTITY_BACKFILL_REPORT.md');
  writeFileSync(outPath, md);
  console.log(`[audit] wrote ${outPath}`);
  console.log('[audit] bucket counts:', Object.fromEntries(order.map((b) => [b, byBucket.get(b)!.length])));
})().catch((e) => { console.error('[audit] FAILED:', e?.message ?? e); process.exit(1); });
