/**
 * BETA-022 — Deterministic Beta environment seeder (RULES 1, 2, 4).
 *
 * Provisions ONE complete beta tenant (company, 5 role accounts, credits, website +
 * health + analytics, reports w/ authority score, campaign, generated content + creator
 * assets, scheduler history, engagement, leads, notifications) so a tester lands in a
 * fully-populated product on first login. Idempotent: calls resetBeta() first, then
 * inserts every row by fixed id. Zero external calls; image generation is handled at
 * runtime by BETA_AI_MODE (deterministic mock — see docs/beta-testing.md).
 *
 * Requires a NON-PRODUCTION Supabase (local `supabase start` or a throwaway project):
 *   set -a; . ./path/to/beta.keys.env; set +a
 *   node scripts/beta/seed-beta.mjs
 */
import { serviceClient, betaEnv, log, ok, warn, fail } from './beta-client.mjs';
import { resetBeta } from './reset-beta.mjs';
import { BETA } from './beta-fixtures.mjs';

const sb = serviceClient();
const now = new Date();
const iso = (d) => d.toISOString();
const dayOffset = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };

let critFail = 0;
async function put(table, rows, { critical = false } = {}) {
  const { error } = await sb.from(table).insert(rows);
  if (error) {
    (critical ? fail : warn)(`${table}: ${error.message}`);
    if (critical) critFail++;
    return false;
  }
  ok(`${table} (${Array.isArray(rows) ? rows.length : 1})`);
  return true;
}

