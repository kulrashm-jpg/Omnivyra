import React, { useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

type FacetCard = { id: string; title: string; description: string };

type Props = {
  companyId: string | null;
  fetchWithAuth: FetchWithAuth;
  selectedFacets: string[];
  onChange: (facets: string[]) => void;
  mode: string;
};

function deriveFacets(profile: Record<string, unknown> | null): FacetCard[] {
  if (!profile) return [];
  const list: FacetCard[] = [];
  const seen = new Set<string>();

  const add = (source: string, value: string | string[] | null | undefined) => {
    if (value == null) return;
    const parts = Array.isArray(value)
      ? value.map((v) => String(v).trim()).filter(Boolean)
      : String(value)
          .split(/[,;]|\s+and\s+/i)
          .map((s) => s.trim())
          .filter(Boolean);
    parts.forEach((p, i) => {
      const key = `${source}:${p.slice(0, 50)}`;
      if (seen.has(key) || list.length >= 8) return;
      seen.add(key);
      list.push({
        id: key,
        title: p.slice(0, 48) + (p.length > 48 ? '…' : ''),
        description: p.length > 80 ? p.slice(0, 77) + '…' : p,
      });
    });
  };

  add('content_themes', profile.content_themes as string | undefined);
  add('campaign_focus', profile.campaign_focus as string | undefined);
  add('key_messages', profile.key_messages as string | undefined);
  add('target_customer_segment', profile.target_customer_segment as string | undefined);
  add('products_services', profile.products_services as string | undefined);
  add('products_services_list', profile.products_services_list as string[] | undefined);

  return list.slice(0, 8);
}

export default function OfferingFacetSelector({
  companyId,
  fetchWithAuth,
  selectedFacets,
  onChange,
  mode,
}: Props) {
  const [facets, setFacets] = useState<FacetCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!companyId || typeof window === 'undefined') return;
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || detail.companyId === companyId) {
        setRefreshToken((v) => v + 1);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === `company_profile_updated:${companyId}`) {
        setRefreshToken((v) => v + 1);
      }
    };
    window.addEventListener('company-profile-updated', handleProfileUpdated as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('company-profile-updated', handleProfileUpdated as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setFacets([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.profile) {
          setFacets(deriveFacets(data.profile));
        } else {
          setFacets([]);
        }
      })
      .catch(() => {
        if (!cancelled) setFacets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth, refreshToken]);

  const toggle = (id: string) => {
    if (selectedFacets.includes(id)) {
      onChange(selectedFacets.filter((f) => f !== id));
    } else {
      onChange([...selectedFacets, id]);
    }
  };

  if (mode === 'NONE') return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Offering focus</h3>
      {loading && <p className="text-xs text-gray-500">Loading facets…</p>}
      {!loading && facets.length === 0 && (
        <p className="text-xs text-gray-500">No facets from company profile.</p>
      )}
      {!loading && facets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          {facets.map((f) => {
            const selected = selectedFacets.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50/50 text-gray-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <div className="font-medium truncate">{f.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{f.description}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
