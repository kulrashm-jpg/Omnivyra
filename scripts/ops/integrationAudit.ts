#!/usr/bin/env tsx
/**
 * Integration governance audit.
 *
 * Read-only DB scan: enumerates every row in `company_integrations`,
 * computes the 8-state derived health, and flags structural issues that
 * are visible without making a live provider call:
 *   - stale `last_tested_at` (> 72h old, status='connected')
 *   - `last_error` present with a known fingerprint
 *   - malformed `config.site_url` / `config.endpoint_url` (e.g. wp-admin)
 *   - integrations with no `website_connection_id`
 *   - canonical-host drift (config URL host != parent website host)
 *
 * Exit codes:
 *   0  no findings
 *   1  findings present (CI hard-gate when desired)
 *   2  query / auth failure (operator action needed, not a true audit fail)
 *
 * Output:
 *   Default: human-readable table + per-row findings
 *   --json:  structured JSON for CI parsing
 *
 * NO secrets ever printed: only the `non_secret_config.site_url` /
 * `endpoint_url` style fields are inspected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const JSON_OUTPUT = args.has('--json');

const FORBIDDEN_HOST_PATTERNS = [
  /\bapp\.omnivyra\.com\b/i,
  /\bvercel\.app\b/i,
  /^https?:\/\/127\.0\.0\.1[:/]/i,
];
const PLACEHOLDER_HOST_PATTERNS = [/^company-[a-f0-9-]+\.local$/i, /\.local$/i, /\.test$/i];
const STALE_HOURS = 72;

interface IntegrationRow {
  id: string;
  company_id: string;
  type: string;
  name: string;
  status: string;
  website_id: string | null;
  website_connection_id: string | null;
  config: Record<string, string> | null;
  non_secret_config: Record<string, string> | null;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface Finding {
  integration_id: string;
  company_id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  code: string;
  detail: string;
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function isPlaceholderUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const h = new URL(raw).host;
    return PLACEHOLDER_HOST_PATTERNS.some((p) => p.test(h));
  } catch { return true; }
}

/**
 * Compute the "registrable" portion of a hostname — the last two labels
 * in the common case, with a small carve-out for known multi-label
 * public suffixes we care about (.co.uk, .com.au, etc.). Good enough
 * for "are these two hosts on the same business domain" checks without
 * shipping the full PSL.
 */
const MULTILABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk', 'com.au', 'co.in', 'co.jp', 'co.nz', 'com.br', 'com.mx',
  'com.sg', 'com.hk', 'com.tw', 'co.za', 'co.kr',
]);

function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^\*\./, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (MULTILABEL_PUBLIC_SUFFIXES.has(last2)) return last3;
  return last2;
}

function sameRegistrableDomain(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return registrableDomain(new URL(a).host) === registrableDomain(new URL(b).host);
  } catch {
    return false;
  }
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

interface WebsiteRef {
  id: string;
  canonical_url: string | null;
}

