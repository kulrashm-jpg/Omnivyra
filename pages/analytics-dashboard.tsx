/**
 * Analytics Dashboard Page
 * 
 * Comprehensive analytics dashboard showing:
 * - Overall campaign performance
 * - Post-level analytics
 * - Platform performance comparison
 * - Engagement metrics
 * - Hashtag performance
 * - Best performing content
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Calendar,
  Filter,
  Download,
  RefreshCw,
} from 'lucide-react';

interface PostAnalytics {
  post_id: string;
  platform: string;
  content_preview: string;
  likes: number;
  comments: number;
  shares: number;
  views?: number;
  clicks?: number;
  engagement_rate: number;
  created_at: string;
}

interface PlatformMetrics {
  platform: string;
  total_posts: number;
  total_engagement: number;
  avg_engagement_rate: number;
  total_reach?: number;
  total_impressions?: number;
}

interface CampaignSummary {
  total_posts: number;
  total_engagement: number;
  total_reach?: number;
  total_impressions?: number;
  avg_engagement_rate: number;
  top_performing_platform: string;
}

export default function AnalyticsDashboard() {
  const router = useRouter();
  const { campaignId, id } = router.query;
  const campaignIdParam = campaignId || id; // Support both query param formats

  const [campaignSummary, setCampaignSummary] = useState<CampaignSummary | null>(null);
  const [platformMetrics, setPlatformMetrics] = useState<PlatformMetrics[]>([]);
  const [postAnalytics, setPostAnalytics] = useState<PostAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  useEffect(() => {
    if (campaignIdParam) {
      loadAnalytics();
    }
  }, [campaignIdParam, dateRange, selectedPlatform]);

  const loadAnalytics = async () => {
    if (!campaignIdParam) return;

    setLoading(true);
    try {
      // Load platform metrics
      if (selectedPlatform === 'all') {
        const platforms = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube'];
        const metricsPromises = platforms.map(async (platform) => {
          try {
            const response = await fetch(`/api/analytics/platform/${platform}?campaign_id=${campaignIdParam}`);
            if (response.ok) {
              const data = await response.json();
              return data.data;
            }
          } catch (error) {
            console.error(`Failed to load ${platform} metrics:`, error);
          }
          return null;
        });

        const metrics = await Promise.all(metricsPromises);
        setPlatformMetrics(metrics.filter((m) => m !== null));
      } else {
        const response = await fetch(`/api/analytics/platform/${selectedPlatform}?campaign_id=${campaignIdParam}`);
        if (response.ok) {
          const data = await response.json();
          setPlatformMetrics([data.data].filter((m) => m !== null));
        }
      }

      // Load campaign summary (aggregate from posts)
      // TODO: Create campaign summary API endpoint
      const postsResponse = await fetch(`/api/campaigns/${campaignIdParam}/posts`);
      if (postsResponse.ok) {
        const postsData = await postsResponse.json();
        const posts = postsData.posts || [];

        // Load analytics for each post
        const analyticsPromises = posts.map(async (post: any) => {
          try {
            const analyticsResponse = await fetch(`/api/analytics/post/${post.id}`);
            if (analyticsResponse.ok) {
              const analyticsData = await analyticsResponse.json();
              return {
                post_id: post.id,
                platform: post.platform,
                content_preview: post.content?.substring(0, 50) || '',
                ...analyticsData.data,
              };
            }
          } catch (error) {
            console.error(`Failed to load analytics for post ${post.id}:`, error);
          }
          return null;
        });

        const analytics = await Promise.all(analyticsPromises);
        setPostAnalytics(analytics.filter((a) => a !== null));

        // Calculate summary
        const totalEngagement = analytics.reduce((sum, a) => sum + (a?.likes || 0) + (a?.comments || 0) + (a?.shares || 0), 0);
        const avgRate = analytics.length > 0
          ? analytics.reduce((sum, a) => sum + (a?.engagement_rate || 0), 0) / analytics.length
          : 0;

        setCampaignSummary({
          total_posts: posts.length,
          total_engagement: totalEngagement,
          avg_engagement_rate: avgRate,
          top_performing_platform: 'linkedin', // TODO: Calculate from data
        });
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateFilter = () => {
    const now = new Date();
    switch (dateRange) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  };

  if (!campaignIdParam) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-500">Please select a campaign to view analytics</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Analytics Dashboard</h1>
              <p className="text-gray-600">Campaign performance metrics and insights</p>
            </div>
            <div className="flex items-center space-x-3">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as any)}
                className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
              </select>
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Platforms</option>
                <option value="linkedin">LinkedIn</option>
                <option value="twitter">Twitter/X</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube</option>
              </select>
              <button
                onClick={loadAnalytics}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-gray-500">Loading analytics...</div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            {campaignSummary && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Total Posts</span>
                    <Calendar className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="text-3xl font-bold text-gray-900">{campaignSummary.total_posts}</div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Total Engagement</span>
                    <Users className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="text-3xl font-bold text-gray-900">
                    {campaignSummary.total_engagement.toLocaleString()}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Avg Engagement Rate</span>
                    <TrendingUp className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="text-3xl font-bold text-gray-900">
                    {campaignSummary.avg_engagement_rate.toFixed(1)}%
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Top Platform</span>
                    <BarChart3 className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="text-3xl font-bold text-gray-900 capitalize">
                    {campaignSummary.top_performing_platform}
                  </div>
                </div>
              </div>
            )}

            {/* Platform Performance */}
            {platformMetrics.length > 0 && (
              <div className="bg-white rounded-lg shadow mb-8 p-6">
                <h2 className="text-xl font-bold mb-4">Platform Performance</h2>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {platformMetrics.map((metric) => (
                    <div key={metric.platform} className="border rounded-lg p-4">
                      <div className="font-medium capitalize mb-2">{metric.platform}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Posts:</span>
                          <span className="font-medium">{metric.total_posts}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Engagement:</span>
                          <span className="font-medium">{metric.total_engagement.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Avg Rate:</span>
                          <span className="font-medium">{metric.avg_engagement_rate.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Performing Posts */}
            {postAnalytics.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Top Performing Posts</h2>
                  <button className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1">
                    <Download className="w-4 h-4" />
                    <span>Export</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Platform</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Content</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Likes</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Comments</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Shares</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Engagement</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-700">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postAnalytics
                        .sort((a, b) => {
                          const aTotal = a.likes + a.comments + a.shares;
                          const bTotal = b.likes + b.comments + b.shares;
                          return bTotal - aTotal;
                        })
                        .slice(0, 10)
                        .map((post) => (
                          <tr key={post.post_id} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4">
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm capitalize">
                                {post.platform}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-600 max-w-xs truncate">
                              {post.content_preview}...
                            </td>
                            <td className="py-3 px-4 text-right">{post.likes.toLocaleString()}</td>
                            <td className="py-3 px-4 text-right">{post.comments.toLocaleString()}</td>
                            <td className="py-3 px-4 text-right">{post.shares.toLocaleString()}</td>
                            <td className="py-3 px-4 text-right font-medium">
                              {(post.likes + post.comments + post.shares).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className={`px-2 py-1 rounded text-sm ${
                                post.engagement_rate > 5
                                  ? 'bg-green-100 text-green-800'
                                  : post.engagement_rate > 2
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {post.engagement_rate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

