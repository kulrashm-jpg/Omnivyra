/**
 * /super-admin/consumption
 * Unified LLM + API consumption and credits management hub.
 *
 * Access tiers:
 *   super_admin   — all orgs overview + full cost analysis + credits management
 *   company_admin — own org only, expense view (cost + credits, no cross-org)
 *   user          — own org only, token counts only (no costs shown)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Brain, Zap, Coins, Building2, Calendar, Globe2, RefreshCw, Tag } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { supabase } from '../../utils/supabaseClient';
import LLMConsumptionPanel from '../../components/super-admin/LLMConsumptionPanel';
import ApiConsumptionPanel from '../../components/super-admin/ApiConsumptionPanel';
import CreditsManagementPanel from '../../components/super-admin/CreditsManagementPanel';
import AllOrgsConsumptionTable from '../../components/super-admin/AllOrgsConsumptionTable';
import PlansPricingPanel from '../../components/super-admin/PlansPricingPanel';

type ActiveTab = 'overview' | 'llm' | 'apis' | 'credits' | 'external_apis' | 'plans';
type Tier = 'super_admin' | 'company_admin' | 'user';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ConsumptionPage() {
  const router = useRouter();
  const { selectedCompanyId: ctxCompanyId, userRole } = useCompanyContext();

  const [tier, setTier] = useState<Tier>('user');
  const [activeTab, setActiveTab] = useState<ActiveTab>('llm');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [externalApis, setExternalApis] = useState<any[]>([]);
  const [loadingExternalApis, setLoadingExternalApis] = useState(false);

  // Period selector
  const now = new Date();
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);

  // Super admin org drill-down
  const [orgSearchMode, setOrgSearchMode] = useState(false);

  useEffect(() => {
    const role = userRole?.toUpperCase();
    if (role === 'SUPER_ADMIN') {
      setTier('super_admin');
      setActiveTab('overview');
    } else if (role === 'COMPANY_ADMIN' || role === 'ADMIN') {
      setTier('company_admin');
      setActiveTab('llm');
    } else {
      setTier('user');
      setActiveTab('llm');
    }
  }, [userRole]);

  const effectiveCompanyId = selectedOrgId ?? ctxCompanyId;

  const loadExternalApis = useCallback(async () => {
    if (!effectiveCompanyId) return;
    setLoadingExternalApis(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/external-apis?companyId=${effectiveCompanyId}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) { const d = await res.json(); setExternalApis(d.apis || []); }
    } catch { /* non-fatal */ }
    finally { setLoadingExternalApis(false); }
  }, [effectiveCompanyId]);

  useEffect(() => {
    if (activeTab === 'external_apis') loadExternalApis();
  }, [activeTab, loadExternalApis]);

  const tabs = ([
    { key: 'overview' as ActiveTab,      label: 'All Orgs',      icon: <Building2 className="w-4 h-4" />, superAdminOnly: true },
    { key: 'llm' as ActiveTab,           label: 'LLM Usage',     icon: <Brain className="w-4 h-4" /> },
    { key: 'apis' as ActiveTab,          label: 'API Calls',     icon: <Zap className="w-4 h-4" /> },
    { key: 'credits' as ActiveTab,       label: 'Credits',       icon: <Coins className="w-4 h-4" /> },
    { key: 'external_apis' as ActiveTab, label: 'External APIs', icon: <Globe2 className="w-4 h-4" /> },
    { key: 'plans' as ActiveTab,         label: 'Plans & Pricing', icon: <Tag className="w-4 h-4" />, superAdminOnly: true },
  ] as { key: ActiveTab; label: string; icon: React.ReactNode; superAdminOnly?: boolean }[]).filter(t => !t.superAdminOnly || tier === 'super_admin');

  const yearOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href={tier === 'super_admin' ? '/super-admin' : '/dashboard'}
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> {tier === 'super_admin' ? 'Super Admin' : 'Dashboard'}
          </Link>
        </div>

        {/* Page header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Consumption Analytics</h1>
          <p className="text-gray-400 text-sm">
            {tier === 'super_admin'
              ? 'Full cost and credit visibility across all organizations.'
              : tier === 'company_admin'
              ? 'Your organization\'s LLM and API consumption, in credits and USD.'
              : 'Your organization\'s AI usage summary.'}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400" />
          <select
            value={selMonth}
            onChange={e => setSelMonth(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
          >
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={selYear}
            onChange={e => setSelYear(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Org selector for super_admin drill-down */}
          {tier === 'super_admin' && selectedOrgId && (
            <div className="flex items-center gap-2 ml-4 bg-violet-900/30 border border-violet-700 rounded-lg px-3 py-1.5 text-sm">
              <span className="text-violet-300">Viewing: <span className="font-mono text-xs">{selectedOrgId.slice(0, 12)}…</span></span>
              <button onClick={() => setSelectedOrgId(null)} className="text-gray-400 hover:text-white ml-2">✕</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 overflow-x-auto">
          <div className="flex gap-1 bg-gray-800/50 rounded-xl p-1 w-max min-w-full sm:w-fit">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === t.key
                    ? 'bg-gray-700 text-white shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 sm:p-6">
          {activeTab === 'overview' && tier === 'super_admin' && (
            <AllOrgsConsumptionTable
              year={selYear}
              month={selMonth}
              onSelectOrg={(orgId) => {
                setSelectedOrgId(orgId);
                setActiveTab('llm');
              }}
            />
          )}

          {activeTab === 'llm' && (
            <LLMConsumptionPanel
              tier={tier}
              companyId={effectiveCompanyId ?? undefined}
              year={selYear}
              month={selMonth}
            />
          )}

          {activeTab === 'apis' && (
            <ApiConsumptionPanel
              tier={tier}
              companyId={effectiveCompanyId ?? undefined}
              year={selYear}
              month={selMonth}
            />
          )}

          {activeTab === 'credits' && effectiveCompanyId && (
            <CreditsManagementPanel
              companyId={effectiveCompanyId}
              isSuperAdmin={tier === 'super_admin'}
            />
          )}

          {activeTab === 'credits' && !effectiveCompanyId && (
            <div className="text-gray-400 text-sm text-center py-12">
              {tier === 'super_admin'
                ? 'Select an organization from the All Orgs tab to manage its credits.'
                : 'No organization context available.'}
            </div>
          )}

          {activeTab === 'plans' && tier === 'super_admin' && (
            <PlansPricingPanel />
          )}

          {activeTab === 'external_apis' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-white">External API Usage</h2>
                <button
                  onClick={loadExternalApis}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingExternalApis ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              {loadingExternalApis ? (
                <div className="flex items-center gap-2 text-gray-400 py-8">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : !effectiveCompanyId ? (
                <p className="text-gray-400 text-sm py-8">Select an organization to view external API usage.</p>
              ) : externalApis.length === 0 ? (
                <p className="text-gray-400 text-sm py-8">No external APIs configured for this organization.</p>
              ) : (
                <div className="space-y-4">
                  {externalApis.map((api: any) => {
                    const s = api.usage_summary;
                    const failureRate = s && s.request_count > 0 ? Math.round((s.failure_count / s.request_count) * 100) : 0;
                    return (
                      <div key={api.id} className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <div className="font-semibold text-white">{api.name}</div>
                            <div className="text-xs text-gray-400 truncate">{api.base_url}</div>
                          </div>
                          {api.enabled_user_count != null && (
                            <span className="text-xs text-gray-400 shrink-0">{api.enabled_user_count} enabled</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                          {[
                            { label: 'Requests (14d)', value: s?.request_count ?? 0 },
                            { label: 'Successes',      value: s?.success_count ?? 0 },
                            { label: 'Failures',       value: s?.failure_count ?? 0 },
                            { label: 'Failure rate',   value: `${failureRate}%`, warn: failureRate > 10 },
                          ].map(({ label, value, warn }) => (
                            <div key={label} className="bg-gray-900 rounded-lg p-3">
                              <div className="text-xs text-gray-400">{label}</div>
                              <div className={`text-lg font-semibold mt-0.5 ${warn ? 'text-red-400' : 'text-white'}`}>{value}</div>
                            </div>
                          ))}
                        </div>
                        {/* Daily bar chart */}
                        {Array.isArray(api.usage_daily) && api.usage_daily.length > 0 && (
                          <div>
                            <div className="text-xs text-gray-400 mb-2">Daily usage (14d)</div>
                            <div className="flex items-end gap-1 h-12">
                              {api.usage_daily.slice(-14).map((day: any) => {
                                const max = Math.max(1, ...api.usage_daily.map((d: any) => d.request_count || 0));
                                const h = Math.round(((day.request_count || 0) / max) * 44);
                                return (
                                  <div key={day.usage_date} className="flex-1 flex flex-col items-center gap-0.5" title={`${day.usage_date}: ${day.request_count} requests`}>
                                    <div className="w-full bg-indigo-600 rounded-sm" style={{ height: `${h}px` }} />
                                    <span className="text-[8px] text-gray-500">{String(day.usage_date).slice(8)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Last error */}
                        {s?.last_error_message && (
                          <div className="mt-3 text-xs text-red-400">
                            Last error: {s.last_error_code ? `[${s.last_error_code}] ` : ''}{s.last_error_message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
