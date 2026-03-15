import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

type StrategySignals = {
  archived: number;
  longTerm: number;
  adopted: number;
  totalRecommendations: number;
  adoptionRate: number;
};

type Props = {
  companyId: string | null;
  fetchWithAuth?: ((input: RequestInfo, init?: RequestInit) => Promise<Response>) | null;
};

export default function StrategySignalsWidget({ companyId, fetchWithAuth }: Props) {
  const router = useRouter();
  const [data, setData] = useState<StrategySignals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) {
      setData(null);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    fetchWithAuth(`/api/recommendations/strategy-signals?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load strategy signals');
        return res.json();
      })
      .then((payload) =>
        setData({
          archived: Number(payload?.archived) || 0,
          longTerm: Number(payload?.longTerm) || 0,
          adopted: Number(payload?.adopted) || 0,
          totalRecommendations: Number(payload?.totalRecommendations) || 0,
          adoptionRate: Number(payload?.adoptionRate) || 0,
        })
      )
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [companyId, fetchWithAuth]);

  if (!companyId) return null;

  const handleIdeasAdopted = () => {
    router.push(`/campaigns?companyId=${encodeURIComponent(companyId)}&source=recommendations`);
  };

  const handleStrategicBacklog = () => {
    router.push(`/recommendations?companyId=${encodeURIComponent(companyId)}&state=LONG_TERM`);
  };

  const handleIdeasArchived = () => {
    router.push(`/recommendations?companyId=${encodeURIComponent(companyId)}&state=ARCHIVED`);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-3">Strategy Signals</h2>
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-sm text-gray-500">
            Loading…
          </div>
        ) : error ? (
          <div className="py-4 text-sm text-gray-500 text-center">
            Unable to load strategy signals
          </div>
        ) : data ? (
          <>
            <button
              type="button"
              onClick={handleIdeasAdopted}
              className="flex w-full items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-left hover:bg-gray-50 transition"
            >
              <span className="text-sm text-gray-700">Ideas Adopted</span>
              <span className="text-sm font-semibold text-gray-900">{data.adopted}</span>
            </button>
            <button
              type="button"
              onClick={handleStrategicBacklog}
              className="flex w-full items-center justify-between rounded-md border border-amber-100 bg-amber-50/50 px-3 py-2 text-left hover:bg-amber-50 transition"
            >
              <span className="text-sm text-gray-700">Strategic Backlog</span>
              <span className="text-sm font-semibold text-amber-800">{data.longTerm}</span>
            </button>
            <button
              type="button"
              onClick={handleIdeasArchived}
              className="flex w-full items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-left hover:bg-gray-50 transition"
            >
              <span className="text-sm text-gray-700">Ideas Archived</span>
              <span className="text-sm font-semibold text-gray-600">{data.archived}</span>
            </button>
            <div className="flex w-full items-center justify-between rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2">
              <span className="text-sm text-gray-700">Adoption Rate</span>
              <span className="text-sm font-semibold text-gray-900">{data.adoptionRate}%</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
