import { useEffect, useRef, useState } from 'react';
import { useCompanyContext } from '@/components/CompanyContext';
import StepTracker, { type StepDef } from '@/components/progress/StepTracker';

const ANALYTICS_LOAD_STAGES: StepDef[] = [
  { key: 'performance', label: 'Loading performance metrics', etaSeconds: 3 },
  { key: 'engagement',  label: 'Reading engagement signals',  etaSeconds: 3 },
  { key: 'benchmark',   label: 'Computing benchmarks',         etaSeconds: 2 },
  { key: 'render',      label: 'Rendering dashboard',          etaSeconds: 2 },
];

type DashboardResponse =
  | {
      status: 'no_data' | 'low_data' | 'partial';
      message: string;
    }
  | {
      status: 'ready';
      generated_at: string;
      mapped_data: {
        content: {
          top_converting_pages: Array<{
            page_url: string;
            conversions: number;
            visits: number;
            conversion_rate: number;
          }>;
        };
      };
      source_data: {
        traffic_sources: Array<{
          traffic_source: string;
          source_medium: string;
          sessions: number;
          events: number;
          conversions: number;
        }>;
        session_metrics: {
          total_sessions: number;
          avg_events_per_session: number;
          conversion_rate: number;
        };
        drop_off_pages: Array<{
          page_url: string;
          entry_sessions: number;
          exit_sessions: number;
          drop_off_rate: number;
        }>;
        funnel: {
          steps: Array<{
            step: string;
            users: number;
            drop_pct: number;
          }>;
        };
        conversions: {
          total_conversions: number;
        };
      };
    };