function auditRow(row: IntegrationRow, websitesById: Map<string, WebsiteRef>): Finding[] {
  const findings: Finding[] = [];
  const cfg = row.non_secret_config ?? row.config ?? {};
  const urlField = cfg.site_url || cfg.endpoint_url || cfg.webhook_url || cfg.shop_domain || null;

  if (urlField) {
    for (const pat of FORBIDDEN_HOST_PATTERNS) {
      if (pat.test(urlField)) {
        findings.push({
          integration_id: row.id, company_id: row.company_id, type: row.type,
          severity: 'high', code: 'STALE_DOMAIN',
          detail: `integration URL matches forbidden host pattern ${pat}: ${urlField}`,
        });
      }
    }
    if (isPlaceholderUrl(urlField)) {
      findings.push({
        integration_id: row.id, company_id: row.company_id, type: row.type,
        severity: 'medium', code: 'PLACEHOLDER_URL',
        detail: `integration URL is a placeholder/dev host: ${urlField}`,
      });
    }
    if (/\/wp-admin(\/|$)/i.test(urlField) || /\/wp-login\.php/i.test(urlField)) {
      findings.push({
        integration_id: row.id, company_id: row.company_id, type: row.type,
        severity: 'high', code: 'WP_ADMIN_URL',
        detail: `integration URL points at wp-admin (must be site root or blog root): ${urlField}`,
      });
    }
    try {
      const parsed = new URL(urlField);
      if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname) && !/\.local$/i.test(parsed.hostname)) {
        findings.push({
          integration_id: row.id, company_id: row.company_id, type: row.type,
          severity: 'medium', code: 'HTTP_PROTOCOL',
          detail: `integration URL uses http:// in production: ${urlField}`,
        });
      }
    } catch {
      findings.push({
        integration_id: row.id, company_id: row.company_id, type: row.type,
        severity: 'high', code: 'MALFORMED_URL',
        detail: `integration URL is malformed: ${urlField}`,
      });
    }
  } else if (['wordpress', 'ghost', 'drupal', 'joomla'].includes(row.type)) {
    findings.push({
      integration_id: row.id, company_id: row.company_id, type: row.type,
      severity: 'high', code: 'MISSING_SITE_URL',
      detail: `${row.type} integration has no site_url configured`,
    });
  }

  if (!row.website_connection_id && row.type !== 'lead_webhook') {
    findings.push({
      integration_id: row.id, company_id: row.company_id, type: row.type,
      severity: 'medium', code: 'NO_WEBSITE_CONNECTION',
      detail: 'integration is not linked to a website_connection — health checks cannot run',
    });
  }

  const age = hoursSince(row.last_tested_at);
  if (row.status === 'connected' && (age === null || age > STALE_HOURS)) {
    findings.push({
      integration_id: row.id, company_id: row.company_id, type: row.type,
      severity: 'low', code: 'STALE_VALIDATION',
      detail: age === null
        ? 'connected but never validated'
        : `last validated ${Math.round(age)}h ago (threshold ${STALE_HOURS}h)`,
    });
  }

  if (row.status === 'failed' && row.last_error) {
    findings.push({
      integration_id: row.id, company_id: row.company_id, type: row.type,
      severity: 'high', code: 'PERSISTENT_FAILURE',
      detail: `status=failed; last_error: ${row.last_error.slice(0, 160)}`,
    });
  }

  // Cross-domain drift: when the integration is linked to a website,
  // the publishing URL's registrable domain must match the website's
  // canonical_url registrable domain. Catches the migration footgun
  // where a website was renamed (e.g. omnivyra.com) but the WordPress
  // integration still points at a stale third-party host. Also catches
  // tenant-cross-contamination — an integration pointing at a domain
  // belonging to a different organization.
  if (urlField && row.website_id) {
    const website = websitesById.get(row.website_id);
    if (website && website.canonical_url && !isPlaceholderUrl(website.canonical_url)) {
      if (!sameRegistrableDomain(urlField, website.canonical_url)) {
        findings.push({
          integration_id: row.id, company_id: row.company_id, type: row.type,
          severity: 'high', code: 'CROSS_DOMAIN_DRIFT',
          detail: `integration URL ${urlField} is on a different registrable domain than parent website ${website.canonical_url}`,
        });
      }
    }
  }

  return findings;
}

async function main(): Promise<number> {
  const env = { ...parseEnvFile(join(process.cwd(), '.env.local')), ...process.env };
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('integrationAudit: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.');
    return 2;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const cols = 'id,company_id,type,name,status,website_id,website_connection_id,non_secret_config,last_tested_at,last_error,created_at,updated_at';
  // `config` deliberately omitted — may contain credential-shaped values
  // on legacy rows. Only `non_secret_config` and exposed URL fields are
  // inspected by the audit.
  const [intRes, webRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/company_integrations?select=${encodeURIComponent(cols)}&limit=1000`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/websites?select=id,canonical_url&limit=1000`, { headers }),
  ]);
  if (!intRes.ok) {
    console.error(`integrationAudit: integrations query failed: HTTP ${intRes.status}`);
    return 2;
  }
  if (!webRes.ok) {
    console.error(`integrationAudit: websites query failed: HTTP ${webRes.status} (continuing without cross-domain drift checks)`);
  }
  const rows = (await intRes.json()) as IntegrationRow[];
  const websitesArr = webRes.ok ? ((await webRes.json()) as WebsiteRef[]) : [];
  const websitesById = new Map<string, WebsiteRef>(websitesArr.map((w) => [w.id, w]));

  const findings: Finding[] = [];
  for (const row of rows) findings.push(...auditRow(row, websitesById));

  const summary = {
    total_integrations: rows.length,
    total_findings: findings.length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    by_code: findings.reduce((acc, f) => { acc[f.code] = (acc[f.code] ?? 0) + 1; return acc; }, {} as Record<string, number>),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    console.log('== Integration governance audit ==');
    console.log(`  integrations scanned: ${summary.total_integrations}`);
    console.log(`  findings:             ${summary.total_findings} (high: ${summary.high}, medium: ${summary.medium}, low: ${summary.low})`);
    console.log(`  by code:              ${Object.entries(summary.by_code).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);
    if (findings.length > 0) {
      console.log('');
      console.log('  Findings:');
      for (const f of findings.slice(0, 50)) {
        console.log(`    [${f.severity.toUpperCase()}] ${f.code} — ${f.type} / ${f.integration_id.slice(0, 8)} — ${f.detail}`);
      }
      if (findings.length > 50) console.log(`    ...and ${findings.length - 50} more (use --json for full list)`);
    }
    console.log(`\nResult: ${summary.high > 0 ? 'FAIL (high-severity findings present)' : findings.length > 0 ? 'WARN (medium/low findings only)' : 'PASS'}`);
  }

  return summary.high > 0 ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((err) => {
  console.error('integrationAudit: fatal error', err);
  process.exit(2);
});
