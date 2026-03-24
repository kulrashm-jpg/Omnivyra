/**
 * GET /api/admin/consumption/activity-breakdown
 *
 * Returns cost and activity distribution broken down by:
 *  - system_costs   : platform-level LLM/API usage (organization_id IS NULL)
 *  - by_feature_area: cost per product feature (Campaign Builder, Daily Plan, …)
 *  - by_process_type: cost per internal process
 *  - by_platform    : scheduled-post counts per social platform
 *  - by_platform_content: counts per platform × content_type
 *
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  } catch { /* deny */ }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  const now = new Date();
  const year  = req.query.year  ? parseInt(req.query.year  as string, 10) : now.getUTCFullYear();
  const month = req.query.month ? parseInt(req.query.month as string, 10) : now.getUTCMonth() + 1;

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate   = new Date(Date.UTC(year, month,     1)).toISOString();

  // ── 1. System-level costs (no org) ──────────────────────────────────────────
  const { data: sysEvents } = await supabase
    .from('usage_events')
    .select('source_type, total_tokens, total_cost')
    .is('organization_id', null)
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  let sysLlmCalls = 0, sysLlmTokens = 0, sysLlmCost = 0;
  let sysApiCalls = 0, sysApiCost = 0;
  for (const r of (sysEvents ?? []) as Array<{ source_type: string; total_tokens: number | null; total_cost: number | null }>) {
    if (r.source_type === 'llm') {
      sysLlmCalls++; sysLlmTokens += r.total_tokens ?? 0; sysLlmCost += r.total_cost ?? 0;
    } else if (r.source_type === 'external_api') {
      sysApiCalls++; sysApiCost += r.total_cost ?? 0;
    }
  }

  // ── 2. Feature-area cost breakdown (org events only) ────────────────────────
  const { data: featureEvents } = await supabase
    .from('usage_events')
    .select('feature_area, total_tokens, total_cost')
    .not('organization_id', 'is', null)
    .eq('source_type', 'llm')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  const featureMap = new Map<string, { call_count: number; total_tokens: number; total_cost_usd: number }>();
  for (const r of (featureEvents ?? []) as Array<{ feature_area: string | null; total_tokens: number | null; total_cost: number | null }>) {
    const fa = r.feature_area ?? 'Other';
    const e  = featureMap.get(fa) ?? { call_count: 0, total_tokens: 0, total_cost_usd: 0 };
    e.call_count++;
    e.total_tokens    += r.total_tokens ?? 0;
    e.total_cost_usd  += r.total_cost   ?? 0;
    featureMap.set(fa, e);
  }
  const by_feature_area = Array.from(featureMap.entries())
    .map(([feature_area, v]) => ({ feature_area, ...v, total_cost_usd: r6(v.total_cost_usd) }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

  // ── 3. Process-type breakdown ────────────────────────────────────────────────
  const { data: processEvents } = await supabase
    .from('usage_events')
    .select('process_type, total_cost')
    .not('organization_id', 'is', null)
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  const processMap = new Map<string, { call_count: number; total_cost_usd: number }>();
  for (const r of (processEvents ?? []) as Array<{ process_type: string | null; total_cost: number | null }>) {
    const pt = r.process_type ?? 'unknown';
    const e  = processMap.get(pt) ?? { call_count: 0, total_cost_usd: 0 };
    e.call_count++;
    e.total_cost_usd += r.total_cost ?? 0;
    processMap.set(pt, e);
  }
  const by_process_type = Array.from(processMap.entries())
    .map(([process_type, v]) => ({ process_type, ...v, total_cost_usd: r6(v.total_cost_usd) }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 20);

  // ── 4. Platform × content_type post distribution ─────────────────────────────
  // Each scheduled post = one unit of "activity" on that platform/content type.
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('platform, content_type, status')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  const pcMap = new Map<string, { platform: string; content_type: string; post_count: number; published_count: number }>();
  for (const p of (posts ?? []) as Array<{ platform: string | null; content_type: string | null; status: string | null }>) {
    const key = `${p.platform ?? 'unknown'}::${p.content_type ?? 'post'}`;
    const e   = pcMap.get(key) ?? { platform: p.platform ?? 'unknown', content_type: p.content_type ?? 'post', post_count: 0, published_count: 0 };
    e.post_count++;
    if (p.status === 'published') e.published_count++;
    pcMap.set(key, e);
  }
  const by_platform_content = Array.from(pcMap.values()).sort((a, b) => b.post_count - a.post_count);

  // Platform roll-up
  const platMap = new Map<string, { platform: string; post_count: number; published_count: number }>();
  for (const p of by_platform_content) {
    const e = platMap.get(p.platform) ?? { platform: p.platform, post_count: 0, published_count: 0 };
    e.post_count      += p.post_count;
    e.published_count += p.published_count;
    platMap.set(p.platform, e);
  }
  const by_platform = Array.from(platMap.values()).sort((a, b) => b.post_count - a.post_count);

  return res.status(200).json({
    period: { year, month },
    system_costs: {
      llm_calls:     sysLlmCalls,
      llm_tokens:    sysLlmTokens,
      llm_cost_usd:  r6(sysLlmCost),
      api_calls:     sysApiCalls,
      api_cost_usd:  r6(sysApiCost),
      total_cost_usd: r6(sysLlmCost + sysApiCost),
    },
    by_feature_area,
    by_process_type,
    by_platform,
    by_platform_content,
  });
}
