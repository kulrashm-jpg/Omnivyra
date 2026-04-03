import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Header from '@/components/Header';
import { useCompanyContext } from '@/components/CompanyContext';
import { getAuthToken } from '@/utils/getAuthToken';
import { ChevronDown, ChevronRight, Building2, Brain, Activity, Save } from 'lucide-react';

type AccessResponse = {
  companyId: string;
  mode: 'global' | 'company';
  isSuperAdmin: boolean;
  availableCompanies?: Array<{
    id: string;
    name: string;
  }>;
  hasCompanyOverrides: boolean;
  canResetToDefault: boolean;
  insights: {
    market_trends: boolean;
    competitor_tracking: boolean;
    ai_recommendations: boolean;
  };
  frequency: {
    insights: '1h' | '2h' | '8h';
  };
  activity: Array<{
    key: string;
    label: string;
    jobs: string[];
    enabled: boolean;
  }>;
  intelligence: Array<{
    id: string;
    name: string;
    category: string;
    report_tiers: string[];
    enabled: boolean;
  }>;
};

type ExpandedState = {
  insights: boolean;
  activity: boolean;
  intelligence: boolean;
  tiers: Record<string, boolean>;
};

const tierOrder = ['snapshot', 'growth', 'deep'];

function formatLabel(input: string): string {
  return input
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function CompanyAdminAccessPage() {
  const { userRole } = useCompanyContext();
  const normalizedRole = (userRole || '').toUpperCase();
  const isSuperAdmin = normalizedRole === 'SUPER_ADMIN';
  const isCompanyAdmin = normalizedRole === 'COMPANY_ADMIN' || isSuperAdmin;
  const [mode, setMode] = useState<'global' | 'company'>('company');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const [data, setData] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>({
    insights: true,
    activity: true,
    intelligence: true,
    tiers: {
      snapshot: true,
      growth: true,
      deep: true,
    },
  });

  useEffect(() => {
    if (notice) {
      const t = window.setTimeout(() => setNotice(null), 2500);
      return () => window.clearTimeout(t);
    }
  }, [notice]);

  const groupedUnits = useMemo(() => {
    const groups: Record<string, AccessResponse['intelligence']> = {
      snapshot: [],
      growth: [],
      deep: [],
    };

    for (const unit of data?.intelligence ?? []) {
      for (const tier of unit.report_tiers) {
        if (!groups[tier]) groups[tier] = [];
        if (!groups[tier].some((u) => u.id === unit.id)) {
          groups[tier].push(unit);
        }
      }
    }

    return groups;
  }, [data]);

  async function getHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadAccess(currentMode: 'global' | 'company' = mode, companyId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const headers = await getHeaders();
      const search = new URLSearchParams({ mode: currentMode });
      if (currentMode === 'company' && companyId) {
        search.set('companyId', companyId);
      }
      const res = await fetch(`/api/settings/intelligence-access?${search.toString()}`, { headers });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load access settings');
      }
      const next = json as AccessResponse;
      setData(next);
      if (next.companyId) {
        setSelectedCompanyId(next.companyId);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load access settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isCompanyAdmin) {
      setLoading(false);
      return;
    }
    loadAccess(mode, selectedCompanyId);
  }, [isCompanyAdmin, mode]);

  async function savePatch(payload: Record<string, unknown>) {
    if (!data) return;
    setSaving(true);
    setError(null);

    const previous = data;
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/settings/intelligence-access', {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...payload,
          mode,
          ...(mode === 'company' && selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to save');
      }
      setData(json as AccessResponse);
      setNotice('Settings saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
      setData(previous);
    } finally {
      setSaving(false);
    }
  }

  async function onResetToDefault() {
    await savePatch({ resetToDefault: true });
    await loadAccess(mode, selectedCompanyId);
  }

  function onSelectedCompanyChange(companyId: string) {
    setSelectedCompanyId(companyId);
    void loadAccess('company', companyId);
  }

  function onInsightToggle(key: keyof AccessResponse['insights'], checked: boolean) {
    if (!data) return;
    const next = {
      ...data,
      insights: {
        ...data.insights,
        [key]: checked,
      },
      activity: data.activity.map((node) =>
        node.key === key ? { ...node, enabled: checked } : node
      ),
    };
    setData(next);
    void savePatch({ insights: { [key]: checked } });
  }

  function onFrequencyChange(value: AccessResponse['frequency']['insights']) {
    if (!data) return;
    setData({
      ...data,
      frequency: {
        ...data.frequency,
        insights: value,
      },
    });
    void savePatch({ frequency: { insights: value } });
  }

  function onUnitToggle(id: string, checked: boolean) {
    if (!data) return;
    setData({
      ...data,
      intelligence: data.intelligence.map((unit) =>
        unit.id === id ? { ...unit, enabled: checked } : unit
      ),
    });
    void savePatch({ units: [{ id, enabled: checked }] });
  }

  function toggleRoot(key: keyof Omit<ExpandedState, 'tiers'>) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleTier(tier: string) {
    setExpanded((prev) => ({
      ...prev,
      tiers: {
        ...prev.tiers,
        [tier]: !prev.tiers[tier],
      },
    }));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>Company Admin Access Settings</title>
      </Head>
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Company Admin Engine Access</h1>
              <p className="text-sm text-slate-600 mt-1">
                Configure what your company users can access from insight, intelligence, and activity engines.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-2 rounded-lg">
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Auto-save enabled'}
            </div>
          </div>

          {isSuperAdmin && (
            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-indigo-900">Scope</span>
              <button
                type="button"
                onClick={() => setMode('global')}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === 'global' ? 'bg-indigo-700 text-white' : 'bg-white text-indigo-700 border border-indigo-200'}`}
              >
                Global Default (All Companies)
              </button>
              <button
                type="button"
                onClick={() => setMode('company')}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === 'company' ? 'bg-indigo-700 text-white' : 'bg-white text-indigo-700 border border-indigo-200'}`}
              >
                Company Exception
              </button>

              {mode === 'company' && data?.availableCompanies && data.availableCompanies.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-sm font-medium text-indigo-900" htmlFor="company-picker">
                    Company
                  </label>
                  <select
                    id="company-picker"
                    value={selectedCompanyId || data.companyId}
                    onChange={(e) => onSelectedCompanyChange(e.target.value)}
                    className="border border-indigo-200 bg-white rounded-lg px-2 py-1.5 text-sm text-indigo-900"
                  >
                    {data.availableCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {notice && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
              {notice}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {!isCompanyAdmin && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              Only Company Admin users can configure this page.
            </div>
          )}

          {isCompanyAdmin && loading && (
            <div className="mt-6 text-sm text-slate-600">Loading configuration...</div>
          )}

          {isCompanyAdmin && data && !loading && (
            <div className="mt-6 space-y-6">
              {mode === 'company' && data.canResetToDefault && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-amber-900">
                    This company currently has custom exceptions over the default profile.
                  </div>
                  <button
                    type="button"
                    onClick={() => { void onResetToDefault(); }}
                    className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                  >
                    Reset To Default
                  </button>
                </div>
              )}

              <section className="rounded-xl border border-slate-200 p-4">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => toggleRoot('insights')}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-slate-700" />
                    <h2 className="font-semibold text-slate-900">Insights</h2>
                  </div>
                  {expanded.insights ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>

                {expanded.insights && (
                  <div className="mt-4 ml-1 pl-4 border-l border-slate-200 space-y-4">
                    {(Object.keys(data.insights) as Array<keyof AccessResponse['insights']>).map((key) => (
                      <label key={key} className="flex items-center gap-3 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={Boolean(data.insights[key])}
                          onChange={(e) => onInsightToggle(key, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{formatLabel(key)}</span>
                      </label>
                    ))}

                    <div className="pt-2">
                      <label className="text-sm text-slate-700 mr-2">Insights Frequency</label>
                      <select
                        value={data.frequency.insights}
                        onChange={(e) => onFrequencyChange(e.target.value as AccessResponse['frequency']['insights'])}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="1h">1h</option>
                        <option value="2h">2h</option>
                        <option value="8h">8h</option>
                      </select>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => toggleRoot('activity')}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-slate-700" />
                    <h2 className="font-semibold text-slate-900">Activity Engines</h2>
                  </div>
                  {expanded.activity ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>

                {expanded.activity && (
                  <div className="mt-4 ml-1 pl-4 border-l border-slate-200 space-y-4">
                    {data.activity.map((node) => (
                      <div key={node.key} className="space-y-2">
                        <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={node.enabled}
                            onChange={(e) => onInsightToggle(node.key as keyof AccessResponse['insights'], e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span>{node.label}</span>
                        </label>

                        <ul className="ml-7 text-xs text-slate-600 list-disc space-y-1">
                          {node.jobs.map((job) => (
                            <li key={job}>{job}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => toggleRoot('intelligence')}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-slate-700" />
                    <h2 className="font-semibold text-slate-900">Intelligence Engines</h2>
                  </div>
                  {expanded.intelligence ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </button>

                {expanded.intelligence && (
                  <div className="mt-4 ml-1 pl-4 border-l border-slate-200 space-y-4">
                    {tierOrder.map((tier) => {
                      const units = groupedUnits[tier] || [];
                      if (!units.length) return null;

                      return (
                        <div key={tier} className="rounded-lg border border-slate-200 p-3">
                          <button
                            type="button"
                            className="w-full flex items-center justify-between"
                            onClick={() => toggleTier(tier)}
                          >
                            <h3 className="text-sm font-semibold text-slate-900">{formatLabel(tier)} Tier</h3>
                            {expanded.tiers[tier] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>

                          {expanded.tiers[tier] && (
                            <div className="mt-3 ml-1 pl-4 border-l border-slate-200 grid sm:grid-cols-2 gap-2">
                              {units.map((unit) => (
                                <label key={`${tier}-${unit.id}`} className="flex items-center gap-2 text-sm text-slate-800">
                                  <input
                                    type="checkbox"
                                    checked={unit.enabled}
                                    onChange={(e) => onUnitToggle(unit.id, e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  <span>{unit.name}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