async function main() {
  betaEnv();
  log('\n=== BETA-022 seed ===');
  await resetBeta(sb);
  log('· Seeding beta tenant…');

  // 1) Company (RULE 1)
  await put('companies', {
    id: BETA.company.id, name: BETA.company.name, website: BETA.company.website,
    website_domain: BETA.company.website_domain, admin_email_domain: BETA.company.admin_email_domain,
    industry: BETA.company.industry, size: BETA.company.size, status: 'active',
    free_credit_granted_at: iso(now), updated_at: iso(now),
  }, { critical: true });

  // 1a) Credit cost catalog (global config; generation credit-deduction requires these rows).
  //     Idempotent — mirrors the prod pricing migrations so credit-wrapped generation completes.
  const COST_CATALOG = [
    ['ai_reply',1,'low'],['auto_post',2,'low'],['content_rewrite',3,'low'],['content_basic',5,'low'],
    ['trend_analysis',25,'medium'],['market_insight_manual',30,'medium'],['campaign_creation',40,'medium'],
    ['website_audit',50,'medium'],['lead_detection',15,'high'],['daily_insight_scan',20,'high'],
    ['campaign_optimization',30,'high'],['voice_per_minute',10,'heavy'],['deep_analysis',60,'heavy'],
    ['full_strategy',80,'heavy'],['campaign_generation',50,'heavy'],['prediction',10,'medium'],
    ['optimization_loop',15,'high'],['reply_generation',2,'low'],['insight_generation',8,'medium'],
    ['pattern_detection',12,'medium'],['market_positioning',10,'medium'],['portfolio_decision',20,'high'],
    ['strategy_evolution',15,'high'],['competitor_signals',8,'medium'],['creator_content',5,'low'],
    ['blog_generation',60,'heavy'],['image_generation',8,'medium'],['video_generation',30,'heavy'],
    ['lead_qualification',2,'medium'],['lead_predictive_scoring',3,'medium'],
  ];
  {
    const rows = COST_CATALOG.map(([action_type, credits, category]) => ({
      action_type, credits, category, description: `${action_type} (beta seed)`, smart_dedup_seconds: 0,
    }));
    const { error } = await sb.from('credit_cost_config').upsert(rows, { onConflict: 'action_type', ignoreDuplicates: true });
    error ? warn(`credit_cost_config: ${error.message}`) : ok(`credit_cost_config (${rows.length} actions)`);
  }

  // 1b) Company profile (readiness gate reads this; website_url mirrors companies.website)
  await put('company_profiles', {
    company_id: BETA.company.id, name: BETA.company.name, industry: BETA.company.industry,
    website_url: BETA.company.website, linkedin_url: 'https://www.linkedin.com/company/northwind-beta',
  });

  // 2) Accounts (RULE 2) — GoTrue auth user + public.users + membership role
  const ids = {};
  for (const u of BETA.users) {
    const { data, error } = await sb.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
      user_metadata: { name: u.name, beta: true },
    });
    if (error || !data?.user) { fail(`auth ${u.email}: ${error?.message}`); critFail++; continue; }
    ids[u.key] = data.user.id;
  }
  const admin = ids.admin, writer = ids.writer, marketing = ids.marketing;

  const userRows = BETA.users.filter((u) => ids[u.key]).map((u) => ({
    id: ids[u.key], email: u.email, name: u.name, supabase_uid: ids[u.key],
    company_id: BETA.company.id, active_company_id: BETA.company.id, role: u.role,
    credits: u.credits, is_email_verified: true, has_password: true,
    auth_level: 'email_verified', onboarding_state: 'company_complete', status: 'active',
    signup_source: 'beta_seed', updated_at: iso(now), activated_at: iso(now),
  }));
  await put('users', userRows, { critical: true });

  const ucrRows = BETA.users.filter((u) => ids[u.key]).map((u) => ({
    id: u.ucrId, user_id: ids[u.key], company_id: BETA.company.id, role: u.role,
    status: 'active', join_source: 'invited', name: u.name,
    invited_at: iso(now), accepted_at: iso(now), updated_at: iso(now),
  }));
  await put('user_company_roles', ucrRows, { critical: true });

  // 3) Credits (RULE 4) — wallet + immutable ledger + claim record
  await put('organization_credits', {
    id: BETA.credits.orgCreditsId, organization_id: BETA.company.id,
    free_balance: BETA.credits.initialFree, paid_balance: 0, incentive_balance: 0,
    lifetime_purchased: 0, lifetime_consumed: 0, category: 'free', credit_rate_usd: 0.01,
  }, { critical: true });
  // immutable ledger — insert once, ignore on re-seed (append-only, DO NOTHING on conflict)
  {
    const { error } = await sb.from('credit_transactions').upsert({
      id: BETA.credits.txnId, organization_id: BETA.company.id,
      transaction_type: 'initial_grant', category: 'free',
      credits_delta: BETA.credits.initialFree, free_delta: BETA.credits.initialFree,
      balance_after: BETA.credits.initialFree, reference_type: 'beta_seed',
      idempotency_key: `beta-initial-free-${BETA.company.id}`, note: 'Beta seed initial free credits',
    }, { onConflict: 'id', ignoreDuplicates: true });
    error ? warn(`credit_transactions: ${error.message}`) : ok('credit_transactions (ledger, idempotent)');
  }
  if (admin) await put('free_credit_claims', {
    id: BETA.credits.claimId, user_id: admin, organization_id: BETA.company.id,
    category: 'initial_free_credit', credits_granted: BETA.credits.initialFree,
    domain: BETA.company.website_domain,
  });

  // 3b) Mock connected social accounts (RULE 4) — the scheduler needs ≥1 connected
  //     platform to schedule; with USE_MOCK_PLATFORMS these seeded rows register as
  //     connected (access_token present, future expiry). No real OAuth/publish occurs.
  if (admin) {
    const social = ['linkedin', 'twitter'].map((platform) => ({
      user_id: admin, company_id: BETA.company.id, platform,
      platform_user_id: `beta_${platform}_uid`, account_name: `Northwind Beta ${platform}`,
      username: 'northwind_beta', access_token: `mock_beta_token_${platform}`, is_active: true,
      token_expires_at: new Date(now.getTime() + 90 * 864e5).toISOString(),
      connection_state: 'connected', follower_count: 1200,
    }));
    await put('social_accounts', social);
  }

  // 4) Website + health + analytics (RULE 4)
  await put('websites', {
    id: BETA.website.id, company_id: BETA.company.id, name: BETA.website.name,
    canonical_url: BETA.website.canonical_url, cms_provider: BETA.website.cms_provider,
    status: 'active', created_by: admin || null,
  });
  await put('website_health_scores', {
    company_id: BETA.company.id, website_id: BETA.website.id, composite_score: 72,
    category_scores: { content: 74, technical: 70, accessibility: 66, brand: 78 },
    issues: [{ severity: 'medium', title: 'Missing meta descriptions on 4 pages' }],
    recommendations: [{ priority: 1, title: 'Add structured data to blog posts' }],
    improvement_priorities: [{ rank: 1, area: 'content_depth' }],
  });
  const analytics = Array.from({ length: BETA.analyticsDays }, (_, i) => {
    const d = dayOffset(-(BETA.analyticsDays - i));
    const pv = 400 + ((i * 37) % 260);
    return {
      company_id: BETA.company.id, website_id: BETA.website.id, day: d.toISOString().slice(0, 10),
      page_views: pv, unique_visitors: Math.round(pv * 0.62), cta_clicks: Math.round(pv * 0.08),
      form_starts: Math.round(pv * 0.04), form_submits: Math.round(pv * 0.015),
      outbound_clicks: Math.round(pv * 0.05), conversions: Math.round(pv * 0.012),
      source_breakdown: { organic: 0.48, social: 0.27, direct: 0.15, referral: 0.10 },
    };
  });
  await put('website_analytics_daily', analytics);

  // 5) Reports w/ authority score (RULE 4)
  const reportRows = BETA.reports.map((r, i) => ({
    id: r.id, company_id: BETA.company.id, user_id: admin || null, domain: r.domain,
    report_type: r.report_type, status: 'completed', is_free: i === 0,
    report_id: `beta-report-${i + 1}`, started_at: iso(dayOffset(-5)), completed_at: iso(dayOffset(-5)),
    data: { authority_score: r.authority, summary: `Authority ${r.authority}/100 for ${r.domain}`,
      categories: { visibility: r.authority - 4, trust: r.authority + 2, content: r.authority } },
    json_output: { authority_score: r.authority, generated_by: 'beta_seed' },
  }));
  await put('reports', reportRows, { critical: true });

  // 6) Campaign (RULE 4)
  await put('campaigns', {
    id: BETA.campaign.id, company_id: BETA.company.id, user_id: admin || null,
    name: BETA.campaign.name, status: BETA.campaign.status, current_stage: BETA.campaign.current_stage,
    start_date: dayOffset(-7).toISOString().slice(0, 10), end_date: dayOffset(21).toISOString().slice(0, 10),
    duration_weeks: 4, blueprint_status: 'ACTIVE', launched_at: iso(dayOffset(-7)),
    weekly_themes: [{ week: 1, theme: 'Trust & evidence' }, { week: 2, theme: 'Playbooks' }],
  });
  // campaign_versions companion — the /api/campaigns list + dashboard Total/Active
  // Campaigns counts derive the company's campaigns from this table (the POST flow
  // writes it). Without it the seeded campaign is invisible to the dashboard.
  await put('campaign_versions', {
    id: BETA.campaign.versionId, company_id: BETA.company.id, campaign_id: BETA.campaign.id,
    version: 1, status: BETA.campaign.status,
    campaign_snapshot: {
      name: BETA.campaign.name, status: BETA.campaign.status, current_stage: BETA.campaign.current_stage,
      duration_weeks: 4, target_regions: ['global'],
      planning_context: { content_capacity: { post: { perWeek: 3, creationMethod: 'ai' } } },
    },
  });

  // 7) Generated content + creator assets (RULE 4)
  const contentRows = BETA.content.map((c, i) => ({
    id: c.id, title: c.title, content: `${c.title}. (Beta-seeded ${c.content_type} for demo.)`,
    platform: c.platform, content_type: c.content_type, context: 'campaign',
    campaign_id: BETA.campaign.id, ai_generated: true, status: 'published',
    week_number: 1, day_number: i + 1, hashtags: ['#B2B', '#content'],
  }));
  await put('content_items', contentRows);

  const assetRows = BETA.assets.map((a, i) => ({
    id: a.id, company_id: BETA.company.id, user_id: writer || admin || null,
    creator_type: a.creator_type, title: a.title, preview_kind: 'image',
    files: [{ kind: 'image', url: `https://beta.local/mock/${a.id}.png`, model: 'beta-mock', width: 1024, height: 1024 }],
    metadata: { attachment_mode: i === 0 ? 'supporting_visual' : 'embedded_copy', beta: true },
    platform_context: 'linkedin', source_type: 'post',
  }));
  await put('creator_assets', assetRows);

  // 8) Scheduler history (RULE 4)
  const postRows = BETA.posts.map((p, i) => ({
    id: p.id, user_id: marketing || admin || null, campaign_id: BETA.campaign.id,
    platform: p.platform, content_type: p.content_type, title: `Beta post ${i + 1}`,
    content: BETA.content[i % BETA.content.length].title, scheduled_for: iso(dayOffset(p.offsetDays)),
    status: p.status, published_at: p.status === 'published' ? iso(dayOffset(p.offsetDays)) : null,
    ai_score: 82 + i,
  }));
  await put('scheduled_posts', postRows);

  // 9) Engagement (RULE 4)
  await put('engagement_threads', {
    id: BETA.engagement.threadId, platform: 'linkedin', platform_thread_id: 'beta-thread-1',
    organization_id: BETA.company.id, unread_count: 1, priority_score: 0.8,
  });
  await put('engagement_messages', {
    id: BETA.engagement.messageId, thread_id: BETA.engagement.threadId, platform: 'linkedin',
    platform_message_id: 'beta-msg-1', message_type: 'comment', direction: 'inbound',
    content: 'Great post — do you have a case study on this?', like_count: 4, reply_count: 0,
  });

  // 10) Leads (RULE 4)
  await put('active_lead_runs', {
    id: BETA.leads.runId, company_id: BETA.company.id, mode: 'one_time', bucket_focus: 'all',
    geography_scope: 'all', delivery_mode: 'page_only', status: 'completed',
    started_at: iso(dayOffset(-1)), completed_at: iso(dayOffset(-1)),
  });
  const leadRows = BETA.leads.rows.map((l) => ({
    id: l.id, run_id: BETA.leads.runId, company_id: BETA.company.id,
    canonical_lead_key: `beta-${l.id.slice(-4)}`, source_type: 'engagement', source_platform: 'linkedin',
    person_name: l.person, account_name: l.account, bucket: l.bucket, overall_score: l.overall,
    intent_score: l.overall - 5, fit_score: l.overall - 8, authority_score: l.overall - 12,
    timing_score: l.overall - 3, engagement_score: l.overall,
    summary: `${l.person} at ${l.account} engaged with beta content.`,
    why_this_is_a_lead: 'Commented on a product post and visited pricing.',
    recommended_action: 'Send a tailored follow-up with the case study.',
    change_status: 'new', reason_codes: ['engaged_post', 'pricing_visit'],
    first_seen_at: iso(dayOffset(-2)), last_seen_at: iso(dayOffset(-1)),
  }));
  await put('active_leads', leadRows);

  // 11) Notifications (RULE 4)
  if (admin) await put('notifications', BETA.notifications.map((n) => ({
    id: n.id, user_id: admin, type: n.type, title: n.title,
    message: 'Open your dashboard to review.', is_read: false,
  })));

  log(`\n=== seed ${critFail ? 'COMPLETED WITH ' + critFail + ' CRITICAL FAILURE(S)' : 'OK'} ===`);
  log(`company_id = ${BETA.company.id}`);
  log('accounts:'); BETA.users.forEach((u) => log(`  ${u.label.padEnd(20)} ${u.email}  /  ${u.password}  [${u.role}]`));
  process.exit(critFail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
