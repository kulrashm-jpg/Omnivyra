/**
 * /super-admin/consumption
 * Unified LLM + API consumption and credits management hub.
 *
 * Access tiers:
 *   super_admin   — all orgs overview + full cost analysis + credits management
 *   company_admin — own org only, expense view (cost + credits, no cross-org)
 *   user          — own org only, token counts only (no costs shown)
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Brain, Zap, Coins, Building2, Calendar } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { supabase } from '../../utils/supabaseClient';
import LLMConsumptionPanel from '../../components/super-admin/LLMConsumptionPanel';
import ApiConsumptionPanel from '../../components/super-admin/ApiConsumptionPanel';
import CreditsManagementPanel from '../../components/super-admin/CreditsManagementPanel';
import AllOrgsConsumptionTable from '../../components/super-admin/AllOrgsConsumptionTable';

type ActiveTab = 'overview' | 'llm' | 'apis' | 'credits';
type Tier = 'super_admin' | 'company_admin' | 'user';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ConsumptionPage() {
  const router = useRouter();
  const { selectedCompanyId: ctxCompanyId, userRole } = useCompanyContext();

  const [tier, setTier] = useState<Tier>('user');
  const [activeTab, setActiveTab] = useState<ActiveTab>('llm');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

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

  const tabs = ([
    { key: 'overview' as ActiveTab, label: 'All Orgs', icon: <Building2 className="w-4 h-4" />, superAdminOnly: true },
    { key: 'llm' as ActiveTab,      label: 'LLM Usage',  icon: <Brain className="w-4 h-4" /> },
    { key: 'apis' as ActiveTab,     label: 'API Calls',  icon: <Zap className="w-4 h-4" /> },
    { key: 'credits' as ActiveTab,  label: 'Credits',    icon: <Coins className="w-4 h-4" /> },
  ] as { key: ActiveTab; label: string; icon: React.ReactNode; superAdminOnly?: boolean }[]).filter(t => !t.superAdminOnly || tier === 'super_admin');

  const yearOptions = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Consumption Analytics</h1>
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
        <div className="flex gap-1 mb-6 bg-gray-800/50 rounded-xl p-1 w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
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
        </div>
      </div>
    </div>
  );
}
