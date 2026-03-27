import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  AccountContext,
  PlatformMetrics,
  calculateMaturityStage,
  calculateOverallScore,
  generateRecommendations
} from '../../../backend/types/accountContext';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const cache = new Map<string, { value: AccountContext; fetchedAt: number }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { companyId, refresh } = req.query;

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // Verify the requesting user belongs to this company
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .eq('status', 'active')
      .maybeSingle();
    if (!roleRow) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = Date.now();
    const cached = cache.get(companyId);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS && refresh !== '1') {
      return res.status(200).json(cached.value);
    }

    const accountContext = await analyzeAccountContext(companyId);
    cache.set(companyId, { value: accountContext, fetchedAt: now });

    return res.status(200).json(accountContext);
  } catch (error) {
    console.error('Account context analysis error:', error);
    return res.status(500).json({ error: 'Failed to analyze account context' });
  }
}

async function analyzeAccountContext(companyId: string): Promise<AccountContext> {
  // Fetch active connected social accounts for this company
  const { data: socialAccounts, error: saError } = await supabase
    .from('social_accounts')
    .select('platform, follower_count')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (saError) {
    console.error('social_accounts query error:', saError);
  }

  const accounts = socialAccounts ?? [];

  if (accounts.length === 0) {
    const empty: AccountContext = {
      companyId,
      platforms: [],
      maturityStage: 'NEW',
      overallScore: 0,
      recommendations: ['Connect social accounts to see platform insights'],
      lastUpdated: new Date(),
    };
    return empty;
  }

  // Fetch latest metrics snapshot per platform for engagement data
  const platformNames = accounts.map((a: { platform: string }) => a.platform);
  const { data: snapshots, error: snapError } = await supabase
    .from('platform_metrics_snapshots')
    .select('platform, followers, engagement_rate, recorded_at')
    .eq('company_id', companyId)
    .in('platform', platformNames)
    .order('recorded_at', { ascending: false });

  if (snapError) {
    console.error('platform_metrics_snapshots query error:', snapError);
  }

  // Keep only the latest snapshot per platform
  const latestSnap: Record<string, { followers: number; engagement_rate: number }> = {};
  for (const snap of (snapshots ?? [])) {
    const s = snap as { platform: string; followers: number; engagement_rate: number; recorded_at: string };
    if (!latestSnap[s.platform]) {
      latestSnap[s.platform] = { followers: s.followers ?? 0, engagement_rate: s.engagement_rate ?? 0 };
    }
  }

  const platforms: PlatformMetrics[] = accounts.map((acct: { platform: string; follower_count: number }) => {
    const snap = latestSnap[acct.platform];
    // Prefer snapshot followers if available and non-zero; fall back to social_accounts.follower_count
    const followers = (snap?.followers ?? 0) > 0 ? snap.followers : (acct.follower_count ?? 0);
    const engagementRate = snap?.engagement_rate ?? 0;
    return {
      platform: acct.platform,
      followers,
      avgReach: Math.round(followers * 0.4),
      engagementRate: Number((engagementRate * 100).toFixed(2)), // stored as 0.02 → 2.0%
      postingFrequency: 0,   // not stored; default 0
      last30DaysPosts: 0,    // not stored; default 0
    };
  });

  const maturityStage = calculateMaturityStage(platforms);
  const overallScore = calculateOverallScore(platforms, maturityStage);
  const recommendations = generateRecommendations(platforms, maturityStage);

  return {
    companyId,
    platforms,
    maturityStage,
    overallScore,
    recommendations,
    lastUpdated: new Date(),
  };
}
