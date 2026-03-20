import React, { useEffect, useState, useCallback } from 'react';
import { Brain, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Layers, AlertTriangle } from 'lucide-react';
import { supabase } from '../../utils/supabaseClient';

// 1 credit = $0.01 USD (platform default credit rate)
const CREDIT_RATE = 0.01;
const toCr = (usd: number | null | undefined): number | null =>
  usd == null ? null : usd / CREDIT_RATE;
const fmtCr = (n: number | null | undefined): string => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
};

const FEATURE_AREA_EMOJI: Record<string, string> = {
  'Company Profile':      '🏢',
  'Recommendations':      '💡',
  'Strategic Theme Cards':'🎯',
  'Campaign Planning':    '📅',
  'Daily Plan':           '📋',
  'Activity Workspace':   '✍️',
  'AI Chat':              '💬',
  'Engagement':           '🤝',
  'Insights':             '🔍',
  'Other':                '⚙️',
};

interface ModelRow {
  model_name: string;
  provider_name: string;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_latency_ms: number | null;
  error_count: number;
  total_cost_usd?: number | null;
  avg_cost_per_call?: number | null;
}

interface OperationRow {
  process_type: string;
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

interface FeatureAreaRow {
  feature_area: string;
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

interface UserRow {
  user_id: string | null;
  email?: string | null;
  user_type: 'member' | 'guest' | 'system';
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

interface LlmData {
  organization_id: string;
  period: { year: number; month: number };
  totals: {
    call_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    error_count: number;
    total_cost_usd?: number | null;
  };
  by_model: ModelRow[];
  by_operation?: OperationRow[];
  by_feature_area?: FeatureAreaRow[];
  by_user?: UserRow[];
}

interface Props {
  tier: 'super_admin' | 'company_admin' | 'user';
  companyId?: string;
  year?: number;
  month?: number;
}

const fmt = (n: number) => n.toLocaleString();
const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toFixed(4)}`;
const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function LLMConsumptionPanel({ tier, companyId, year, month }: Props) {
  const [data, setData] = useState<LlmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (year) params.set('year', String(year));
    if (month) params.set('month', String(month));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`/api/admin/consumption/llm?${params}`, {
        credentials: 'include',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      const json = await resp.json();
      setData(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, year, month]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading LLM consumption…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 py-8">
        <AlertCircle className="w-5 h-5" /> {error}
      </div>
    );
  }

  if (!data || Array.isArray(data)) {
    if (tier === 'super_admin' && !companyId) {
      return (
        <p className="text-gray-400 text-sm py-8 text-center">
          Select an organization from the <strong>All Orgs</strong> tab to view LLM details.
        </p>
      );
    }
    return null;
  }

  const periodMonth = data.period?.month ?? month ?? new Date().getMonth() + 1;
  const periodYear  = data.period?.year  ?? year  ?? new Date().getFullYear();
  const periodLabel = `${MONTH_NAMES[(periodMonth - 1)]} ${periodYear}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">LLM Consumption — {periodLabel}</h2>
        </div>
        <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Calls" value={fmt(data.totals.call_count)} />
        <StatCard label="Total Tokens" value={fmtTokens(data.totals.total_tokens)} />
        <StatCard label="Input / Output" value={`${fmtTokens(data.totals.input_tokens)} / ${fmtTokens(data.totals.output_tokens)}`} />
        <StatCard label="Errors" value={fmt(data.totals.error_count)} highlight={data.totals.error_count > 0} />
        {tier !== 'user' && data.totals.total_cost_usd != null && (
          <StatCostCard
            credits={toCr(data.totals.total_cost_usd)!}
            usd={data.totals.total_cost_usd}
            label="Platform Cost"
          />
        )}
        {tier !== 'user' && data.totals.total_cost_usd != null && data.totals.call_count > 0 && (
          <StatCard
            label="Avg Cost / Call"
            value={`${fmtCr(toCr(data.totals.total_cost_usd)! / data.totals.call_count)} cr`}
            sub={`$${(data.totals.total_cost_usd / data.totals.call_count).toFixed(5)}`}
          />
        )}
      </div>

