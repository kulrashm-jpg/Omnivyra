/**
 * STEP 3AH-91 (SEC-F, F6) — the 31 dormant routes hardened by ROUTE-AUTH-001
 * (docs/security/ROUTE_AUTH_001_3AH85.md §4 rows 71–101: classes D, D2, F)
 * stay covered.
 *
 * Two independent pins:
 *   1. CURRENT VERDICT — each route passes the gate with a verdict at least as
 *      strong as the one certified in 3AH-85 (a dormant route that is later
 *      deleted is also acceptable: an absent file is not an entry point).
 *   2. REGRESSION SHAPES — the pre-3AH-85 sources are not in the tree, so a
 *      minimal representative fixture of each vulnerable class is analysed AT
 *      THE REAL ROUTE PATH and must be rejected with the rule that caught it.
 */
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');

const REPO = path.resolve(__dirname, '../../..');
const RANK: Record<string, number> = { none: 0, identity: 1, machine: 2, tenant: 3, platform: 4 };

type Expect = { min?: 'identity' | 'tenant' | 'platform'; allow?: string[] };
const MACHINE: Expect = { allow: ['machine-secret', 'machine-token', 'webhook-signature'] };

// Route → minimum verdict certified in 3AH-85 (class in the comment).
const DORMANT: Record<string, Expect> = {
  // D — dormant, unauthenticated or fail-open (16)
  'ai/check-claude-config.ts': { min: 'platform' },
  'ai/check-gpt-config.ts': { min: 'platform' },
  'campaigns/campaign-summary-update.ts': { min: 'tenant' },
  'campaigns/recommendations.ts': { min: 'tenant' },
  'campaigns/recommendations/optimize-week.ts': { min: 'tenant' },
  'campaigns/update-platforms.ts': { min: 'tenant' },
  'credits/estimate.ts': { min: 'identity' },
  'governance/summary.ts': { min: 'tenant' },
  'performance/ingest.ts': { min: 'tenant' },
  'posts.js': { min: 'platform' },
  'publishing/reconcile/run.ts': MACHINE,
  'publishing/worker/run.ts': MACHINE,
  'queue/stats.ts': { min: 'platform' },
  'system/diagnostics/engagement.ts': { min: 'platform' },
  'website-analytics/aggregate.ts': MACHINE,
  'wordpress-plugin/register.ts': { min: 'tenant' },
  // D2 — dormant, authenticated but unbound (5)
  'campaigns/ai/plan-v2.ts': { min: 'tenant' },
  'campaigns/save.ts': { min: 'tenant' },
  'threadRuntime/failures.ts': { min: 'tenant' },
  'threadRuntime/replay.ts': { min: 'tenant' },
  'threadRuntime/timeline.ts': { min: 'tenant' },
  // F — referenced only by tests/docs (10)
  'analytics/platform/[platform].ts': { min: 'identity' },
  'analytics/post/[postId].ts': { min: 'tenant' },
  'campaigns/conflicts.ts': { min: 'tenant' },
  'campaigns/get-strategy.ts': { min: 'tenant' },
  'campaigns/metrics.ts': { min: 'tenant' },
  'campaigns/weekly-performance.ts': { min: 'tenant' },
  'performance/collect.ts': { min: 'tenant' },
  'social/comments.ts': { min: 'tenant' },
  'templates/[id]/render.ts': { min: 'identity', allow: ['identity-scoped', 'inline-binding'] },
  'trends/drift-check.ts': { min: 'tenant' },
};

describe('the 31 dormant routes keep their certified verdict', () => {
  const { rows } = gate.scanRepo();
  const byRoute = new Map<string, { level: string; allow: string | null; violations: unknown[]; campaignKeyed: boolean; campaignBound: boolean; ids: string[] }>(
    rows.map((r: { route: string }) => [r.route, r]),
  );

  it('the inventory is exactly the 31 routes of classes D (16), D2 (5), F (10)', () => {
    expect(Object.keys(DORMANT)).toHaveLength(31);
  });

  it.each(Object.entries(DORMANT))('%s', (route, exp) => {
    const rel = `pages/api/${route}`;
    const row = byRoute.get(rel);
    if (!row) {
      // Deleting a dormant route closes it; renaming one must not silently drop it.
      expect(fs.existsSync(path.join(REPO, rel))).toBe(false);
      return;
    }
    expect(row.violations).toEqual([]);
    if (row.allow) {
      // A reviewed allowlist entry must be one of the kinds certified for this route — never public/health.
      expect(exp.allow || []).toContain(row.allow);
    } else {
      expect(RANK[row.level]).toBeGreaterThanOrEqual(RANK[exp.min || 'identity']);
      if (row.campaignKeyed) expect(row.campaignBound).toBe(true);
      if (row.ids.length) expect(RANK[row.level]).toBeGreaterThanOrEqual(RANK.tenant);
    }
  });
});

