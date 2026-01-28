import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

type PolicyWeights = {
  trend_score: number;
  geo_fit: number;
  audience_fit: number;
  category_fit: number;
  platform_fit: number;
  health_multiplier: number;
  historical_accuracy: number;
  effort_penalty: number;
};

type Policy = {
  id: string;
  name: string;
  is_active: boolean;
  weights: PolicyWeights;
  updated_at?: string;
};

type AuditSnapshot = {
  recommendation_id?: string | null;
  campaign_id?: string | null;
  company_id?: string | null;
  trend_sources_used?: any;
  platform_strategies_used?: any;
  company_profile_used?: any;
  scores_breakdown?: any;
  policy_weights_used?: Partial<PolicyWeights>;
  created_at?: string | null;
};

const defaultWeights: PolicyWeights = {
  trend_score: 1,
  geo_fit: 1,
  audience_fit: 1,
  category_fit: 1,
  platform_fit: 1,
  health_multiplier: 1,
  historical_accuracy: 1,
  effort_penalty: 0.1,
};

export const getRecommendationBannerText = (recommendationId?: string | null) => {
  if (!recommendationId) return null;
  return `Simulating based on Recommendation: ${recommendationId}`;
};

export default function RecommendationPolicyPage() {
  const router = useRouter();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [weights, setWeights] = useState<PolicyWeights>(defaultWeights);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [recommendationId, setRecommendationId] = useState('');
  const [simulation, setSimulation] = useState<{
    baseline_recommendations: any[];
    simulated_recommendations: any[];
    compared_with: string | null;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [autoSimulated, setAutoSimulated] = useState(false);
  const [auditSnapshot, setAuditSnapshot] = useState<AuditSnapshot | null>(null);
  const [prefilledFromAudit, setPrefilledFromAudit] = useState(false);

  useEffect(() => {
    const loadPolicy = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/recommendation-policy');
        if (!response.ok) throw new Error('Failed to load policy');
        const data = await response.json();
        if (data?.policy) {
          setPolicy(data.policy);
          setWeights(data.policy.weights || defaultWeights);
        }
      } catch (error) {
        console.error('Failed to load policy', error);
        setErrorMessage('Failed to load policy.');
      } finally {
        setIsLoading(false);
      }
    };
    loadPolicy();
  }, []);

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

  useEffect(() => {
    const queryCampaignId =
      typeof router.query.campaignId === 'string' ? router.query.campaignId : '';
    if (queryCampaignId) {
      setCampaignId(queryCampaignId);
    }
    const queryRecommendationId =
      typeof router.query.recommendationId === 'string' ? router.query.recommendationId : '';
    if (queryRecommendationId) {
      setRecommendationId(queryRecommendationId);
    }
  }, [router.query.campaignId, router.query.recommendationId]);

  useEffect(() => {
    if (!recommendationId || !isAdmin) return;
    const loadAuditSnapshot = async () => {
      try {
        const response = await fetch(`/api/recommendations/audit/${recommendationId}`);
        if (!response.ok) return;
        const data = await response.json();
        const audit = data?.audit as AuditSnapshot | null;
        if (!audit) return;
        setAuditSnapshot(audit);
        if (audit?.campaign_id && !campaignId) {
          setCampaignId(audit.campaign_id);
        }
        if (audit?.company_id && !companyId) {
          setCompanyId(audit.company_id);
        }
        if (audit?.policy_weights_used && !prefilledFromAudit) {
          setWeights((prev) => ({
            ...prev,
            ...audit.policy_weights_used,
          }));
          setPrefilledFromAudit(true);
        }
      } catch (error) {
        console.warn('Unable to load audit snapshot');
      }
    };
    loadAuditSnapshot();
  }, [recommendationId, isAdmin, campaignId, companyId, prefilledFromAudit]);

  const updateWeight = (key: keyof PolicyWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  const savePolicy = async () => {
    if (!policy) return;
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      const response = await fetch('/api/recommendation-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, weights }),
      });
      if (!response.ok) throw new Error('Failed to update policy');
      const data = await response.json();
      setPolicy(data.policy);
      setSuccessMessage('Policy updated.');
    } catch (error) {
      console.error('Failed to update policy', error);
      setErrorMessage('Failed to update policy.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetDefaults = () => {
    setWeights(defaultWeights);
  };

  const runSimulation = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await fetch('/api/recommendations/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: companyId || undefined,
          campaignId: campaignId || undefined,
          draftPolicyWeights: weights,
        }),
      });
      if (!response.ok) throw new Error('Failed to simulate recommendations');
      const data = await response.json();
      setSimulation({
        baseline_recommendations: data.baseline_recommendations || [],
        simulated_recommendations: data.simulated_recommendations || [],
        compared_with: data.compared_with || null,
      });
    } catch (error) {
      console.error('Simulation failed', error);
      setErrorMessage('Simulation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!campaignId || !policy || autoSimulated || !isAdmin) return;
    setAutoSimulated(true);
    runSimulation();
  }, [campaignId, policy, autoSimulated, isAdmin]);

  const buildComparisonRows = () => {
    if (!simulation) return [];
    const baselineMap = new Map(
      simulation.baseline_recommendations.map((rec) => [rec.trend, rec])
    );
    return simulation.simulated_recommendations.map((rec) => {
      const baseline = baselineMap.get(rec.trend);
      const baselineScore = baseline?.final_score ?? 0;
      const draftScore = rec.final_score ?? 0;
      const delta = Number((draftScore - baselineScore).toFixed(2));
      return {
        trend: rec.trend,
        baselineScore,
        draftScore,
        delta,
      };
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <a
            href={
              campaignId
                ? `/recommendations/audit?campaignId=${encodeURIComponent(campaignId)}`
                : '/recommendations/audit'
            }
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Back to Audit Console
          </a>
          <div className="mt-2 text-xs text-gray-500">
            <span>Policy &amp; Simulation</span>
            <span className="px-1">→</span>
            {isAdmin ? (
              <a
                href={
                  campaignId
                    ? `/recommendations/analytics?campaignId=${encodeURIComponent(campaignId)}${
                        recommendationId
                          ? `&recommendationId=${encodeURIComponent(recommendationId)}`
                          : ''
                      }`
                    : recommendationId
                      ? `/recommendations/analytics?recommendationId=${encodeURIComponent(recommendationId)}`
                      : '/recommendations/analytics'
                }
                className="text-indigo-600 hover:text-indigo-800"
              >
                Analytics
              </a>
            ) : (
              <span title="Admin only – analytics access required">Analytics</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Recommendation Policy</h1>
              <p className="text-sm text-gray-600">
                Admin-only policy controls for recommendation scoring.
              </p>
              {policy?.updated_at && (
                <p className="text-xs text-gray-500 mt-2">
                  Last updated: {new Date(policy.updated_at).toLocaleString()}
                </p>
              )}
            </div>
            {isAdmin ? (
              <button
                onClick={() => {
                  const target = campaignId
                    ? `/recommendations/analytics?campaignId=${encodeURIComponent(campaignId)}${
                        recommendationId
                          ? `&recommendationId=${encodeURIComponent(recommendationId)}`
                          : ''
                      }`
                    : recommendationId
                      ? `/recommendations/analytics?recommendationId=${encodeURIComponent(recommendationId)}`
                      : '/recommendations/analytics';
                  window.location.href = target;
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm"
              >
                View Analytics
              </button>
            ) : (
              <button
                disabled
                title="Admin only – analytics access required"
                className="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg text-sm cursor-not-allowed"
              >
                View Analytics
              </button>
            )}
          </div>
        </div>

        {recommendationId && (
          <div className="bg-blue-50 border border-blue-100 text-blue-800 text-sm rounded-lg p-3 space-y-1">
            <div>{getRecommendationBannerText(recommendationId)}</div>
            <div className="text-xs text-blue-700">
              Analyzing performance context for Recommendation {recommendationId}
            </div>
          </div>
        )}

        {campaignId && (
          <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 text-sm rounded-lg p-3">
            Simulating for Campaign: {campaignId}
          </div>
        )}

        {!isAdmin && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
            Admin access required to adjust or simulate policy weights.
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          {Object.entries(weights).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-700">{key.replace('_', ' ')}</div>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={value}
                onChange={(e) => updateWeight(key as keyof PolicyWeights, Number(e.target.value))}
                disabled={!isAdmin}
                className="w-24 border rounded-lg px-2 py-1 text-sm"
              />
            </div>
          ))}

          <div className="flex items-center gap-2 pt-4">
            <button
              onClick={savePolicy}
              disabled={isLoading || !policy || !isAdmin}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={resetDefaults}
              disabled={!isAdmin}
              className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm"
            >
              Reset to default
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Simulate Policy Impact</h2>
          <p className="text-sm text-gray-600">
            Preview how weight changes affect recommendations without saving.
          </p>
          {auditSnapshot && (
            <details className="border rounded-lg p-3 bg-gray-50">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                Audit baseline context
              </summary>
              <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    recommendation_id: auditSnapshot.recommendation_id,
                    campaign_id: auditSnapshot.campaign_id,
                    policy_weights_used: auditSnapshot.policy_weights_used,
                    trend_sources_used: auditSnapshot.trend_sources_used,
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs text-gray-500">Company ID (optional)</label>
              <input
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="default"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Campaign ID (optional)</label>
              <input
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="campaign-id"
              />
            </div>
          </div>
          <button
            onClick={runSimulation}
            disabled={isLoading || !isAdmin}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {isLoading ? 'Simulating...' : 'Run Simulation'}
          </button>

          {simulation && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 mb-2">
                Compared with policy: {simulation.compared_with || 'default'}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 pr-4">Topic</th>
                      <th className="py-2 pr-4">Current Score</th>
                      <th className="py-2 pr-4">Draft Score</th>
                      <th className="py-2">Δ Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildComparisonRows().map((row) => (
                      <tr key={row.trend} className="border-t">
                        <td className="py-2 pr-4">{row.trend}</td>
                        <td className="py-2 pr-4">{row.baselineScore}</td>
                        <td className="py-2 pr-4">{row.draftScore}</td>
                        <td
                          className={`py-2 ${Math.abs(row.delta) >= 0.5 ? 'text-amber-600 font-semibold' : ''}`}
                        >
                          {row.delta >= 0 ? `+${row.delta}` : row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
