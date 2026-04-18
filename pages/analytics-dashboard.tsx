/**
 * Analytics Dashboard Page
 *
 * Cross-platform analytics using:
 *   GET /api/analytics/summary  — aggregate engagement + growth summary
 *   GET /api/analytics/posts    — per-post analytics
 *   GET /api/analytics/growth   — follower/impression growth over time
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  BarChart3,
  TrendingUp,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Calendar,
  Download,
  RefreshCw,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface PostAnalyticsRow {
  scheduled_post_id: string;
  platform: string;
  content_preview?: string;
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  engagement_rate: number;
  analytics_date: string;
}

interface PlatformSummary {
  impressions: number;
  reach: number;
  engagement: number;
  likes: number;
  comments: number;
  shares: number;
  follower_count: number;
}

interface SummaryData {
  total_impressions: number;
  total_reach: number;
  total_engagement: number;
  platform_breakdown: Record<string, PlatformSummary>;
}

interface GrowthRow {
  captured_date: string;
  platform: string;
  follower_count: number;
  impressions: number;
  reach: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  linkedin:  'bg-blue-100 text-blue-800',
  twitter:   'bg-sky-100 text-sky-800',
  instagram: 'bg-pink-100 text-pink-800',
  facebook:  'bg-indigo-100 text-indigo-800',
  youtube:   'bg-red-100 text-red-800',
  tiktok:    'bg-slate-100 text-slate-800',
  threads:   'bg-gray-100 text-gray-800',
  pinterest: 'bg-rose-100 text-rose-800',
};

function platformBadge(platform: string) {
  return PLATFORM_COLORS[platform] ?? 'bg-gray-100 text-gray-700';
}

function dateFrom(range: '7d' | '30d' | '90d' | 'all'): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  // Support legacy ?campaignId= links, but primary key is company_id from context
  const legacyCampaignId = (router.query.campaignId || router.query.id) as string | undefined;

  const companyId = selectedCompanyId || '';

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [posts, setPosts] = useState<PostAnalyticsRow[]>([]);
  const [growth, setGrowth] = useState<GrowthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  const loadAnalytics = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    const from = dateFrom(dateRange);
    const to = new Date().toISOString().slice(0, 10);

    try {
      const summaryParams = new URLSearchParams({ company_id: companyId });
      if (from) summaryParams.set('date_from', from);
      summaryParams.set('date_to', to);

      const postsParams = new URLSearchParams({ company_id: companyId, per_page: '50' });
      if (from) postsParams.set('date_from', from);
      postsParams.set('date_to', to);
      if (selectedPlatform !== 'all') postsParams.set('platform', selectedPlatform);

      const growthParams = new URLSearchParams({ company_id: companyId });
      if (from) growthParams.set('date_from', from);
      growthParams.set('date_to', to);
      if (selectedPlatform !== 'all') growthParams.set('platform', selectedPlatform);

      const [summaryRes, postsRes, growthRes] = await Promise.all([
        fetch(`/api/analytics/summary?${summaryParams}`, { credentials: 'include' }),
        fetch(`/api/analytics/posts?${postsParams}`, { credentials: 'include' }),
        fetch(`/api/analytics/growth?${growthParams}`, { credentials: 'include' }),
      ]);

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data);
      }

      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts ?? []);
      }

      if (growthRes.ok) {
        const data = await growthRes.json();
        setGrowth(data.snapshots ?? data.growth ?? []);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, dateRange, selectedPlatform]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const platformBreakdown = summary?.platform_breakdown
    ? Object.entries(summary.platform_breakdown)
        .filter(([p]) => selectedPlatform === 'all' || p === selectedPlatform)
    : [];

  const topPlatform = platformBreakdown.length > 0
    ? platformBreakdown.reduce(
        (best, [p, s]) => s.engagement > (best[1] as PlatformSummary).engagement ? [p, s] : best,
        platformBreakdown[0]
      )[0]
    : '—';

  const filteredPosts = selectedPlatform === 'all'
    ? posts
    : posts.filter((p) => p.platform === selectedPlatform);

  // Aggregate growth by platform: latest follower count per platform
  const latestFollowers = growth.reduce<Record<string, number | string>>((acc, row) => {
    if (!acc[row.platform] || row.captured_date > (acc[`${row.platform}_date`] ?? '')) {
      acc[row.platform] = row.follower_count;
      acc[`${row.platform}_date`] = row.captured_date;
    }
    return acc;
  }, {});

  if (!companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-500">Select a company to view analytics</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-500 text-sm mt-0.5">Cross-platform performance metrics</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Platforms</option>
              <option value="linkedin">LinkedIn</option>
              <option value="twitter">Twitter/X</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
              <option value="threads">Threads</option>
              <option value="pinterest">Pinterest</option>
            </select>
            <button
              onClick={loadAnalytics}
              disabled={loading}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {loading && !summary ? (
          <div className="text-center py-16 text-gray-500">Loading analytics...</div>
        ) : (
          <>
            {/* Cross-platform Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">Total Impressions</span>
                    <Eye className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {summary.total_impressions.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">Total Reach</span>
                    <Users className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {summary.total_reach.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">Total Engagement</span>
                    <Heart className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {summary.total_engagement.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">Top Platform</span>
                    <BarChart3 className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900 capitalize">{topPlatform}</div>
                </div>
              </div>
            )}

            {/* Platform Breakdown Charts */}
            {platformBreakdown.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border mb-6 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Platform Breakdown</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {platformBreakdown.map(([platform, s]) => {
                    const followers = Number(latestFollowers[platform] ?? 0);
                    const maxEngagement = Math.max(...platformBreakdown.map(([, x]) => x.engagement), 1);
                    const pct = Math.round((s.engagement / maxEngagement) * 100);
                    return (
                      <div key={platform} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${platformBadge(platform)}`}>
                            {platform}
                          </span>
                          {followers > 0 && (
                            <span className="text-xs text-gray-500">{followers.toLocaleString()} followers</span>
                          )}
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500 flex items-center gap-1"><Eye className="w-3 h-3" /> Impressions</span>
                            <span className="font-medium">{s.impressions.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500 flex items-center gap-1"><Users className="w-3 h-3" /> Reach</span>
                            <span className="font-medium">{s.reach.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500 flex items-center gap-1"><Heart className="w-3 h-3" /> Likes</span>
                            <span className="font-medium">{s.likes.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Comments</span>
                            <span className="font-medium">{s.comments.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500 flex items-center gap-1"><Share2 className="w-3 h-3" /> Shares</span>
                            <span className="font-medium">{s.shares.toLocaleString()}</span>
                          </div>
                        </div>
                        {/* Engagement bar */}
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>Engagement</span>
                            <span>{s.engagement.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top Performing Posts */}
            {filteredPosts.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Top Performing Posts</h2>
                  <button className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 px-3 font-medium text-gray-600">Platform</th>
                        <th className="py-2 px-3 font-medium text-gray-600">Date</th>
                        <th className="py-2 px-3 font-medium text-gray-600 text-right">Impressions</th>
                        <th className="py-2 px-3 font-medium text-gray-600 text-right">Likes</th>
                        <th className="py-2 px-3 font-medium text-gray-600 text-right">Comments</th>
                        <th className="py-2 px-3 font-medium text-gray-600 text-right">Shares</th>
                        <th className="py-2 px-3 font-medium text-gray-600 text-right">Eng. Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPosts
                        .sort((a, b) => (b.likes + b.comments + b.shares) - (a.likes + a.comments + a.shares))
                        .slice(0, 20)
                        .map((post, idx) => (
                          <tr key={post.scheduled_post_id ?? idx} className="border-b hover:bg-gray-50">
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${platformBadge(post.platform)}`}>
                                {post.platform}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-gray-500 text-xs">
                              {post.analytics_date
                                ? new Date(post.analytics_date).toLocaleDateString()
                                : '—'}
                            </td>
                            <td className="py-2 px-3 text-right">{(post.impressions ?? 0).toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">{post.likes.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">{post.comments.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">{post.shares.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                post.engagement_rate > 5
                                  ? 'bg-green-100 text-green-800'
                                  : post.engagement_rate > 2
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {(post.engagement_rate ?? 0).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!summary && !loading && (
              <div className="text-center py-16 text-gray-400">
                No analytics data found for the selected period.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
