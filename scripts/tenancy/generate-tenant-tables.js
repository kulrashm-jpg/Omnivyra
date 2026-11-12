#!/usr/bin/env node
/**
 * Generates backend/db/tenantTables.ts: every public table that carries a tenant column, the column the seam
 * filters on, and its pre-launch risk tag (owner ruling 2026-11-12: ALL writes + reads of money / pii / content
 * are pre-launch; 'other' reads are scheduled after launch).
 *
 * Sources (text scan, repo only): supabase/_schema/baseline.sql (a snapshot at ledger 20260916000000) PLUS every
 * supabase/migrations/*.sql in version order (CREATE TABLE bodies and ADD COLUMN), so post-snapshot tables count.
 * Tenant column precedence: company_id > organization_id > tenant_id, unless OVERRIDES names one.
 * Tags come from name rules, then TAG_OVERRIDES (tracks correct their own tables there, reviewed by 05).
 *
 * usage: node scripts/tenancy/generate-tenant-tables.js [--check]   (--check exits 1 if the file is stale)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'backend', 'db', 'tenantTables.ts');

const TENANT_COLUMNS = ['company_id', 'organization_id', 'tenant_id'];
/** Authoritative tenant column where the precedence rule would pick the wrong one. */
const COLUMN_OVERRIDES = {
  community_ai_actions: 'organization_id', // tenant_id is legacy; every reader and the C19/C22 keys use organization_id
};
/** Indirect tenancy declared by hand where the schema has the column but no FOREIGN KEY constraint. */
const VIA_OVERRIDES = {
  daily_content_plans: ['campaign_id', 'campaigns'],
  media_files: ['campaign_id', 'campaigns'],
  content_assets: ['campaign_id', 'campaigns'],
};
/**
 * GLOBAL tables: no tenant at all (platform-wide content or system state). Reads/writes stay on ownedDbTable
 * WITHOUT a cross-tenant marker. Each entry states why; the owning track confirms in S2 (05 reviews changes).
 */
const GLOBAL_TABLES = {
  public_blogs: 'the platform marketing blog (public, not tenant content)',
  blog_series: 'platform marketing blog series',
  blog_series_posts: 'platform marketing blog series membership',
  blog_relationships: 'platform marketing blog links',
  blog_comments: 'comments on the public platform blog',
  blog_post_likes: 'likes on the public platform blog',
  blog_read_sessions: 'reads of the public platform blog',
  blog_performance_summary: 'public platform blog metrics',
  system_health_metrics: 'platform health telemetry',
};
/** Tables that carry a tenant-named column but are NOT tenant-owned rows (global config or cross-tenant ledgers). */
const NOT_TENANT = new Set([
  'users', // identity: a user spans companies; users.company_id is legacy (C21: 105 NULL); access is the membership layer's
  'user_company_roles', // membership: keyed by user across companies BY DESIGN (auth resolves which companies a user may act in)
]);
const TAG_RULES = [
  ['money', /(credit|billing|invoice|payment|wallet|purchase|refund|subscription|pricing|monetiz|settlement|usage_event|cost|quota|ledger|charge)/],
  ['pii', /(person|persons|contact|lead|prospect|user|member|identity|email|phone|recipient|author|consent|erasure|suppression|governance|invitation|address|profile_person|unified_)/],
  ['content', /(content|blog|post|plan|campaign|creator|asset|media|message|thread|comment|draft|template|report|snapshot|engagement|opportunit|knowledge|profile|brand|theme|calendar|render|image|video|document|note|reply|story)/],
];
/** Per-table tag corrections (money > pii > content > other). */
const TAG_OVERRIDES = {};

function tablesFrom(sql, out) {
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\s*\)\s*(?:;|PARTITION|WITH|INHERITS)/gi;
  let m;
  while ((m = create.exec(sql))) {
    const t = m[1].toLowerCase();
    const cols = new Set((out.get(t) || new Set()));
    for (const line of m[2].split('\n')) {
      const c = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i);
      if (c && !/^(constraint|primary|unique|foreign|check|exclude)$/i.test(c[1])) cols.add(c[1].toLowerCase());
    }
    out.set(t, cols);
  }
  const add = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?);/gi;
  while ((m = add.exec(sql))) {
    const t = m[1].toLowerCase();
    const re = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
    let a;
    while ((a = re.exec(m[2]))) {
      const cols = out.get(t) || new Set();
      cols.add(a[1].toLowerCase());
      out.set(t, cols);
    }
  }
}

