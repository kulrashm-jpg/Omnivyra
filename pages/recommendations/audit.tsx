import React, { useEffect, useState } from 'react';

type AuditLog = {
  recommendation_id?: string | null;
  campaign_id?: string | null;
  company_id?: string | null;
  input_snapshot_hash?: string | null;
  trend_sources_used?: any;
  platform_strategies_used?: any;
  company_profile_used?: any;
  scores_breakdown?: any;
  final_score?: number | null;
  confidence?: number | null;
  historical_accuracy_factor?: number | null;
  created_at?: string | null;
};

const prettyJson = (value: any) => JSON.stringify(value ?? {}, null, 2);

export const buildPolicySimulationLink = (recommendationId?: string | null, campaignId?: string | null) => {
  if (!recommendationId) return '/recommendations/policy';
  const params = new URLSearchParams();
  params.set('recommendationId', recommendationId);
  if (campaignId) params.set('campaignId', campaignId);
  return `/recommendations/policy?${params.toString()}`;
};

export default function RecommendationAuditPage() {
  const [recommendationId, setRecommendationId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditLog | null>(null);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

  const fetchAudit = async () => {
    if (!recommendationId) {
      setErrorMessage('Recommendation ID is required.');
      return;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await fetch(`/api/recommendations/audit/${recommendationId}`);
      if (!response.ok) throw new Error('Failed to load audit log');
      const data = await response.json();
      setAudit(data.audit || null);
      setAudits([]);
    } catch (error) {
      console.error('Error loading audit log:', error);
      setErrorMessage('Failed to load audit log.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCampaignAudits = async () => {
    if (!campaignId) {
      setErrorMessage('Campaign ID is required.');
      return;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await fetch(`/api/recommendations/audit/campaign/${campaignId}`);
      if (!response.ok) throw new Error('Failed to load campaign audits');
      const data = await response.json();
      setAudits(data.audits || []);
      setAudit(null);
    } catch (error) {
      console.error('Error loading campaign audit logs:', error);
      setErrorMessage('Failed to load campaign audit logs.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderAudit = (entry: AuditLog, index?: number) => (
    <div key={entry.recommendation_id ?? index} className="border rounded-lg p-4 bg-white">
      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
        <span>Recommendation: {entry.recommendation_id || '—'}</span>
        <span>Campaign: {entry.campaign_id || '—'}</span>
        <span>Company: {entry.company_id || '—'}</span>
        <span>Created: {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</span>
        {isAdmin ? (
          <button
            onClick={() => {
              window.location.href = buildPolicySimulationLink(
                entry.recommendation_id,
                entry.campaign_id
              );
            }}
            className="text-xs px-2 py-1 rounded bg-gray-900 text-white"
          >
            Simulate with Policy
          </button>
        ) : (
          <span
            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-400"
            title="Admin only – policy simulation"
          >
            Simulate with Policy
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-700">
        <div>
          <div className="font-medium text-gray-900">Final score</div>
          <div>{entry.final_score ?? '—'}</div>
        </div>
        <div>
          <div className="font-medium text-gray-900">Confidence</div>
          <div>{entry.confidence ?? '—'}</div>
        </div>
        <div>
          <div className="font-medium text-gray-900">Historical accuracy factor</div>
          <div>{entry.historical_accuracy_factor ?? '—'}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <details className="border rounded-lg p-3 bg-gray-50">
          <summary className="cursor-pointer font-medium text-sm text-gray-700">Trend sources used</summary>
          <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
            {prettyJson(entry.trend_sources_used)}
          </pre>
        </details>
        <details className="border rounded-lg p-3 bg-gray-50">
          <summary className="cursor-pointer font-medium text-sm text-gray-700">Platform strategies used</summary>
          <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
            {prettyJson(entry.platform_strategies_used)}
          </pre>
        </details>
        <details className="border rounded-lg p-3 bg-gray-50">
          <summary className="cursor-pointer font-medium text-sm text-gray-700">Company profile used</summary>
          <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
            {prettyJson(entry.company_profile_used)}
          </pre>
        </details>
        <details className="border rounded-lg p-3 bg-gray-50">
          <summary className="cursor-pointer font-medium text-sm text-gray-700">Score breakdown</summary>
          <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
            {prettyJson(entry.scores_breakdown)}
          </pre>
        </details>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Recommendation Audit Console</h1>
          <p className="text-sm text-gray-600">
            Read-only audit logs for recommendation generation (admin only).
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <label className="block text-xs text-gray-500">Recommendation ID</label>
              <input
                value={recommendationId}
                onChange={(e) => setRecommendationId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="rec-uuid"
              />
              <button
                onClick={fetchAudit}
                disabled={isLoading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load Recommendation Audit'}
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-gray-500">Campaign ID</label>
              <input
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="campaign-uuid"
              />
              <button
                onClick={fetchCampaignAudits}
                disabled={isLoading}
                className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load Campaign Audits'}
              </button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}

        {audit && renderAudit(audit)}
        {audits.length > 0 && (
          <div className="space-y-4">
            {audits.map((entry, index) => renderAudit(entry, index))}
          </div>
        )}
        {!audit && audits.length === 0 && !isLoading && (
          <div className="text-sm text-gray-500">No audit data loaded yet.</div>
        )}
      </div>
    </div>
  );
}
