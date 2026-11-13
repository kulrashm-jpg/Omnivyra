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
/**
 * VIEWS with a tenant column (the scan reads CREATE TABLE only). Registered as DIRECT tenancy on that column, so
 * tenantTable filters them like a table. Each entry is a reviewed decision (e1 S2, 2026-11-13).
 */
const TENANT_VIEWS = {
  company_blog_performance_summary: 'company_id',
  // 55 S2 U classification (2026-11-13, e9-assigned): views exposing a tenant column.
  v_reservation_health: 'organization_id', // credit_transactions holds grouped by organization_id (NOT security_invoker; super-admin dashboard reads all orgs)
  v_billing_operations_health: 'organization_id', // billing_operations grouped by organization_id
  v_company_financial_timeline: 'organization_id', // UNION of credit/financial-audit/approval/payment rows, each carrying organization_id
  community_ai_network_intelligence: 'organization_id', // security_invoker view over community_ai_discovered_users; organization_id matches community_ai_actions' COLUMN_OVERRIDES
  market_pulse_view: 'company_id', // security_invoker view grouped by company_id
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
  // e9 S2 interim: via the CAMPAIGN, not social_account_id (NULL for Connect-flow rows, and an account in another
  // company is exactly the cross-company publish class). campaign_id is NULLABLE: a campaign-less row is unreachable
  // through the seam (fail closed) until 20270217000028 denormalises scheduled_posts.company_id.
  scheduled_posts: ['campaign_id', 'campaigns'],
  // 55 S2 (e9 ruling): multi-hop and non-id-key parents. [via, parent, parentKey] - parentKey defaults to 'id'.
  content_asset_versions: ['asset_id', 'content_assets', 'asset_id'],
  content_reviews: ['asset_id', 'content_assets', 'asset_id'],
  content_asset_attachment: ['content_core_id', 'content_core_asset', 'content_core_id'], // NON-unique key: every core row must be the tenant's
  content_asset_platform_override: ['attachment_id', 'content_asset_attachment'],
  creator_render_attempt: ['variant_id', 'creator_render_variant'], // not the NULLABLE billing_operation_id
  creator_render_output: ['attempt_id', 'creator_render_attempt'], // until 20270217000027 denormalises the tenant
  // 55 S2 U classification (2026-11-13, e9-assigned): per-campaign tables, campaign_id with no FK declared.
  // NULLABLE campaign_id: campaign-less rows are unreachable through the seam (fail closed).
  ai_enhancement_logs: ['campaign_id', 'campaigns'], // NOT NULL; its day_id FK -> daily_content_plans is itself VIA
  ai_improvements: ['campaign_id', 'campaigns'], // NULLABLE
  ai_threads: ['campaign_id', 'campaigns'], // NULLABLE; read by campaign_id
  business_intelligence_reports: ['campaign_id', 'campaigns'], // campaign_id TEXT holding the campaign uuid
  campaign_distribution_decisions: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_execution_state: ['campaign_id', 'campaigns'], // NOT NULL; every access by campaign_id
  campaign_forecasts: ['campaign_id', 'campaigns'], // campaign_id TEXT holding the campaign uuid
  campaign_goals: ['campaign_id', 'campaigns'], // NULLABLE
  campaign_performance_metrics: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_preemption_log: ['initiator_campaign_id', 'campaigns'], // both campaign ids NOT NULL; preemption is between campaigns of one company
  campaign_readiness: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_recommendation_weeks: ['campaign_id', 'campaigns'], // NOT NULL; read by campaign_id (+ session_id)
  campaign_resource_projection: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_strategic_memory: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_strategies: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_user_roles: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_virality_assessments: ['campaign_id', 'campaigns'], // NOT NULL
  campaign_week_plan: ['campaign_id', 'campaigns'], // NOT NULL; campaignPlanStore reads by campaign_id
  content_items: ['campaign_id', 'campaigns'], // legacy; campaign_id VARCHAR, NULLABLE
  content_pillars: ['campaign_id', 'campaigns'], // NOT NULL
  content_plans: ['campaign_id', 'campaigns'], // NULLABLE; every access by campaign_id
  platform_content_slots: ['campaign_id', 'campaigns'], // NOT NULL; its FKs (bolt_content_jobs/daily_content_plans/scheduled_posts) are all VIA
  platform_strategies: ['campaign_id', 'campaigns'], // NOT NULL
  roi_reports: ['campaign_id', 'campaigns'], // campaign_id TEXT holding the campaign uuid
  strategic_memory_snapshots: ['campaign_id', 'campaigns'], // NOT NULL
  voice_notes: ['campaign_id', 'campaigns'], // campaign_id VARCHAR(255), NULLABLE; routes resolve campaign access first
  // 55 S2 U classification (2026-11-13, e9-assigned): multi-hop (parent is itself VIA) and non-id-key parents.
  queue_jobs: ['scheduled_post_id', 'scheduled_posts'], // FK NOT NULL; parent is VIA, so the FK scan cannot pick it
  queue_job_logs: ['job_id', 'queue_jobs'], // job_id NOT NULL, no FK; two hops
  content_analytics: ['scheduled_post_id', 'scheduled_posts'], // FK NOT NULL; post metrics
  scheduled_post_media: ['scheduled_post_id', 'scheduled_posts'], // FK; post-media links
  post_comments: ['scheduled_post_id', 'scheduled_posts'], // FK NOT NULL; comments ingested for a published post
  comment_replies: ['comment_id', 'post_comments'], // FK; two hops
  comment_flags: ['comment_id', 'post_comments'], // FK; two hops
  comment_likes: ['comment_id', 'post_comments'], // FK; two hops
  cms_taxonomy_cache: ['connection_id', 'website_connections'], // FK; parent is VIA
  content_performance_metrics: ['content_asset_id', 'content_assets', 'asset_id'], // FK -> content_assets(asset_id)
  platform_compliance_reports: ['content_asset_id', 'content_assets', 'asset_id'], // FK -> content_assets(asset_id)
  platform_content_variants: ['content_asset_id', 'content_assets', 'asset_id'], // FK -> content_assets(asset_id)
  promotion_metadata: ['content_asset_id', 'content_assets', 'asset_id'], // FK -> content_assets(asset_id)
  // Settlement webhook ledger: checkout_idempotency_key (NULLABLE, no FK) -> billing_checkout_sessions.idempotency_key
  // (NOT NULL UNIQUE; parent DIRECT on organization_id). Unmatched events stay invisible (fail closed); never actioned.
  billing_settlement_events: ['checkout_idempotency_key', 'billing_checkout_sessions', 'idempotency_key'],
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
  // 55 S2 U classification (2026-11-13, e9-assigned): platform catalogs, config, pricing and ops state.
  access_request_rate_limit: 'pre-auth access-request abuse guard keyed by ip_hash (no tenant rows)',
  action_pricing_config: 'platform credit pricing per action_key',
  ai_execution_profile_versions: 'versions of platform AI execution profiles (FK profile_id)',
  ai_execution_profiles: 'platform AI execution profile catalog (key UNIQUE); tenant overrides live in ai_capability_profile_bindings',
  ai_operation_capability_map: 'platform AI operation -> capability map keyed by operation',
  ai_routing_policies: 'platform AI provider routing policies (key UNIQUE)',
  analytics_provider_config: 'platform analytics OAuth app config per provider (GA4 etc.)',
  analytics_serp_provider_health: 'SERP provider health telemetry keyed by provider (platform ops)',
  angle_industry_matrix: 'platform-wide angle x industry performance aggregate, unique (industry, angle_type); no tenant rows',
  api_idempotency_keys: 'request-replay infrastructure keyed by (scope, caller_id, idempotency_key); system-written by withIdempotency',
  billing_fx_rates: 'platform FX rate table keyed by currency (Super Admin pricing config)',
  billing_plan_pricing: 'platform plan price list keyed by plan_key (Super Admin pricing config)',
  billing_price_overrides: 'platform price overrides per sku/currency',
  blocked_domain_patterns: 'platform blocked email-domain patterns',
  blocked_domains: 'platform blocked email-domain list',
  campaign_opportunities: 'platform-wide opportunities from GLOBAL strategic_themes/signal_clusters (unique theme_id, opportunity_type); a company campaign is generated FROM one',
  campaign_readiness_leads: 'platform-owned marketing leads from the public readiness check (visitor-typed company/website/email; PII, not tenant rows)',
  community_ai_platform_policy: 'platform Community AI policy switch (single config)',
  competitor_enrichment_cache: 'public competitor profile enrichment cache keyed by name+domain (no tenant rows)',
  config_change_logs: 'platform admin config change audit',
  content_validation_config: 'platform content-validation thresholds (admin config)',
  cost_reconciliation_runs: 'platform vendor-cost reconciliation runs',
  creator_render_ops_audit: 'render operator action audit (actor, action, target org/provider/job); operator-only, never read for tenant data',
  creator_render_provider: 'render provider registry keyed by provider_key (health, priority; platform ops)',
  credit_cost_config: 'platform credit cost per action_type (pricing config)',
  credit_packages: 'platform credit package catalog (sku, price)',
  credit_untracked_actions: 'platform allow-list of actions exempt from credit tracking',
  curated_industry_sources: 'platform curated industry source catalog',
  currency_exchange_rates: 'platform FX engine rates (source/target currency, provider snapshots)',
  decision_engine_config: 'platform decision-engine thresholds (admin config)',
  disposable_domains: 'platform disposable-email domain list',
  domain_eligibility_cache: 'email-domain MX/eligibility cache keyed by domain',
  domain_whitelist: 'platform email-domain allow-list for free-credit eligibility (Super Admin managed)',
  engagement_sources: 'engagement source type catalog (platform, source_type)',
  experiment_config: 'platform A/B experiment config',
  free_credit_config: 'platform free-credit grant config per category',
  global_campaign_patterns: 'platform-wide aggregated campaign patterns (anonymised, by platform/content_type)',
  governance_lockdown: 'single global governance kill-switch row (GovernanceLockdownService: one row)',
  hidden_billing_catalog: 'platform hidden billing catalog (reference_key, amount)',
  hidden_billing_catalog_audit: 'Super Admin hidden-billing catalog change audit (immutable)',
  image_metadata: 'stock-image provider metadata cache keyed by provider_id',
  image_search_cache: 'stock-image search result cache keyed by query_key',
  intelligence_categories: 'platform intelligence category catalog',
  intelligence_cleanup_progress: 'cleanup-job cursor keyed by job_name (worker infrastructure)',
  intelligence_global_config: 'platform intelligence job config per job_type',
  intelligence_job_runs: 'daily intelligence scheduler run log (ops)',
  intelligence_throttle_config: 'platform intelligence throttle singleton (id = 1 CHECK)',
  intelligence_units: 'platform intelligence-unit catalog (id IU-NN)',
  llm_model_pricing: 'platform LLM vendor price list',
  llm_models: 'platform LLM model catalog',
  llm_providers: 'platform LLM provider catalog',
  marketpulse_signal_impacts: 'impacts of a GLOBAL marketpulse_signals row (FK signal_id)',
  marketpulse_signal_relationships: 'relationships between GLOBAL marketpulse_signals rows (FK both ends)',
  marketpulse_signals: 'platform-wide market signals unique on duplicate_key; per-tenant relevance lives in marketpulse_company_signal_relevance (DIRECT)',
  marketpulse_trends: 'platform-wide market pulse trends; per-company impact lives in marketpulse_business_impacts (DIRECT)',
  payment_provider_config: 'platform payment-provider catalog/switches, unique per provider (Super Admin config)',
  plan_limits: 'limits per pricing plan (plan_id, resource_key): plan catalog',
  platform_content_rules: 'content rules per platform_master entry (catalog)',
  platform_master: 'platform (social network) master catalog',
  platform_oauth_configs: 'platform OAuth app credentials per social platform (keyed by platform)',
  platform_post_metadata_requirements: 'required post metadata per platform_master row (catalog)',
  platform_registry: 'social-platform capability catalog keyed by platform_key',
  platform_rules: 'platform content rules per social platform (catalog)',
  platform_rules_config: 'platform rules admin config',
  prediction_config: 'platform prediction weights (admin-tunable config)',
  pricing_adjustment_queue: 'platform pricing-multiplier review queue (Super Admin)',
  pricing_intelligence: 'platform pricing margin analytics per action/model/week',
  pricing_plans: 'platform subscription plan catalog (plan_key, price)',
  provider_invoice_imports: 'platform provider invoices (our AI/API vendor bills)',
  provisioned_resources: 'platform infrastructure cost inventory (Supabase/Vercel/etc.)',
  public_email_providers: 'public email-domain list (gmail etc.)',
  rbac_config: 'platform RBAC role/permission config (versioned)',
  recommendation_policies: 'platform recommendation weighting policies',
  scheduler_locks: 'scheduler lease rows keyed by job_name (worker infrastructure)',
  settlement_metrics_rollup: 'billing settlement ops metric rollups',
  settlement_operational_metrics: 'billing settlement ops metrics',
  settlement_runtime_locks: 'settlement worker locks keyed by lock_key',
  signal_intelligence: 'platform-wide intelligence per GLOBAL signal_clusters row; companies jsonb lists mentioned entities, not owners',
  super_admin_audit_logs: 'platform operator (Super Admin) audit trail',
  system_anomalies: 'platform anomaly telemetry (Super Admin system health)',
  token_refresh_locks: 'OAuth token refresh lock rows keyed by lock_key (worker infrastructure)',
  tone_config: 'platform tone rules keyed by tone_name (admin config)',
  user_friendly_error_mappings: 'platform error-message mapping catalog',
  user_override: 'Super Admin free-credit eligibility override per auth user (platform signup gate)',
  worker_dead_letter_queue: 'worker dead-letter queue (ops); tenant only inside job_payload JSON',
  worker_health: 'worker heartbeat telemetry (ops)',
};
/** Tables that carry a tenant-named column but are NOT tenant-owned rows (global config or cross-tenant ledgers). */
const NOT_TENANT_REASONS = {
  users: "identity: a user spans companies; users.company_id is legacy (C21: 105 NULL); access is the membership layer's",
  user_company_roles: "membership: keyed by user across companies BY DESIGN (auth resolves which companies a user may act in)",
  companies: "tenant ROOT: the row IS the tenant; scope by id = ctx.companyId, never by a tenant column",
  engagement_authors: "external platform identities deduped ACROSS tenants; tenant linkage is on the referencing engagement rows",
  referrals: "cross-tenant referral ledger (referrer and referee orgs) by design",
  signup_intents: "pre-account signup intent keyed by email: no company exists yet",
  auth_sessions: "identity layer: per user, spans companies",
  auth_audit_logs: "identity layer: user auth event audit",
  trusted_devices: "identity layer: user device trust",
  webauthn_credentials: "identity layer: user passkeys",
  webauthn_challenges: "identity layer: passkey ceremony challenges",
  totp_factors: "identity layer: user MFA factors",
  recovery_codes: "identity layer: user MFA recovery codes",
  stepup_sessions: "identity layer: user step-up auth sessions",
  user_preferences: "per-USER UI preference, UNIQUE(user_id); a user spans companies",
  adapter_configs: "per-USER content-adapter preferences, UNIQUE(user_id, platform); not tenant content",
};
const NOT_TENANT = new Set(Object.keys(NOT_TENANT_REASONS));
const TAG_RULES = [
  ['money', /(credit|billing|invoice|payment|wallet|purchase|refund|subscription|pricing|monetiz|settlement|usage_event|cost|quota|ledger|charge)/],
  ['pii', /(person|persons|contact|lead|prospect|user|member|identity|email|phone|recipient|author|consent|erasure|suppression|governance|invitation|address|profile_person|unified_)/],
  ['content', /(content|blog|post|plan|campaign|creator|asset|media|message|thread|comment|draft|template|report|snapshot|engagement|opportunit|knowledge|profile|brand|theme|calendar|render|image|video|document|note|reply|story)/],
];
/** Per-table tag corrections (money > pii > content > other). */
const TAG_OVERRIDES = {
  integration_credentials: 'money',
  // 55 S2 U classification (2026-11-13): billing views the name rules tag 'other'; their reads are pre-launch (money).
  v_reservation_health: 'money',
  v_billing_operations_health: 'money',
  v_company_financial_timeline: 'money',
};
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
  for (const [v, col] of Object.entries(TENANT_VIEWS)) tables.set(v, new Set([...(tables.get(v) || []), col]));
  const sortedAll = [...tables].sort((a, b) => a[0].localeCompare(b[0]));
  sorted.length = 0; sorted.push(...sortedAll);
  for (const [t, cols] of sorted) {
    if (NOT_TENANT.has(t)) continue;
    const column = COLUMN_OVERRIDES[t] || TENANT_COLUMNS.find((c) => cols.has(c));
    if (!column) continue;
    direct.add(t);
    rows.push([t, column, tagOf(t)]);
  }
  for (const [t] of sorted) {
    if (direct.has(t) || NOT_TENANT.has(t)) continue;
    if (VIA_OVERRIDES[t] && direct.has(VIA_OVERRIDES[t][1])) { via.push([t, VIA_OVERRIDES[t][0], VIA_OVERRIDES[t][1], tagOf(t), VIA_OVERRIDES[t][2]]); continue; }
    if (VIA_OVERRIDES[t]) continue; // multi-hop: resolved after the first pass
    const cands = (fks.get(t) || []).filter(([, parent]) => direct.has(parent));
    if (!cands.length) continue;
    const rank = (p) => { const i = PARENT_PREFERENCE.indexOf(p); return i < 0 ? 99 : i; };
    cands.sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
    via.push([t, cands[0][0], cands[0][1], tagOf(t)]);
  }
  const body = rows.map(([t, c, g]) => `  ${t}: { column: '${c}', tag: '${g}' },`).join('\n');
  const globalBody = Object.entries(GLOBAL_TABLES).sort().map(([t, why]) => `  ${t}: ${JSON.stringify(why)},`).join('\n');
  const notTenantBody = Object.entries(NOT_TENANT_REASONS).sort().map(([t, why]) => `  ${t}: ${JSON.stringify(why)},`).join('\n');
  // Multi-hop overrides: a parent that is itself a child. Iterate to a fixpoint; an override whose chain never
  // reaches a direct table stays unclassified (and --strict refuses), never silently direct.
  for (let changed = true; changed;) {
    changed = false;
    const viaSet = new Set(via.map((v) => v[0]));
    for (const [t, ov] of Object.entries(VIA_OVERRIDES)) {
      if (direct.has(t) || viaSet.has(t) || !tables.has(t) || !viaSet.has(ov[1])) continue;
      via.push([t, ov[0], ov[1], tagOf(t), ov[2]]); changed = true;
    }
  }
  via.sort((a, b) => a[0].localeCompare(b[0]));
  const viaBody = via.map(([t, c, p, g, k]) => `  ${t}: { via: '${c}', parent: '${p}', ${k && k !== 'id' ? `parentKey: '${k}', ` : ''}tag: '${g}' },`).join('\n');
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
} as const satisfies Record<string, { via: string; parent: TenantTableName | string; parentKey?: string; tag: TenantTag }>;
export type TenantChildTableName = keyof typeof TENANT_CHILD_TABLES;
/** GLOBAL tables (no tenant): platform-wide rows; the reason is the review record. */
export const NOT_TENANT_TABLES: Record<string, string> = {
${notTenantBody}
};
/** GLOBAL: no tenant at all (platform-wide content or system state). */
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