describe('the pre-3AH-85 vulnerable shapes are rejected at the real dormant paths', () => {
  const DB = "import { supabase } from '../../backend/db/supabaseClient';";
  const rules = (rel: string, src: string): string[] =>
    gate.analyzeRoute(rel, src, gate.loadAllowlist(), {}).violations.map((v: { rule: string }) => v.rule);

  it('D: posts.js — service-role read of every tenant\'s post_events, no auth → R1', () => {
    const src = `${DB}
export default async function handler(req, res) {
  const { data } = await supabase.from('post_events').select('*').order('created_at', { ascending: false }).limit(20);
  res.status(200).json(data);
}`;
    expect(rules('pages/api/posts.js', src)).toContain('R1');
  });

  it('D: governance/summary — companyId from the query, no auth → R1', () => {
    const src = `import { getGovernanceSummary } from '../../../backend/services/governanceSummaryService';
export default async function handler(req, res) { res.status(200).json(await getGovernanceSummary(req.query.companyId)); }`;
    expect(rules('pages/api/governance/summary.ts', src)).toContain('R1');
  });

  it('D: wordpress-plugin/register — company_id from the body, no auth → R1', () => {
    const src = `${DB.replace('../../', '../../../')}
export default async function handler(req, res) {
  await supabase.from('wordpress_plugin_registrations').insert({ company_id: req.body.company_id, website_id: req.body.website_id });
  res.status(201).json({ ok: true });
}`;
    expect(rules('pages/api/wordpress-plugin/register.ts', src)).toContain('R1');
  });

  it('D: publishing/worker/run — fail-open worker secret → R4 (even with its machine-secret entry)', () => {
    const src = `export default async function handler(req, res) {
  const secret = process.env.PUBLISHING_WORKER_SECRET;
  if (secret && req.headers['x-worker-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' });
  res.status(200).json({ ran: true, worker: req.body.worker_id });
}`;
    expect(rules('pages/api/publishing/worker/run.ts', src)).toContain('R4');
  });

  it('D2: threadRuntime/timeline — identity only + companyId/threadId → R2', () => {
    const src = `import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getTimeline } from '../../../backend/services/threadRuntimeService';
export default async function handler(req, res) {
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  res.status(200).json(await getTimeline(req.query.companyId, req.query.threadId));
}`;
    expect(rules('pages/api/threadRuntime/timeline.ts', src)).toContain('R2');
  });

  it('D2: campaigns/save — identity only + campaignId → R2 and R3', () => {
    const src = `import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
${DB.replace('../../', '../../../')}
export default async function handler(req, res) {
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).end();
  await supabase.from('campaigns').update(req.body.patch).eq('id', req.body.campaignId);
  res.status(200).json({ ok: true });
}`;
    expect(rules('pages/api/campaigns/save.ts', src)).toEqual(expect.arrayContaining(['R2', 'R3']));
  });

  it('D2: campaigns/ai/plan-v2 — tenant role on companyId, campaignId never bound → R3', () => {
    const src = `import { getUserCompanyRole } from '../../../../backend/services/rbacService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
${DB.replace('../../', '../../../../')}
export default async function handler(req, res) {
  const { user } = await getSupabaseUserFromRequest(req);
  const { companyId, campaignId } = req.body;
  const role = await getUserCompanyRole(req, companyId);
  if (!role) return res.status(403).end();
  await supabase.from('campaign_plans').upsert({ campaign_id: campaignId, plan: req.body.plan });
  res.status(200).json({ ok: true, user: user && user.id });
}`;
    expect(rules('pages/api/campaigns/ai/plan-v2.ts', src)).toContain('R3');
  });

  it('F: analytics/post/[postId] — dynamic id, no auth → R1', () => {
    const src = `import { getPostAnalytics } from '../../../../backend/services/analyticsService';
export default async function handler(req, res) { res.status(200).json(await getPostAnalytics(req.query.postId)); }`;
    expect(rules('pages/api/analytics/post/[postId].ts', src)).toContain('R1');
  });

  it('F: campaigns/metrics — campaign-keyed write, authenticates only on GET → R1-METHOD (3AH-91)', () => {
    const src = `import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
${DB.replace('../../', '../../../')}
async function handler(req, res) {
  if (req.method === 'GET') {
    const access = await requireCampaignAccess(req, res, req.query.campaignId);
    if (!access) return;
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'POST') {
    await supabase.from('campaign_metrics').insert({ campaign_id: req.body.campaignId, ...req.body.metrics });
    return res.status(201).json({ ok: true });
  }
  return res.status(405).end();
}
export default createApiRoute(handler, { route: '/api/campaigns/metrics' });`;
    expect(rules('pages/api/campaigns/metrics.ts', src)).toContain('R1-METHOD');
  });
});
