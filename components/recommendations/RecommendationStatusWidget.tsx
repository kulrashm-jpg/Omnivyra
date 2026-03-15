import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

type StateCounts = { ACTIVE: number; ARCHIVED: number; LONG_TERM: number };

type Props = {
  companyId: string | null;
  fetchWithAuth?: ((input: RequestInfo, init?: RequestInit) => Promise<Response>) | null;
};

export default function RecommendationStatusWidget({ companyId, fetchWithAuth }: Props) {
  const router = useRouter();
  const [counts, setCounts] = useState<StateCounts>({ ACTIVE: 0, ARCHIVED: 0, LONG_TERM: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) {
      setCounts({ ACTIVE: 0, ARCHIVED: 0, LONG_TERM: 0 });
      return;
    }
    setLoading(true);
    fetchWithAuth(`/api/recommendations/user-state-counts?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : { ACTIVE: 0, ARCHIVED: 0, LONG_TERM: 0 }))
      .then((data) =>
        setCounts({
          ACTIVE: Number(data?.ACTIVE) || 0,
          ARCHIVED: Number(data?.ARCHIVED) || 0,
          LONG_TERM: Number(data?.LONG_TERM) || 0,
        })
      )
      .catch(() => setCounts({ ACTIVE: 0, ARCHIVED: 0, LONG_TERM: 0 }))
      .finally(() => setLoading(false));
  }, [companyId, fetchWithAuth]);

  const total = counts.ACTIVE + counts.ARCHIVED + counts.LONG_TERM;
  if (total === 0 && !loading) return null;

  const handleClick = (state: string) => {
    router.push(`/recommendations?companyId=${encodeURIComponent(companyId || '')}&state=${state}`);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-gray-800 mb-3">Recommendation Status</h4>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => handleClick('ACTIVE')}
          className="flex flex-col items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-center hover:bg-gray-100 transition"
        >
          <span className="text-lg font-semibold text-gray-900">{loading ? '—' : counts.ACTIVE}</span>
          <span className="text-xs text-gray-600">Active</span>
        </button>
        <button
          type="button"
          onClick={() => handleClick('LONG_TERM')}
          className="flex flex-col items-center rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center hover:bg-amber-100 transition"
        >
          <span className="text-lg font-semibold text-amber-800">{loading ? '—' : counts.LONG_TERM}</span>
          <span className="text-xs text-amber-700">Strategic / Later</span>
        </button>
        <button
          type="button"
          onClick={() => handleClick('ARCHIVED')}
          className="flex flex-col items-center rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-center hover:bg-gray-200 transition"
        >
          <span className="text-lg font-semibold text-gray-600">{loading ? '—' : counts.ARCHIVED}</span>
          <span className="text-xs text-gray-500">Archived</span>
        </button>
      </div>
    </div>
  );
}