type EngagementSignalsResponse =
  | {
      label: 'Social Engagement (Not Traffic Data)';
      confidence: 'high' | 'low_confidence';
      warnings: string[];
      insights: Array<{
        type: string;
        severity: string;
        message: string;
        impact: number;
        confidence: string;
      }>;
      top_performing_posts: Array<{
        content_id: string;
        campaign_id: string | null;
        platform: string;
        title: string;
        timestamp: string;
        engagement_total: number;
        impressions: number;
        clicks: number;
      }>;
      engagement_trends: Array<{
        date: string;
        total_engagement: number;
        impressions: number;
        clicks: number;
      }>;
      platform_comparison: Array<{
        platform: string;
        engagement_total: number;
        impressions: number;
        clicks: number;
        posts: number;
      }>;
    }
  | { error: string };

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function AnalyticsDashboard() {
  const { selectedCompanyId } = useCompanyContext();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [engagementSignals, setEngagementSignals] = useState<EngagementSignalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const loadStartedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!selectedCompanyId) {
      setData(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      loadStartedAtRef.current = Date.now();
      try {
        const params = new URLSearchParams({ company_id: selectedCompanyId });
        const [response, engagementResponse] = await Promise.all([
          fetch(`/api/reports/performance?${params.toString()}`, {
            credentials: 'include',
          }),
          fetch(`/api/engagement/signals?company_id=${encodeURIComponent(selectedCompanyId)}`, {
            credentials: 'include',
          }),
        ]);
        const [payload, engagementPayload] = await Promise.all([
          response.json(),
          engagementResponse.json(),
        ]);
        if (!cancelled) {
          setData(payload as DashboardResponse);
          setEngagementSignals(engagementPayload as EngagementSignalsResponse);
        }
      } catch (error) {
        console.error('[analytics-dashboard] failed to load report 2:', error);
        if (!cancelled) {
          setData({
            status: 'no_data',
            message: 'No analytics data available',
          });
          setEngagementSignals(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg text-gray-500">Select a company to view analytics</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <StepTracker
            stages={ANALYTICS_LOAD_STAGES}
            startedAt={loadStartedAtRef.current || Date.now()}
            accent="indigo"
            title="Loading analytics dashboard"
            variant="card"
          />
        </div>
      </div>
    );
  }

  if (!data || data.status !== 'ready') {
    const message = data && data.status !== 'ready' ? data.message : 'No analytics data available';
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="mt-3 text-sm text-gray-600">{message}</p>
        </div>
      </div>
    );
  }

  const report = data;
  const socialSignals = engagementSignals && !('error' in engagementSignals) ? engagementSignals : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="mt-2 text-sm text-gray-500">
            Synced directly from Report 2. Generated at {new Date(report.generated_at).toLocaleString()}.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Conversion Rate</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {formatPercent(report.source_data.session_metrics.conversion_rate)}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Conversions</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {report.source_data.conversions.total_conversions.toLocaleString()}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Sessions</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {report.source_data.session_metrics.total_sessions.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Top Pages By Conversions</h2>
            <div className="mt-4 space-y-3">
              {report.mapped_data.content.top_converting_pages.length > 0 ? report.mapped_data.content.top_converting_pages.map((page) => (
                <div key={page.page_url} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-sm font-medium text-gray-900 break-all">{page.page_url}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {page.conversions.toLocaleString()} conversions · {page.visits.toLocaleString()} visits · {formatPercent(page.conversion_rate)}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-gray-500">No top pages available.</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Funnel</h2>
            <div className="mt-4 space-y-3">
              {report.source_data.funnel.steps.length > 0 ? report.source_data.funnel.steps.map((step) => (
                <div key={step.step} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-sm font-medium text-gray-900">{step.step}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {step.users.toLocaleString()} users · drop {formatPercent(step.drop_pct)}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-gray-500">No funnel data available.</div>
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Drop-Off Pages</h2>
            <div className="mt-4 space-y-3">
              {report.source_data.drop_off_pages.length > 0 ? report.source_data.drop_off_pages.map((page) => (
                <div key={page.page_url} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-sm font-medium text-gray-900 break-all">{page.page_url}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {page.exit_sessions.toLocaleString()} exits of {page.entry_sessions.toLocaleString()} entries · drop {formatPercent(page.drop_off_rate)}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-gray-500">No drop-off pages available.</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Traffic Sources</h2>
            <div className="mt-4 space-y-3">
              {report.source_data.traffic_sources.length > 0 ? report.source_data.traffic_sources.map((source) => (
                <div key={`${source.traffic_source}:${source.source_medium}`} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-sm font-medium text-gray-900">
                    {source.source_medium !== 'unknown' ? `${source.traffic_source} / ${source.source_medium}` : source.traffic_source}
                  </div>
                  <div className="mt-2 text-sm text-gray-600">
                    {source.sessions.toLocaleString()} sessions · {source.events.toLocaleString()} events · {source.conversions.toLocaleString()} conversions
                  </div>
                </div>
              )) : (
                <div className="text-sm text-gray-500">No traffic sources available.</div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Engagement Signals</p>
            <h2 className="text-lg font-semibold text-gray-900">Social Engagement (Not Traffic Data)</h2>
            <p className="text-sm text-gray-500">
              Social engagement is shown separately from canonical traffic and conversion analytics.
            </p>
          </div>

          {socialSignals?.confidence === 'low_confidence' ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Social engagement data is marked low confidence and should not be used for decisions.
            </div>
          ) : null}

          {socialSignals?.warnings?.length ? (
            <div className="mt-4 space-y-2">
              {socialSignals.warnings.map((warning) => (
                <div key={warning} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Top Performing Posts</h3>
              <div className="mt-3 space-y-3">
                {socialSignals?.top_performing_posts?.length ? socialSignals.top_performing_posts.map((post) => (
                  <div key={post.content_id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-900">{post.title}</div>
                    <div className="mt-2 text-xs uppercase tracking-wide text-gray-500">{post.platform}</div>
                    <div className="mt-2 text-sm text-gray-600">
                      {post.engagement_total.toLocaleString()} engagements · {post.impressions.toLocaleString()} impressions · {post.clicks.toLocaleString()} clicks
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-gray-500">No social engagement posts available.</div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Engagement Trends</h3>
              <div className="mt-3 space-y-3">
                {socialSignals?.engagement_trends?.length ? socialSignals.engagement_trends.slice(-5).map((point) => (
                  <div key={point.date} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-900">{point.date}</div>
                    <div className="mt-2 text-sm text-gray-600">
                      {point.total_engagement.toLocaleString()} engagements · {point.impressions.toLocaleString()} impressions · {point.clicks.toLocaleString()} clicks
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-gray-500">No engagement trends available.</div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Platform Comparison</h3>
              <div className="mt-3 space-y-3">
                {socialSignals?.platform_comparison?.length ? socialSignals.platform_comparison.map((platform) => (
                  <div key={platform.platform} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-sm font-medium capitalize text-gray-900">{platform.platform}</div>
                    <div className="mt-2 text-sm text-gray-600">
                      {platform.engagement_total.toLocaleString()} engagements · {platform.impressions.toLocaleString()} impressions · {platform.posts.toLocaleString()} posts
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-gray-500">No platform comparison available.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
