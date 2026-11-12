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

// Precedence picks the NARROWEST available scope on purpose (05): a wrongly-narrow predicate hides rows (fail
// closed), a wrongly-broad one leaks them. COLUMN_OVERRIDES names the exceptions.
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
  company_blog_series_posts: ['series_id', 'company_blog_series'], // e1 S2: every route op is keyed by SERIES (series/[id], series/index); the series is company-scoped. Blog ownership of referenced posts stays SEC-1's check.
  // 55 S2 (2026-11-13): campaign_id NOT NULL, no FK declared; every access is by campaign id.
  weekly_content_refinements: ['campaign_id', 'campaigns'], // schedulingService, campaignBlueprintService: always read by campaign_id
  creator_execution_dead_letter_queue: ['campaign_id', 'campaigns'], // creatorExecutionObservabilityService: write-only, per campaign
  creator_execution_metrics: ['campaign_id', 'campaigns'], // write-only, per campaign
  creator_execution_summaries: ['campaign_id', 'campaigns'], // upsert-only, per campaign
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
  // 55 S2 (2026-11-13): no tenant column, no tenant-owned rows.
  creator_alert_state: 'creator ops alert dedup state, keyed by alert_key (platform alerting, no tenant rows)',
  creator_cron_lease: 'creator cron lease rows keyed by job_name (worker infrastructure, no tenant data)',
  creator_render_metrics: 'renderer telemetry keyed by metric_name / audit_id (platform ops)',
  signal_clusters: 'platform-wide market signal clusters (topic + embedding; no tenant)',
  strategic_themes: 'platform-wide intelligence themes; per-company relevance lives in theme_company_relevance (DIRECT)',
  // No CREATE TABLE in supabase/ (schema only in contentArchitectSecurityService.ts:264): missing migration flagged.
  content_architect_sessions: 'platform Content Architect access sessions keyed by token hash / user_id (no tenant rows)',
  // e9 rulings (2026-11-13): ops mirrors / ops state, never read for tenant data. The three render-mirror tables
  // are pinned by backend/tests/unit/s2RenderMirrorTablesNotTenantFacing.test.ts (no pages/api reference).
  creator_render_jobs: 'durable ops mirror of BullMQ render jobs; tenant only inside payload JSON; never read for tenant data (tenant reads use creator_render_job)',
  creator_render_job_events: 'ops event log of the creator_render_jobs mirror; never read for tenant data',
  creator_render_validation_manifests: 'ops validation manifests of the creator_render_jobs mirror; never read for tenant data',
  creator_dead_letter_jobs: 'creator publish dead-letter queue (operator view, worker-written)',
  creator_upload_rate_state: 'upload abuse-guard rate buckets (system-written; polymorphic user/company/plan scope)',
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
const TAG_OVERRIDES = { integration_credentials: 'money' };
/**
 * TENANT_OR_PLATFORM (e9 ruling on C28, 2026-11-12): catalog tables whose NULL-tenant rows are PLATFORM rows
 * every tenant may READ. Reads go through tenantOrPlatformTable (tenant rows + platform rows); writes are
 * tenant-stamped; platform rows are writable only on allow-listed Super Admin paths.
 */
const TENANT_OR_PLATFORM = ['action_registry', 'expected_event_definitions', 'external_api_sources'];
/**
 * SENSITIVE (e9 ruling): platform (NULL-tenant) rows must be INVISIBLE to tenants; tenantTable (tenant rows only)
 * is the only tenant read; platform-row reads only on allow-listed system / Super Admin paths.
 */
const SENSITIVE = ['integration_credentials'];
/**
 * NULLS IN PROD (C28, owner-approved prod read 2026-11-12): nullable tenant columns that actually hold NULL rows.
 * tenantTable hides those rows. For audit/system tables that is CORRECT (e9); for the others the gate warns.
 * [nullRows, totalRows].
 */
const NULLS_IN_PROD = {
  queue_metrics: [474474, 474474], capability_audit_log: [21623, 22379], audit_logs: [527, 2877],
  creator_operational_events: [136, 138], creator_audit_log: [65, 65], alerts: [36, 50], cost_anomalies: [36, 1424],
  external_api_sources: [15, 15], activity_logs: [13, 13], action_registry: [9, 9], campaigns: [7, 28],
  integration_credentials: [5, 6], campaign_cost_breakdown: [2, 2], report_score_history: [2, 2], expected_event_definitions: [1, 1],
};
/** e9: hiding the NULL (platform) rows is CORRECT for these; no warning on conversion. */
const NULLS_HIDING_OK = ['queue_metrics', 'capability_audit_log', 'audit_logs', 'creator_operational_events', 'creator_audit_log',
  'alerts', 'cost_anomalies', 'activity_logs', 'campaign_cost_breakdown', 'report_score_history',
  'campaigns' /* e9: company-less campaigns stay invisible to every tenant until the owner decides */, 'integration_credentials'];

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
  // 05 (S1 review): a table in NO class is invisible to the gate, so a fall-through is never silent. It is listed
  // explicitly here, and --strict refuses the build until every table is classified with a reason.
  const classified = new Set([...direct, ...via.map((v) => v[0]), ...Object.keys(GLOBAL_TABLES), ...NOT_TENANT]);
  unclassifiedOut.length = 0;
  for (const [t] of sorted) if (!classified.has(t)) unclassifiedOut.push(t);
  const unclassifiedBody = unclassifiedOut.map((t) => `  '${t}',`).join('\n');
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
/**
 * UNCLASSIFIED: tables found in the schema sources that are in NO class above. Each must be classified (direct,
 * indirect via VIA_OVERRIDES, GLOBAL_TABLES with a reason, or NOT_TENANT) by its owning track; --strict refuses
 * while this list is non-empty. Code touching one of these is reported by the gate as category U.
 */
export const UNCLASSIFIED_TABLES: readonly string[] = [
${unclassifiedBody}
];
/** TENANT_OR_PLATFORM catalog tables (e9 on C28): read via tenantOrPlatformTable = tenant rows + platform (NULL) rows. */
export const TENANT_OR_PLATFORM_TABLES: readonly string[] = ${JSON.stringify(TENANT_OR_PLATFORM)};
/** SENSITIVE (e9 on C28): platform (NULL-tenant) rows are never visible to tenants; tenantTable only. */
export const SENSITIVE_TABLES: readonly string[] = ${JSON.stringify(SENSITIVE)};
/** C28 (prod, 2026-11-12): [nullRows, totalRows] for nullable tenant columns that hold NULLs. */
export const NULLS_IN_PROD: Readonly<Record<string, readonly [number, number]>> = ${JSON.stringify(NULLS_IN_PROD)};
/** e9: tenantTable hiding the NULL rows of these is CORRECT (no conversion warning). */
export const NULLS_HIDING_OK: readonly string[] = ${JSON.stringify(NULLS_HIDING_OK)};
`;
}

const unclassifiedOut = [];
const text = build();
if (process.argv.includes('--strict') && unclassifiedOut.length) {
  console.error(`[tenant-tables] STRICT: ${unclassifiedOut.length} unclassified tables (see UNCLASSIFIED_TABLES)`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('[tenant-tables] backend/db/tenantTables.ts is stale: run node scripts/tenancy/generate-tenant-tables.js'); process.exit(1); }
  console.log('[tenant-tables] up to date');
} else {
  fs.writeFileSync(OUT, text);
  const n = (text.match(/column: /g) || []).length;
  console.log(`[tenant-tables] wrote ${n} tenant tables`);
}
