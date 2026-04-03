
/**
 * GET /api/track/hook-performance?account_id=xxx&days=90
 *
 * Hook Performance Tracking.
 *
 * Computes hook engagement from existing pageleave analytics:
 *   hook_exit_rate    — % of sessions that left at scroll_depth < 20 (bounced at hook)
 *   hook_pass_rate    — % of sessions that scrolled past scroll_depth ≥ 25 (got past intro)
 *
 * Groups results by AI-assessed hook_strength (strong / moderate / weak) so you can
 * validate whether the AI's hook assessment actually predicts reader behaviour.
 *
 * Response:
 * {
 *   by_strength: [{
 *     hook_strength:   'strong' | 'moderate' | 'weak',
 *     post_count:      number,
 *     avg_hook_pass:   number,   // 0–100 — % that scrolled past intro
 *     avg_hook_exit:   number,   // 0–100 — % that bounced at intro
 *     avg_scroll:      number,   // 0–100 — overall avg scroll depth
 *   }],
 *   top_hooks: [{                // per-blog breakdown, sorted by hook_pass_rate desc
 *     slug:          string,
 *     title:         string,
 *     hook_strength: string | null,
 *     hook_pass_rate: number,
 *     hook_exit_rate: number,
 *     avg_scroll:    number,
 *     session_count: number,
 *   }],
 *   has_data: boolean,
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

const HOOK_EXIT_THRESHOLD = 20;  // scroll_depth < 20  → bounced at hook
const HOOK_PASS_THRESHOLD = 25;  // scroll_depth >= 25 → made it past intro

function slugMatches(urlSlug: string, blogSlug: string): boolean {
  if (!blogSlug) return false;
  const normalized = urlSlug.replace(/\/$/, '');
  return normalized === '/' + blogSlug || normalized.endsWith('/' + blogSlug);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accountId = typeof req.query.account_id === 'string' ? req.query.account_id.trim() : null;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: accountId });
  if (!access) return;

  const days  = Math.min(180, Math.max(7, parseInt(String(req.query.days ?? '90'), 10) || 90));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── Fetch published blogs ──────────────────────────────────────────────────
  const { data: blogs } = await supabase
    .from('blogs')
    .select('slug, title, hook_strength')
    .eq('company_id', accountId)
    .eq('status', 'published')
    .not('slug', 'is', null);

  if (!blogs || blogs.length === 0) {
    return res.status(200).json({ by_strength: [], top_hooks: [], has_data: false });
  }

  // ── Fetch pageleave events ─────────────────────────────────────────────────
  const { data: lvData } = await supabase
    .from('blog_analytics')
    .select('url_slug, scroll_depth')
    .eq('account_id', accountId)
    .eq('event_type', 'pageleave')
    .gte('created_at', since);

  const lv = (lvData ?? []) as Array<{ url_slug: string; scroll_depth: number }>;
  if (lv.length === 0) {
    return res.status(200).json({ by_strength: [], top_hooks: [], has_data: false });
  }

  // Build per-slug session arrays
  const slugSessions = new Map<string, number[]>();
  for (const r of lv) {
    const arr = slugSessions.get(r.url_slug) ?? [];
    arr.push(r.scroll_depth);
    slugSessions.set(r.url_slug, arr);
  }

  // ── Per-blog stats ─────────────────────────────────────────────────────────
  interface BlogStat {
    slug:           string;
    title:          string;
    hook_strength:  string | null;
    hook_pass_rate: number;
    hook_exit_rate: number;
    avg_scroll:     number;
    session_count:  number;
  }

  const blogStats: BlogStat[] = [];

  for (const blog of blogs as Array<{ slug: string; title: string; hook_strength: string | null }>) {
    // Collect all sessions matching this blog's slug
    const sessions: number[] = [];
    for (const [urlSlug, scrolls] of slugSessions) {
      if (slugMatches(urlSlug, blog.slug)) sessions.push(...scrolls);
    }
    if (sessions.length === 0) continue;

    const n             = sessions.length;
    const hookExits     = sessions.filter(s => s < HOOK_EXIT_THRESHOLD).length;
    const hookPasses    = sessions.filter(s => s >= HOOK_PASS_THRESHOLD).length;
    const avgScroll     = Math.round(sessions.reduce((s, v) => s + v, 0) / n);

    blogStats.push({
      slug:           blog.slug,
      title:          blog.title,
      hook_strength:  blog.hook_strength,
      hook_pass_rate: Math.round((hookPasses / n) * 100),
      hook_exit_rate: Math.round((hookExits  / n) * 100),
      avg_scroll:     avgScroll,
      session_count:  n,
    });
  }

  if (blogStats.length === 0) {
    return res.status(200).json({ by_strength: [], top_hooks: [], has_data: false });
  }

  // ── Group by hook_strength ─────────────────────────────────────────────────
  const strengthMap = new Map<string, { passRates: number[]; exitRates: number[]; scrolls: number[]; slugs: Set<string> }>();

  for (const stat of blogStats) {
    const key = stat.hook_strength ?? 'unknown';
    const entry = strengthMap.get(key) ?? { passRates: [], exitRates: [], scrolls: [], slugs: new Set() };
    entry.passRates.push(stat.hook_pass_rate);
    entry.exitRates.push(stat.hook_exit_rate);
    entry.scrolls.push(stat.avg_scroll);
    entry.slugs.add(stat.slug);
    strengthMap.set(key, entry);
  }

  const round = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0;

  const STRENGTH_ORDER = ['strong', 'moderate', 'weak'];
  const by_strength = [...strengthMap.entries()]
    .filter(([k]) => STRENGTH_ORDER.includes(k))
    .map(([hook_strength, entry]) => ({
      hook_strength:  hook_strength as 'strong' | 'moderate' | 'weak',
      post_count:     entry.slugs.size,
      avg_hook_pass:  round(entry.passRates),
      avg_hook_exit:  round(entry.exitRates),
      avg_scroll:     round(entry.scrolls),
    }))
    .sort((a, b) => STRENGTH_ORDER.indexOf(a.hook_strength) - STRENGTH_ORDER.indexOf(b.hook_strength));

  // ── Top hooks sorted by pass rate ──────────────────────────────────────────
  const top_hooks = [...blogStats]
    .sort((a, b) => b.hook_pass_rate - a.hook_pass_rate)
    .slice(0, 10);

  return res.status(200).json({ by_strength, top_hooks, has_data: true });
}