      {/* By Model — "the one number" per model is its total credits consumed */}
      <Section
        title="By Model"
        expanded={expanded['model'] !== false}
        onToggle={() => toggleSection('model')}
        badge={`${data.by_model.length} model${data.by_model.length !== 1 ? 's' : ''}`}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left border-b border-gray-700">
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 font-medium text-right">Calls</th>
              <th className="pb-2 font-medium text-right">Tokens</th>
              <th className="pb-2 font-medium text-right">Errors</th>
              <th className="pb-2 font-medium text-right">Avg Latency</th>
              {tier !== 'user' && <th className="pb-2 font-medium text-right text-amber-400">Credits Used</th>}
              {tier !== 'user' && <th className="pb-2 font-medium text-right">cr / 1K tokens</th>}
              {tier === 'super_admin' && <th className="pb-2 font-medium text-right text-gray-500">USD</th>}
            </tr>
          </thead>
          <tbody>
            {data.by_model.map((m) => {
              const cr = toCr(m.total_cost_usd);
              const crPer1K = cr != null && m.total_tokens > 0
                ? (cr / m.total_tokens) * 1000
                : null;
              return (
                <tr key={`${m.provider_name}::${m.model_name}`} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-2 text-white">
                    <span className="text-gray-500 text-xs mr-1">{m.provider_name}</span>
                    <span className="font-medium">{m.model_name}</span>
                  </td>
                  <td className="py-2 text-right text-gray-300">{fmt(m.call_count)}</td>
                  <td className="py-2 text-right text-gray-300">{fmtTokens(m.total_tokens)}</td>
                  <td className={`py-2 text-right ${m.error_count > 0 ? 'text-red-400' : 'text-gray-500'}`}>{m.error_count}</td>
                  <td className="py-2 text-right text-gray-400">{m.avg_latency_ms != null ? `${m.avg_latency_ms}ms` : '—'}</td>
                  {tier !== 'user' && (
                    <td className="py-2 text-right">
                      <span className="font-semibold text-amber-400">{fmtCr(cr)} cr</span>
                    </td>
                  )}
                  {tier !== 'user' && (
                    <td className="py-2 text-right text-gray-400 text-xs">
                      {crPer1K != null ? `${crPer1K.toFixed(2)}` : '—'}
                    </td>
                  )}
                  {tier === 'super_admin' && (
                    <td className="py-2 text-right text-gray-500 text-xs">{fmtUsd(m.total_cost_usd)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* By Operation — leakage detector: unexpected ops consuming LLM will stand out */}
      {tier !== 'user' && data.by_operation && data.by_operation.length > 0 && (() => {
        const totalOpCalls = data.by_operation.reduce((s, o) => s + o.call_count, 0);
        const totalOpCost = data.by_operation.reduce((s, o) => s + (o.total_cost_usd ?? 0), 0);
        // Flag any operation consuming > 30% of total calls — potential dominant consumer / leakage
        const leakageThreshold = totalOpCalls * 0.30;
        const hasLeakage = data.by_operation.some(o => o.call_count > leakageThreshold && data.by_operation!.length > 1);
        return (
          <Section
            title="By Operation"
            expanded={expanded['op'] !== false}
            onToggle={() => toggleSection('op')}
            badge={hasLeakage ? '⚠ leakage risk' : `${data.by_operation.length} ops`}
            badgeColor={hasLeakage ? 'text-yellow-400' : undefined}
          >
            {hasLeakage && (
              <div className="mb-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                One or more operations are consuming &gt;30% of LLM calls — verify these are expected.
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="pb-2 font-medium">Operation</th>
                  <th className="pb-2 font-medium text-right">Calls</th>
                  <th className="pb-2 font-medium text-right">% of calls</th>
                  <th className="pb-2 font-medium text-right">Tokens</th>
                  <th className="pb-2 font-medium text-right text-amber-400">Credits</th>
                  <th className="pb-2 font-medium text-right">cr / call</th>
                </tr>
              </thead>
              <tbody>
                {[...data.by_operation].sort((a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0)).map((o) => {
                  const callPct = totalOpCalls > 0 ? (o.call_count / totalOpCalls) * 100 : 0;
                  const cr = toCr(o.total_cost_usd);
                  const crPerCall = cr != null && o.call_count > 0 ? cr / o.call_count : null;
                  const isDominant = o.call_count > leakageThreshold && data.by_operation!.length > 1;
                  return (
                    <tr key={o.process_type} className={`border-b border-gray-800 hover:bg-gray-800/40 ${isDominant ? 'bg-yellow-400/5' : ''}`}>
                      <td className="py-2 flex items-center gap-1.5">
                        {isDominant && <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />}
                        <span className="font-mono text-xs text-gray-300">{o.process_type}</span>
                      </td>
                      <td className="py-2 text-right text-gray-300">{fmt(o.call_count)}</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 bg-gray-700 rounded-full h-1">
                            <div className={`h-1 rounded-full ${isDominant ? 'bg-yellow-400' : 'bg-violet-500'}`}
                              style={{ width: `${Math.min(callPct, 100)}%` }} />
                          </div>
                          <span className="text-gray-400 text-xs w-8 text-right">{callPct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-gray-300">{fmtTokens(o.total_tokens)}</td>
                      <td className="py-2 text-right font-semibold text-amber-400">{fmtCr(cr)} cr</td>
                      <td className="py-2 text-right text-gray-400 text-xs">{crPerCall != null ? crPerCall.toFixed(2) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {totalOpCost > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-700">
                    <td colSpan={4} className="pt-2 text-xs text-gray-500">Total</td>
                    <td className="pt-2 text-right font-bold text-amber-400">{fmtCr(toCr(totalOpCost))} cr</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </Section>
        );
      })()}

      {/* By Feature Area (company_admin+) */}
      {tier !== 'user' && data.by_feature_area && data.by_feature_area.length > 0 && (
        <Section
          title="By Feature Area"
          expanded={expanded['feature'] !== false}
          onToggle={() => toggleSection('feature')}
          icon={<Layers className="w-4 h-4 text-violet-400" />}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700">
                <th className="pb-2 font-medium">Feature</th>
                <th className="pb-2 font-medium text-right">AI Calls</th>
                <th className="pb-2 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right text-amber-400">Credits</th>
                <th className="pb-2 font-medium text-right">% of Cost</th>
                {tier === 'super_admin' && <th className="pb-2 font-medium text-right text-gray-500">USD</th>}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalCost = data.by_feature_area!.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0);
                return data.by_feature_area!.map((fa) => {
                  const pct = totalCost > 0 ? ((fa.total_cost_usd ?? 0) / totalCost) * 100 : 0;
                  const cr = toCr(fa.total_cost_usd);
                  return (
                    <tr key={fa.feature_area} className="border-b border-gray-800 hover:bg-gray-800/40">
                      <td className="py-2 text-white">
                        <span className="mr-2">{FEATURE_AREA_EMOJI[fa.feature_area] ?? '⚙️'}</span>
                        {fa.feature_area}
                      </td>
                      <td className="py-2 text-right text-gray-300">{fmt(fa.call_count)}</td>
                      <td className="py-2 text-right text-gray-300">{fmtTokens(fa.total_tokens)}</td>
                      <td className="py-2 text-right font-semibold text-amber-400">{fmtCr(cr)} cr</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-700 rounded-full h-1.5">
                            <div
                              className="bg-violet-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(pct, 100).toFixed(1)}%` }}
                            />
                          </div>
                          <span className="text-gray-400 text-xs w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      {tier === 'super_admin' && (
                        <td className="py-2 text-right text-gray-500 text-xs">{fmtUsd(fa.total_cost_usd)}</td>
                      )}
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </Section>
      )}

      {/* By User (super_admin only) */}
      {tier === 'super_admin' && data.by_user && data.by_user.length > 0 && (
        <Section
          title="By User"
          expanded={!!expanded['user']}
          onToggle={() => toggleSection('user')}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium text-right">Calls</th>
                <th className="pb-2 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right text-amber-400">Credits</th>
                <th className="pb-2 font-medium text-right text-gray-500">USD</th>
              </tr>
            </thead>
            <tbody>
              {data.by_user.map((u) => {
                const typeStyle =
                  u.user_type === 'member' ? 'bg-violet-500/20 text-violet-300' :
                  u.user_type === 'guest'  ? 'bg-blue-500/20 text-blue-300' :
                                             'bg-gray-700 text-gray-400';
                const displayName = u.email ?? (u.user_id ? `${u.user_id.slice(0, 8)}…` : 'system');
                return (
                  <tr key={u.user_id ?? '__system__'} className="border-b border-gray-800 hover:bg-gray-800/40">
                    <td className="py-2">
                      <span className="text-gray-200 text-xs">{displayName}</span>
                      {u.user_id && !u.email && (
                        <span className="block font-mono text-[10px] text-gray-600">{u.user_id}</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${typeStyle}`}>
                        {u.user_type}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-300">{fmt(u.call_count)}</td>
                    <td className="py-2 text-right text-gray-300">{fmtTokens(u.total_tokens)}</td>
                    <td className="py-2 text-right font-semibold text-amber-400">{fmtCr(toCr(u.total_cost_usd))} cr</td>
                    <td className="py-2 text-right text-gray-500 text-xs">{fmtUsd(u.total_cost_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, wide = false, highlight = false }: {
  label: string; value: string; sub?: string; wide?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-red-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatCostCard({ label, credits, usd }: { label: string; credits: number; usd: number }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-amber-400">{fmtCr(credits)} cr</p>
      <p className="text-xs text-gray-500 mt-0.5">{fmtUsd(usd)}</p>
    </div>
  );
}

function Section({ title, expanded, onToggle, children, icon, badge, badgeColor }: {
  title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
  icon?: React.ReactNode; badge?: string; badgeColor?: string;
}) {
  return (
    <div className="bg-gray-800/60 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700/40 rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
          {icon}{title}
          {badge && (
            <span className={`text-xs font-normal ${badgeColor ?? 'text-gray-500'}`}>{badge}</span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && <div className="px-4 pb-4 overflow-x-auto">{children}</div>}
    </div>
  );
}