/** FOREIGN KEY (col) REFERENCES [public.]parent(id): ALTER TABLE ... ADD CONSTRAINT ... and inline column REFERENCES. */
function fksFrom(sql, out) {
  const push = (t, c, p) => { const l = out.get(t) || []; l.push([c, p]); out.set(t, l); };
  const alter = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD\s+CONSTRAINT\s+\S+\s+FOREIGN\s+KEY\s*\(\s*"?([a-z_][a-z0-9_]*)"?\s*\)\s+REFERENCES\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(\s*id\s*\)/gi;
  let m;
  while ((m = alter.exec(sql))) push(m[1].toLowerCase(), m[2].toLowerCase(), m[3].toLowerCase());
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\s*\)\s*(?:;|PARTITION|WITH|INHERITS)/gi;
  while ((m = create.exec(sql))) {
    for (const line of m[2].split('\n')) {
      const r = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z][^,]*?REFERENCES\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(\s*id\s*\)/i);
      if (r) push(m[1].toLowerCase(), r[1].toLowerCase(), r[2].toLowerCase());
    }
  }
}
/** Parent preference for INDIRECT tenancy: the first FK to a direct tenant table, in this order, else any. */
const PARENT_PREFERENCE = ['campaigns', 'social_accounts', 'blogs', 'engagement_threads', 'creator_assets', 'content_assets'];

function build() {
  const tables = new Map();
  const fks = new Map();
  const ingest = (sql) => { tablesFrom(sql, tables); fksFrom(sql, fks); };
  const baseline = path.join(ROOT, 'supabase', '_schema', 'baseline.sql');
  if (fs.existsSync(baseline)) ingest(fs.readFileSync(baseline, 'utf8'));
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  for (const f of fs.readdirSync(migDir).filter((x) => /^\d{8}.*\.sql$/.test(x)).sort()) ingest(fs.readFileSync(path.join(migDir, f), 'utf8'));
  const tagOf = (t) => TAG_OVERRIDES[t] || (TAG_RULES.find(([, re]) => re.test(t)) || ['other'])[0];
  const rows = [], via = [], direct = new Set();
  const sorted = [...tables].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [t, cols] of sorted) {
    if (NOT_TENANT.has(t)) continue;
    const column = COLUMN_OVERRIDES[t] || TENANT_COLUMNS.find((c) => cols.has(c));
    if (!column) continue;
    direct.add(t);
    rows.push([t, column, tagOf(t)]);
  }
  for (const [t] of sorted) {
    if (direct.has(t) || NOT_TENANT.has(t)) continue;
    if (VIA_OVERRIDES[t] && direct.has(VIA_OVERRIDES[t][1])) { via.push([t, VIA_OVERRIDES[t][0], VIA_OVERRIDES[t][1], tagOf(t)]); continue; }
    const cands = (fks.get(t) || []).filter(([, parent]) => direct.has(parent));
    if (!cands.length) continue;
    const rank = (p) => { const i = PARENT_PREFERENCE.indexOf(p); return i < 0 ? 99 : i; };
    cands.sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
    via.push([t, cands[0][0], cands[0][1], tagOf(t)]);
  }
  const body = rows.map(([t, c, g]) => `  ${t}: { column: '${c}', tag: '${g}' },`).join('\n');
  const globalBody = Object.entries(GLOBAL_TABLES).sort().map(([t, why]) => `  ${t}: ${JSON.stringify(why)},`).join('\n');
  const viaBody = via.map(([t, c, p, g]) => `  ${t}: { via: '${c}', parent: '${p}', tag: '${g}' },`).join('\n');
  return `/**
 * GENERATED by scripts/tenancy/generate-tenant-tables.js — do not edit by hand; change the generator's
 * COLUMN_OVERRIDES / TAG_OVERRIDES / NOT_TENANT and re-run it. CI runs it with --check.
 * Every public table with a tenant column: the column tenantTable() filters/stamps, and the pre-launch tag
 * (owner 2026-11-12: all writes + reads of money / pii / content are pre-launch; 'other' reads follow launch).
 */
export type TenantTag = 'money' | 'pii' | 'content' | 'other';
export const TENANT_TABLES = {
${body}
} as const satisfies Record<string, { column: 'company_id' | 'organization_id' | 'tenant_id'; tag: TenantTag }>;
export type TenantTableName = keyof typeof TENANT_TABLES;
/**
 * INDIRECT tenancy: no tenant column; a row belongs to the tenant that owns its parent (FK to a direct tenant
 * table). tenantChildTable(table, ctx, parentId) verifies the parent under the tenant before any verb.
 */
export const TENANT_CHILD_TABLES = {
${viaBody}
} as const satisfies Record<string, { via: string; parent: TenantTableName; tag: TenantTag }>;
export type TenantChildTableName = keyof typeof TENANT_CHILD_TABLES;
/** GLOBAL tables (no tenant): platform-wide rows; the reason is the review record. */
export const GLOBAL_TABLES: Record<string, string> = {
${globalBody}
};
`;
}

const text = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('[tenant-tables] backend/db/tenantTables.ts is stale: run node scripts/tenancy/generate-tenant-tables.js'); process.exit(1); }
  console.log('[tenant-tables] up to date');
} else {
  fs.writeFileSync(OUT, text);
  const n = (text.match(/column: /g) || []).length;
  console.log(`[tenant-tables] wrote ${n} tenant tables`);
}
