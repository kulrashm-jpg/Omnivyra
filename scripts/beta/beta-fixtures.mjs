/**
 * BETA-022 — Deterministic Beta environment fixtures.
 *
 * Every id here is FIXED so seed/reset/verify are perfectly idempotent: re-seeding
 * deletes exactly these ids and re-inserts them. Nothing is random. Auth-user ids are
 * assigned by GoTrue at creation time and captured at runtime; public.users.id is set
 * equal to the auth id (canonical Supabase pattern), and rows are keyed to it via a
 * lookup — but every APPLICATION row (company, website, reports, campaign, content,
 * assets, posts, engagement, leads, notifications, credits) uses the fixed ids below.
 *
 * Roles map RULE-2's business labels onto the app's real RBAC vocabulary
 * (COMPANY_ADMIN / CONTENT_PUBLISHER / CONTENT_CREATOR / CONTENT_REVIEWER / VIEW_ONLY).
 */

export const BETA = {
  // ── Tenant ────────────────────────────────────────────────────────────────
  company: {
    id: '0beac0de-0000-4000-8000-000000000001',
    name: 'Northwind Beta Co',
    // BETA-BETAFIX-001: the crawlable website must RESOLVE so the manual "Analyze" workflow can
    // populate canonical_pages and produce a real evidence-backed report. The previous value
    // (northwind-beta.test) is a reserved, non-resolvable TLD (RFC 6761) and can never be crawled.
    // books.toscrape.com is a stable, public, multi-page site published for scraping/crawler testing.
    // (admin_email_domain stays on the reserved test TLD — it is never crawled, only used for logins.)
    website: 'https://books.toscrape.com',
    website_domain: 'books.toscrape.com',
    admin_email_domain: 'beta.omnivyra.test',
    industry: 'B2B SaaS',
    size: '11-50',
  },

  website: {
    id: '0beac0de-0000-4000-8000-000000000002',
    name: 'Northwind Beta Website',
    canonical_url: 'https://books.toscrape.com',
    cms_provider: 'webflow',
  },

  // ── Accounts (RULE 2) — deterministic credentials ───────────────────────────
  // password policy: >=8 chars, upper+lower+digit+symbol (matches app signup rules).
  users: [
    { key: 'admin',    label: 'Administrator',     email: 'admin@beta.omnivyra.test',     password: 'BetaAdmin!2026',    role: 'COMPANY_ADMIN',     name: 'Ada Admin',      credits: 300, ucrId: '0beac0de-0000-4000-8000-000000000101' },
    { key: 'marketing',label: 'Marketing Manager', email: 'marketing@beta.omnivyra.test', password: 'BetaMktg!2026',     role: 'CONTENT_PUBLISHER', name: 'Max Marketing',  credits: 300, ucrId: '0beac0de-0000-4000-8000-000000000102' },
    { key: 'writer',   label: 'Content Writer',    email: 'writer@beta.omnivyra.test',    password: 'BetaWriter!2026',   role: 'CONTENT_CREATOR',   name: 'Wren Writer',    credits: 300, ucrId: '0beac0de-0000-4000-8000-000000000103' },
    { key: 'campaign', label: 'Campaign Manager',  email: 'campaign@beta.omnivyra.test',  password: 'BetaCampaign!2026', role: 'CONTENT_REVIEWER',  name: 'Cam Campaign',   credits: 300, ucrId: '0beac0de-0000-4000-8000-000000000104' },
    { key: 'viewer',   label: 'Viewer',            email: 'viewer@beta.omnivyra.test',    password: 'BetaViewer!2026',   role: 'VIEW_ONLY',         name: 'Vic Viewer',     credits: 0,   ucrId: '0beac0de-0000-4000-8000-000000000105' },
  ],

  // ── Seeded datasets (RULE 4) — fixed ids ────────────────────────────────────
  reports: [
    { id: '0beac0de-0000-4000-8000-000000000011', report_type: 'snapshot',           domain: 'books.toscrape.com', authority: 72 },
    { id: '0beac0de-0000-4000-8000-000000000012', report_type: 'content_readiness',  domain: 'books.toscrape.com', authority: 68 },
  ],

  campaign: {
    id: '0beac0de-0000-4000-8000-000000000021',
    name: 'Q3 Thought-Leadership Launch',
    status: 'active',
    current_stage: 'scheduling',
    // campaign_versions companion row — the /api/campaigns list + dashboard counts
    // scope company↔campaign through campaign_versions; without it the campaign is
    // invisible to the dashboard (Total/Active Campaigns show 0).
    versionId: '0beac0de-0000-4000-8000-000000000023',
  },

  content: [
    { id: 'beta-content-01', platform: 'linkedin', content_type: 'post',    title: 'Why buyers trust evidence, not adjectives' },
    { id: 'beta-content-02', platform: 'x',        content_type: 'tweet',   title: 'One metric that predicts churn' },
    { id: 'beta-content-03', platform: 'linkedin', content_type: 'article', title: 'The 2026 B2B content playbook' },
  ],

  assets: [
    { id: 'beta-asset-01', creator_type: 'social_post', title: 'Launch hero — clean photo (POST+IMAGE)' },
    { id: 'beta-asset-02', creator_type: 'social_post', title: 'Quote card — text-inside creative' },
  ],

  posts: [
    { id: '0beac0de-0000-4000-8000-000000000031', platform: 'linkedin', content_type: 'post',  status: 'published', offsetDays: -3 },
    { id: '0beac0de-0000-4000-8000-000000000032', platform: 'twitter',  content_type: 'tweet', status: 'scheduled', offsetDays:  2 },
    { id: '0beac0de-0000-4000-8000-000000000033', platform: 'linkedin', content_type: 'post',  status: 'scheduled', offsetDays:  4 },
  ],

  engagement: {
    threadId:  '0beac0de-0000-4000-8000-000000000041',
    messageId: '0beac0de-0000-4000-8000-000000000051',
  },

  leads: {
    runId: '0beac0de-0000-4000-8000-000000000061',
    rows: [
      { id: '0beac0de-0000-4000-8000-000000000071', person: 'Jordan Buyer', account: 'Acme Corp',   bucket: 'qualified', overall: 87 },
      { id: '0beac0de-0000-4000-8000-000000000072', person: 'Riley Prospect', account: 'Globex Inc', bucket: 'prospect',  overall: 64 },
    ],
  },

  notifications: [
    { id: '0beac0de-0000-4000-8000-000000000081', type: 'report_completed', title: 'Your Content Readiness report is ready' },
    { id: '0beac0de-0000-4000-8000-000000000082', type: 'campaign_ready',   title: 'Q3 campaign plan generated — review & schedule' },
  ],

  credits: {
    orgCreditsId: '0beac0de-0000-4000-8000-000000000091',
    txnId:        '0beac0de-0000-4000-8000-0000000000a1',
    claimId:      '0beac0de-0000-4000-8000-0000000000b1',
    initialFree:  300,
  },

  analyticsDays: 14, // website_analytics_daily rows
};

// Fixed ids grouped by table for precise, deterministic reset.
export const BETA_IDS = {
  companies: [BETA.company.id],
  websites: [BETA.website.id],
  reports: BETA.reports.map((r) => r.id),
  campaigns: [BETA.campaign.id],
  campaign_versions: [BETA.campaign.versionId],
  content_items: BETA.content.map((c) => c.id),
  creator_assets: BETA.assets.map((a) => a.id),
  scheduled_posts: BETA.posts.map((p) => p.id),
  engagement_threads: [BETA.engagement.threadId],
  engagement_messages: [BETA.engagement.messageId],
  active_lead_runs: [BETA.leads.runId],
  active_leads: BETA.leads.rows.map((l) => l.id),
  notifications: BETA.notifications.map((n) => n.id),
  organization_credits: [BETA.credits.orgCreditsId],
  credit_transactions: [BETA.credits.txnId],
  free_credit_claims: [BETA.credits.claimId],
  user_company_roles: BETA.users.map((u) => u.ucrId),
};

export const BETA_EMAILS = BETA.users.map((u) => u.email);
