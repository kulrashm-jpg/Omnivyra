'use client';

/**
 * CustomerReadinessDrawer — read-only company detail panel for the Customer
 * Readiness Console. No edit actions.
 */

import React from 'react';
import type {
  CompanyReadiness,
  ReadinessState,
  ReadinessArea,
} from '../../backend/services/customerReadinessService';
import type { DetectedOpportunity, OpportunitySeverity } from '../../backend/services/customerOpportunityService';
import type { PriorityTier } from '../../backend/services/customerOpportunityPriorityService';
import type { ExecutiveInsight } from '../../backend/services/customerExecutiveInsightService';
import type { CompanyEvolution } from '../../backend/services/customerEvolutionService';

type TenantWithOpportunities = CompanyReadiness & {
  opportunities?: DetectedOpportunity[];
  highest_severity?: OpportunitySeverity | null;
  priority_score?: number;
  priority_tier?: PriorityTier;
  narrative?: string;
  key_insight?: ExecutiveInsight | null;
  primary_blocker?: ExecutiveInsight | null;
  primary_opportunity?: ExecutiveInsight | null;
  insights?: ExecutiveInsight[];
  evolution?: CompanyEvolution | null;
};

function SeverityBadge({ s }: { s: OpportunitySeverity }) {
  const cls = s === 'HIGH' ? 'bg-red-50 text-red-600 border-red-200'
    : s === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{s}</span>;
}

const AREA_LABELS: Record<ReadinessArea, string> = {
  COMPANY_PROFILE: 'Company profile',
  WEBSITE: 'Website',
  GOOGLE_ANALYTICS: 'Google Analytics',
  GOOGLE_SEARCH_CONSOLE: 'Google Search Console',
  SOCIAL_INTEGRATIONS: 'Social integrations',
  COMMUNITY: 'Community',
  TEAM_MEMBERS: 'Team members',
  BILLING: 'Billing',
};

const AREA_FIELDS: [ReadinessArea, keyof CompanyReadiness][] = [
  ['COMPANY_PROFILE', 'company_profile_ready'],
  ['WEBSITE', 'website_ready'],
  ['GOOGLE_ANALYTICS', 'ga_ready'],
  ['GOOGLE_SEARCH_CONSOLE', 'gsc_ready'],
  ['SOCIAL_INTEGRATIONS', 'social_ready'],
  ['COMMUNITY', 'community_ready'],
  ['TEAM_MEMBERS', 'team_ready'],
  ['BILLING', 'billing_ready'],
];

function StateBadge({ state }: { state: ReadinessState }) {
  const cls = state === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : state === 'NOT_READY' ? 'bg-red-50 text-red-600 border-red-200'
    : 'bg-slate-100 text-slate-500 border-slate-200';
  const label = state === 'READY' ? 'Ready' : state === 'NOT_READY' ? 'Not ready' : 'Unknown';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toISOString().slice(0, 10);
}

