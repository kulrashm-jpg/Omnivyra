import React, { useCallback, useEffect, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import Header from '../../components/Header';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

export interface CommunityHealthSummary {
  scope: 'company' | 'campaign';
  range_days: number;
  total_comments: number;
  total_replies: number;
  response_rate: number;
  avg_response_time_minutes: number | null;
  ai_actions_created: number;
  ai_actions_approved: number;
  ai_actions_rejected: number;
  pending_actions: number;
  flagged_comments: number;
  unresolved_flags: number;
  sentiment: { positive: number; neutral: number; negative: number };
  alerts: string[];
}

type Scope = 'company' | 'campaign';
type Range = 7 | 30 | 90;
type Mode = 'creator' | 'enterprise';

type CampaignOption = { id: string; name: string };

export default function CommunityHealthPage() {
  const { selectedCompanyId } = useCompanyContext();
  const [scope, setScope] = useState<Scope>('company');
  const [campaignId, setCampaignId] = useState<string>('');
  const [range, setRange] = useState<Range>(7);
  const [mode, setMode] = useState<Mode>('creator');
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [summary, setSummary] = useState<CommunityHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    if (!selectedCompanyId) {
      setCampaigns([]);
      return;
    }
    try {
      const res = await fetchWithAuth(
        `/api/campaigns?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const list = (data?.campaigns ?? []).map((c: { id: string; name: string }) => ({
        id: c.id,
        name: c.name || `Campaign ${c.id.slice(0, 8)}`,
      }));
      setCampaigns(list);
    } catch {
      setCampaigns([]);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (scope === 'campaign') fetchCampaigns();
    else setCampaigns([]);
  }, [scope, fetchCampaigns]);

  const fetchHealth = useCallback(async () => {
    if (scope === 'campaign' && !campaignId) {
      setSummary(null);
      setError(null);
      return;
    }
    if (scope === 'company' && !selectedCompanyId) {
      setSummary(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('scope', scope);
      params.set('range', String(range));
      if (scope === 'company') {
        params.set('tenant_id', selectedCompanyId || '');
        params.set('organization_id', selectedCompanyId || '');
      } else {
        params.set('campaignId', campaignId);
      }
      const res = await fetchWithAuth(`/api/community/health?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load community health');
      }
      const data = await res.json();
      setSummary(data);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [scope, campaignId, range, selectedCompanyId]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const hasNoData =
    !loading &&
    !error &&
    summary &&
    summary.total_comments === 0 &&
    summary.ai_actions_created === 0 &&
    summary.flagged_comments === 0;

  return (
    <>
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">
          Community Health Dashboard
        </h1>

        {/* Top controls */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          {/* Scope */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Scope:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="scope"
                checked={scope === 'company'}
                onChange={() => setScope('company')}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Company</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="scope"
                checked={scope === 'campaign'}
                onChange={() => setScope('campaign')}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Campaign</span>
            </label>
          </div>

          {scope === 'campaign' && (
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
            >
              <option value="">Select campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Time range */}
          <div className="flex items-center gap-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={`px-3 py-1.5 text-sm rounded border ${
                  range === d
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Mode */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode('creator')}
              className={`px-3 py-1.5 text-sm rounded border ${
                mode === 'creator'
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Creator
            </button>
            <button
              type="button"
              onClick={() => setMode('enterprise')}
              className={`px-3 py-1.5 text-sm rounded border ${
                mode === 'enterprise'
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Enterprise
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-sm text-gray-500 py-4">Loading…</div>
        )}

        {hasNoData && (
          <div className="p-6 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-sm">
            No community activity in selected period.
          </div>
        )}

        {!loading && !error && summary && !hasNoData && (
          <div className="space-y-6">
            {/* 1. Response Activity */}
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-gray-900 mb-3">Response Activity</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Total comments</p>
                  <p className="font-medium text-gray-900">{summary.total_comments}</p>
                </div>
                <div>
                  <p className="text-gray-500">Response rate</p>
                  <p className="font-medium text-gray-900">{summary.response_rate}%</p>
                </div>
                <div>
                  <p className="text-gray-500">Avg response time</p>
                  <p className="font-medium text-gray-900">
                    {summary.avg_response_time_minutes != null
                      ? `${summary.avg_response_time_minutes} min`
                      : '—'}
                  </p>
                </div>
              </div>
            </section>

            {/* 2. AI Support */}
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-gray-900 mb-3">AI Support</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">AI actions created</p>
                  <p className="font-medium text-gray-900">{summary.ai_actions_created}</p>
                </div>
                <div>
                  <p className="text-gray-500">Pending actions</p>
                  <p className="font-medium text-gray-900">{summary.pending_actions}</p>
                </div>
              </div>
            </section>

            {/* 3. Sentiment Summary */}
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-gray-900 mb-3">Sentiment Summary</h2>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Positive</p>
                  <p className="font-medium text-green-700">{summary.sentiment.positive}%</p>
                </div>
                <div>
                  <p className="text-gray-500">Neutral</p>
                  <p className="font-medium text-gray-700">{summary.sentiment.neutral}%</p>
                </div>
                <div>
                  <p className="text-gray-500">Negative</p>
                  <p className="font-medium text-red-700">{summary.sentiment.negative}%</p>
                </div>
              </div>
            </section>

            {/* 4. Alerts */}
            {summary.alerts.length > 0 && (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <h2 className="text-sm font-medium text-amber-900 mb-2">Alerts</h2>
                <ul className="list-disc list-inside text-sm text-amber-800 space-y-1">
                  {summary.alerts.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Enterprise-only: 5. Moderation Health */}
            {mode === 'enterprise' && (
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-medium text-gray-900 mb-3">Moderation Health</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Flagged comments</p>
                    <p className="font-medium text-gray-900">{summary.flagged_comments}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Unresolved flags</p>
                    <p className="font-medium text-gray-900">{summary.unresolved_flags}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Enterprise-only: 6. AI Decision Breakdown */}
            {mode === 'enterprise' && summary.ai_actions_created > 0 && (
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-medium text-gray-900 mb-3">AI Decision Breakdown</h2>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Approved</p>
                    <p className="font-medium text-green-700">
                      {Math.round((summary.ai_actions_approved / summary.ai_actions_created) * 100)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Rejected</p>
                    <p className="font-medium text-red-700">
                      {Math.round((summary.ai_actions_rejected / summary.ai_actions_created) * 100)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Pending</p>
                    <p className="font-medium text-gray-700">
                      {Math.round((summary.pending_actions / summary.ai_actions_created) * 100)}%
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* Enterprise-only: 7. SLA Card */}
            {mode === 'enterprise' && (
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-medium text-gray-900 mb-3">SLA</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Avg response time</p>
                    <p className="font-medium text-gray-900">
                      {summary.avg_response_time_minutes != null
                        ? `${summary.avg_response_time_minutes} min`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Response rate</p>
                    <p className="font-medium text-gray-900">{summary.response_rate}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Comments per day</p>
                    <p className="font-medium text-gray-900">
                      {summary.range_days > 0
                        ? (summary.total_comments / summary.range_days).toFixed(1)
                        : '—'}
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
