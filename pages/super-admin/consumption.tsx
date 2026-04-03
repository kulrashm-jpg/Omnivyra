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
import { ArrowLeft, Brain, Zap, Coins, Building2, Calendar, Globe2, RefreshCw, Tag, Server, Database, BarChart, SlidersHorizontal } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { getAuthToken } from '../../utils/getAuthToken';
import LLMConsumptionPanel from '../../components/super-admin/LLMConsumptionPanel';
import ApiConsumptionPanel from '../../components/super-admin/ApiConsumptionPanel';
import CreditsManagementPanel from '../../components/super-admin/CreditsManagementPanel';
import AllOrgsConsumptionTable from '../../components/super-admin/AllOrgsConsumptionTable';
import PlansPricingPanel from '../../components/super-admin/PlansPricingPanel';
import PlanAnalyticsPanel from '../../components/super-admin/PlanAnalyticsPanel';
import InfraConsumptionPanel    from '../../components/super-admin/InfraConsumptionPanel';
import RedisEfficiencyPanel    from '../../components/super-admin/RedisEfficiencyPanel';
import ActivityControlPanel    from '../../components/super-admin/ActivityControlPanel';

type ActiveTab = 'overview' | 'llm' | 'apis' | 'credits' | 'external_apis' | 'plans' | 'infra' | 'redis' | 'activity_control';
type Tier = 'super_admin' | 'company_admin' | 'user';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ConsumptionPage() {
  const router = useRouter();
  const { selectedCompanyId: ctxCompanyId, userRole, isLoading: ctxLoading, isAuthenticated } = useCompanyContext();

  const [tier, setTier] = useState<Tier>('user');
  const [tierResolved, setTierResolved] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('llm');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [externalApis, setExternalApis] = useState<any[]>([]);
  const [loadingExternalApis, setLoadingExternalApis] = useState(false);
  const [orgs, setOrgs] = useState<{ id: string; name: string; website: string }[]>([]);
  const [orgSearch, setOrgSearch] = useState('');

  // Period selector
  const now = new Date();
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);

  // Super admin org drill-down
  const [orgSearchMode, setOrgSearchMode] = useState(false);

  // Shared infra cost state — InfraConsumptionPanel emits this, AllOrgsConsumptionTable consumes it
  const [infraTotal, setInfraTotal] = useState(0);
  const [infraOrgCount, setInfraOrgCount] = useState(0);

  // Detect tier: check super_admin_session cookie (HttpOnly — must ask server),
  // then fall back to Supabase userRole for regular users.
  // Wait for CompanyContext to finish loading so we don't fire panels with no auth.
  useEffect(() => {
    async function resolveTier() {
      try {
        // Check for super-admin session cookie via check-super-admin endpoint
        const res = await fetch('/api/admin/check-super-admin', { credentials: 'include' });
        const json = await res.json();
        if (json.isSuperAdmin) {
          setTier('super_admin');
          setActiveTab('overview');
          setTierResolved(true);
          return;
        }
      } catch { /* ignore — fall through to userRole */ }

      // Don't resolve until CompanyContext has finished loading its auth state
      if (ctxLoading) {
        return;
      }

      // No Supabase session and no super-admin cookie → redirect to login
      if (!isAuthenticated) {
        router.replace('/login');
        return;
      }

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
      setTierResolved(true);
    }
    resolveTier();
  }, [userRole, ctxLoading, isAuthenticated, router]);

  // Load org list for super admin org selector
  useEffect(() => {
    if (tier !== 'super_admin') return;
    fetch('/api/super-admin/companies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.companies) setOrgs(d.companies.map((c: any) => ({ id: c.id, name: c.name, website: c.website || '' }))); })
      .catch(() => {});
  }, [tier]);

  const effectiveCompanyId = selectedOrgId ?? ctxCompanyId;

  const loadExternalApis = useCallback(async () => {
    if (!effectiveCompanyId) return;
    setLoadingExternalApis(true);
    try {
      const token = await getAuthToken();
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
    { key: 'infra'  as ActiveTab, label: 'Infra',           icon: <Server   className="w-4 h-4" />, superAdminOnly: true },
    { key: 'redis'  as ActiveTab, label: 'Redis',           icon: <Database className="w-4 h-4" />, superAdminOnly: true },
    { key: 'activity_control' as ActiveTab, label: 'Activity Control', icon: <SlidersHorizontal className="w-4 h-4" />, superAdminOnly: true },
  ] as { key: ActiveTab; label: string; icon: React.ReactNode; superAdminOnly?: boolean }[]).filter(t => !t.superAdminOnly || tier === 'super_admin');

  const yearOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  if (!tierResolved) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href={tier === 'super_admin' ? '/super-admin/dashboard' : '/dashboard'}
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> {tier === 'super_admin' ? 'Super Admin Dashboard' : 'Dashboard'}
          </Link>
        </div>

        {/* Page header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">Consumption Analytics</h1>
          <p className="text-slate-600 text-sm">
            {tier === 'super_admin'
              ? 'Full cost and credit visibility across all organizations.'
              : tier === 'company_admin'
              ? 'Your organization\'s LLM and API consumption, in credits and USD.'
              : 'Your organization\'s AI usage summary.'}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-3 mb-6 flex-wrap bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <Calendar className="w-4 h-4 text-blue-600" />
          <select
            value={selMonth}
            onChange={e => setSelMonth(parseInt(e.target.value, 10))}
            className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={selYear}
            onChange={e => setSelYear(parseInt(e.target.value, 10))}
            className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Org selector for super_admin drill-down */}
          {tier === 'super_admin' && (
            <div className="flex items-center gap-2 ml-4">
              <Building2 className="w-4 h-4 text-blue-600" />
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by name or domain…"
                  value={orgSearch || (selectedOrgId ? (orgs.find(o => o.id === selectedOrgId)?.name ?? '') : '')}
                  onFocus={() => setOrgSearch('')}
                  onChange={e => { setOrgSearch(e.target.value); setSelectedOrgId(null); }}
                  className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 w-[260px] placeholder-slate-500"
                />
                {orgSearch.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-300 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                    <div
                      className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
                      onClick={() => { setSelectedOrgId(null); setOrgSearch(''); }}
                    >
                      All organizations
                    </div>
                    {orgs
                      .filter(o => {
                        const q = orgSearch.toLowerCase();
                        return o.name.toLowerCase().includes(q) || o.website.toLowerCase().includes(q);
                      })
                      .map(o => (
                        <div
                          key={o.id}
                          className="px-3 py-2 hover:bg-slate-100 cursor-pointer border-b border-slate-200 last:border-0"
                          onClick={() => { setSelectedOrgId(o.id); setOrgSearch(''); }}
                        >
                          <div className="text-sm text-slate-900 font-medium">{o.name}</div>
                          {o.website && <div className="text-xs text-slate-600">{o.website}</div>}
                        </div>
                      ))}
                    {orgs.filter(o => {
                      const q = orgSearch.toLowerCase();
                      return o.name.toLowerCase().includes(q) || o.website.toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-3 py-2 text-sm text-slate-600">No results</div>
                    )}
                  </div>
                )}
              </div>
              {selectedOrgId && (
                <button onClick={() => { setSelectedOrgId(null); setOrgSearch(''); }} className="text-slate-600 hover:text-slate-900 font-medium text-xs">✕</button>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 overflow-x-auto">
          <div className="flex gap-2 bg-white rounded-lg p-2 w-max min-w-full sm:w-fit border border-slate-200 shadow-sm">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === t.key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content - with section-specific colored borders for distinction */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 shadow-sm">
          {activeTab === 'overview' && tier === 'super_admin' && (
            <AllOrgsConsumptionTable
              year={selYear}
              month={selMonth}
              onSelectOrg={(orgId) => {
                setSelectedOrgId(orgId);
                setActiveTab('llm');
              }}
              infraTotalUsd={infraTotal}
            />
          )}

          {activeTab === 'llm' && (
            <div className="border-l-4 border-l-blue-600 pl-6">
              <LLMConsumptionPanel
                tier={tier}
                companyId={effectiveCompanyId ?? undefined}
                year={selYear}
                month={selMonth}
              />
            </div>
          )}

          {activeTab === 'apis' && (
            <div className="border-l-4 border-l-emerald-600 pl-6">
              <ApiConsumptionPanel
                tier={tier}
                companyId={effectiveCompanyId ?? undefined}
                year={selYear}
                month={selMonth}
              />
            </div>
          )}

          {activeTab === 'credits' && effectiveCompanyId && (
            <div className="border-l-4 border-l-purple-600 pl-6">
              <CreditsManagementPanel
                companyId={effectiveCompanyId}
                isSuperAdmin={tier === 'super_admin'}
              />
            </div>
          )}

          {activeTab === 'credits' && !effectiveCompanyId && tier === 'super_admin' && (
            <div className="py-12 flex flex-col items-center gap-4">
              <p className="text-slate-600 text-sm mb-2">Search for a company to grant or adjust credits</p>
              <div className="relative w-full max-w-sm">
                <input
                  type="text"
                  placeholder="Search by company name or website domain…"
                  value={orgSearch}
                  onChange={e => setOrgSearch(e.target.value)}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 placeholder-slate-500"
                  autoFocus
                />
                {orgSearch.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-300 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                    {orgs
                      .filter(o => {
                        const q = orgSearch.toLowerCase();
                        return o.name.toLowerCase().includes(q) || o.website.toLowerCase().includes(q);
                      })
                      .map(o => (
                        <div
                          key={o.id}
                          className="px-4 py-3 hover:bg-slate-100 cursor-pointer border-b border-slate-200 last:border-0"
                          onClick={() => { setSelectedOrgId(o.id); setOrgSearch(''); }}
                        >
                          <div className="text-sm text-slate-900 font-medium">{o.name}</div>
                          {o.website && <div className="text-xs text-slate-600 mt-0.5">{o.website}</div>}
                        </div>
                      ))}
                    {orgs.filter(o => {
                      const q = orgSearch.toLowerCase();
                      return o.name.toLowerCase().includes(q) || o.website.toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-4 py-3 text-sm text-slate-600">No companies found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'credits' && !effectiveCompanyId && tier !== 'super_admin' && (
            <div className="text-slate-600 text-sm text-center py-12">No organization context available.</div>
          )}

          {activeTab === 'plans' && tier === 'super_admin' && (
            <div className="space-y-0">
              <div className="border-b border-slate-200 pb-8">
                <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
                  <BarChart className="w-5 h-5 text-indigo-600" />
                  Plan Analytics
                </h3>
                <PlanAnalyticsPanel />
              </div>
              <div className="border-t border-slate-200 pt-8">
                <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg"><Tag className="w-5 h-5 text-purple-600" /></div>
                  Manage Plans & Pricing
                </h3>
                <PlansPricingPanel />
              </div>
            </div>
          )}

          {activeTab === 'infra' && tier === 'super_admin' && (
            <div className="border-l-4 border-l-amber-600 pl-6">
              <InfraConsumptionPanel
                onTotalChange={(total, orgCount) => {
                  setInfraTotal(total);
                  setInfraOrgCount(orgCount);
                }}
              />
            </div>
          )}

          {activeTab === 'redis' && tier === 'super_admin' && (
            <div className="border-l-4 border-l-red-600 pl-6">
              <RedisEfficiencyPanel />
            </div>
          )}

          {activeTab === 'activity_control' && tier === 'super_admin' && (
            <div className="border-l-4 border-l-orange-600 pl-6">
              <ActivityControlPanel companyId={effectiveCompanyId ?? undefined} />
            </div>
          )}

          {activeTab === 'external_apis' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-slate-900">External API Usage</h2>
                <button
                  onClick={loadExternalApis}
                  className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingExternalApis ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              {loadingExternalApis ? (
                <div className="flex items-center gap-2 text-slate-600 py-8">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : !effectiveCompanyId ? (
                <p className="text-slate-600 text-sm py-8">Select an organization to view external API usage.</p>
              ) : externalApis.length === 0 ? (
                <p className="text-slate-600 text-sm py-8">No external APIs configured for this organization.</p>
              ) : (
                <div className="space-y-4">
                  {externalApis.map((api: any) => {
                    const s = api.usage_summary;
                    const failureRate = s && s.request_count > 0 ? Math.round((s.failure_count / s.request_count) * 100) : 0;
                    return (
                      <div key={api.id} className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <div className="font-semibold text-slate-900">{api.name}</div>
                            <div className="text-xs text-slate-600 truncate">{api.base_url}</div>
                          </div>
                          {api.enabled_user_count != null && (
                            <span className="text-xs text-slate-600 shrink-0">{api.enabled_user_count} enabled</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                          {[
                            { label: 'Requests (14d)', value: s?.request_count ?? 0 },
                            { label: 'Successes',      value: s?.success_count ?? 0 },
                            { label: 'Failures',       value: s?.failure_count ?? 0 },
                            { label: 'Failure rate',   value: `${failureRate}%`, warn: failureRate > 10 },
                          ].map(({ label, value, warn }) => (
                            <div key={label} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                              <div className="text-xs text-slate-600">{label}</div>
                              <div className={`text-lg font-semibold mt-0.5 ${warn ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
                            </div>
                          ))}
                        </div>
                        {/* Daily bar chart */}
                        {Array.isArray(api.usage_daily) && api.usage_daily.length > 0 && (
                          <div>
                            <div className="text-xs text-slate-600 mb-2">Daily usage (14d)</div>
                            <div className="flex items-end gap-1 h-12">
                              {api.usage_daily.slice(-14).map((day: any) => {
                                const max = Math.max(1, ...api.usage_daily.map((d: any) => d.request_count || 0));
                                const h = Math.round(((day.request_count || 0) / max) * 44);
                                return (
                                  <div key={day.usage_date} className="flex-1 flex flex-col items-center gap-0.5" title={`${day.usage_date}: ${day.request_count} requests`}>
                                    <div className="w-full bg-blue-600 rounded-sm" style={{ height: `${h}px` }} />
                                    <span className="text-[8px] text-slate-500">{String(day.usage_date).slice(8)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Last error */}
                        {s?.last_error_message && (
                          <div className="mt-3 text-xs text-red-600">
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