export default function CustomerReadinessDrawer({ tenant, onClose }: { tenant: TenantWithOpportunities | null; onClose: () => void }) {
  if (!tenant) return null;
  const opportunities = tenant.opportunities ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#0B1F33]">{tenant.company_name}</h2>
            <p className="text-xs text-[#6B7C93]">{tenant.company_id}</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-[#6B7C93] hover:bg-slate-100">Close</button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {/* Readiness headline */}
          <div className="rounded-xl border border-[#0A66C2]/15 bg-[#EBF3FD] px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#0B1F33]">Overall readiness</span>
              <span className="text-2xl font-bold text-[#0A66C2]">{tenant.overall_readiness_score}%</span>
            </div>
            <p className="mt-1 text-xs text-[#6B7C93]">Status: <strong>{tenant.tenant_status}</strong> · Bucket: {tenant.readiness_bucket}</p>
            {tenant.priority_tier && (
              <p className="mt-1 text-xs text-[#6B7C93]">Priority: <strong>{tenant.priority_tier}</strong>{tenant.priority_tier !== 'READ_ONLY' ? ` (${tenant.priority_score})` : ''}</p>
            )}
          </div>

          {/* Executive summary (read-only insights) */}
          {(tenant.narrative || tenant.key_insight) && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Executive summary</h3>
              {tenant.narrative && <p className="text-sm text-[#0B1F33]">{tenant.narrative}</p>}
              <dl className="mt-2 space-y-1 text-xs">
                {tenant.key_insight && <div><dt className="inline text-[#6B7C93]">Key insight: </dt><dd className="inline text-[#0B1F33]">{tenant.key_insight.title} ({tenant.key_insight.severity}/{tenant.key_insight.confidence})</dd></div>}
                {tenant.primary_blocker && <div><dt className="inline text-[#6B7C93]">Primary blocker: </dt><dd className="inline text-[#0B1F33]">{tenant.primary_blocker.title}</dd></div>}
                {tenant.primary_opportunity && <div><dt className="inline text-[#6B7C93]">Primary opportunity: </dt><dd className="inline text-[#0B1F33]">{tenant.primary_opportunity.title}</dd></div>}
                {tenant.evolution && (
                  <div>
                    <dt className="inline text-[#6B7C93]">Trajectory: </dt>
                    <dd className="inline text-[#0B1F33]">
                      {tenant.evolution.trajectory}
                      {tenant.evolution.trajectory === 'UNKNOWN' ? ' (insufficient history)' : tenant.evolution.score_delta != null ? ` (${tenant.evolution.score_delta >= 0 ? '+' : ''}${tenant.evolution.score_delta})` : ''}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {/* Subscription */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Subscription</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[#6B7C93]">Plan</dt><dd className="text-[#0B1F33]">{tenant.plan}</dd>
              <dt className="text-[#6B7C93]">Billing</dt><dd><StateBadge state={tenant.billing_ready} /></dd>
            </dl>
          </section>

          {/* Users */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Users</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[#6B7C93]">Total members</dt><dd className="text-[#0B1F33]">{tenant.user_count}</dd>
              <dt className="text-[#6B7C93]">Active (30d)</dt><dd className="text-[#0B1F33]">{tenant.active_user_count_30d}</dd>
              <dt className="text-[#6B7C93]">Last activity</dt><dd className="text-[#0B1F33]">{fmtDate(tenant.last_activity_at)}</dd>
            </dl>
          </section>

          {/* Identity health */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Identity health</h3>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="text-[#0B1F33]">Website</span><StateBadge state={tenant.website_ready} />
            </div>
          </section>

          {/* Readiness checklist */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Readiness checklist</h3>
            <ul className="space-y-1.5">
              {AREA_FIELDS.map(([area, field]) => (
                <li key={area} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="text-[#0B1F33]">{AREA_LABELS[area]}</span>
                  <StateBadge state={tenant[field] as ReadinessState} />
                </li>
              ))}
            </ul>
          </section>

          {/* Missing areas */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">Missing areas</h3>
            {tenant.missing_areas.length === 0
              ? <p className="text-sm text-emerald-600">None — all known areas ready.</p>
              : <div className="flex flex-wrap gap-1.5">
                  {tenant.missing_areas.map((a) => (
                    <span key={a} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600 border border-red-200">{AREA_LABELS[a]}</span>
                  ))}
                </div>}
          </section>

          {/* Opportunities (read-only — detection only, no actions) */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">
              Opportunities ({opportunities.length})
            </h3>
            {opportunities.length === 0
              ? <p className="text-sm text-emerald-600">None detected.</p>
              : <ul className="space-y-2">
                  {opportunities.map((o) => (
                    <li key={o.type} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[#0B1F33]">{o.type}</span>
                        <SeverityBadge s={o.severity} />
                      </div>
                      <p className="mt-1 text-xs text-[#6B7C93]">{o.reason}</p>
                      <p className="mt-0.5 text-[10px] text-[#9AA7B8]">{o.evidence}</p>
                    </li>
                  ))}
                </ul>}
          </section>

          <p className="pt-2 text-xs text-[#9AA7B8]">Read-only view · no actions available.</p>
        </div>
      </div>
    </div>
  );
}
