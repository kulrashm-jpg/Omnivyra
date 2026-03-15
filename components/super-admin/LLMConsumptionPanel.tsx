import React, { useEffect, useState, useCallback } from 'react';
import { Brain, TrendingUp, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Layers } from 'lucide-react';

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
      const resp = await fetch(`/api/admin/consumption/llm?${params}`);
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

  if (!data) return null;

  const periodLabel = `${MONTH_NAMES[(data.period.month ?? 1) - 1]} ${data.period.year}`;

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
        <StatCard label="Input Tokens" value={fmtTokens(data.totals.input_tokens)} />
        <StatCard label="Errors" value={fmt(data.totals.error_count)} highlight={data.totals.error_count > 0} />
        {tier !== 'user' && data.totals.total_cost_usd != null && (
          <StatCard label="Total Cost (USD)" value={`$${data.totals.total_cost_usd.toFixed(4)}`} wide />
        )}
      </div>

      {/* By Model */}
      <Section
        title="By Model"
        expanded={expanded['model'] !== false}
        onToggle={() => toggleSection('model')}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left border-b border-gray-700">
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 font-medium text-right">Calls</th>
              <th className="pb-2 font-medium text-right">Tokens</th>
              <th className="pb-2 font-medium text-right">Errors</th>
              <th className="pb-2 font-medium text-right">Avg Latency</th>
              {tier !== 'user' && <th className="pb-2 font-medium text-right">Cost (USD)</th>}
              {tier === 'super_admin' && <th className="pb-2 font-medium text-right">Avg/Call</th>}
            </tr>
          </thead>
          <tbody>
            {data.by_model.map((m) => (
              <tr key={`${m.provider_name}::${m.model_name}`} className="border-b border-gray-800 hover:bg-gray-800/40">
                <td className="py-2 text-white">
                  <span className="text-gray-400 text-xs mr-1">{m.provider_name}</span>
                  {m.model_name}
                </td>
                <td className="py-2 text-right text-gray-300">{fmt(m.call_count)}</td>
                <td className="py-2 text-right text-gray-300">{fmtTokens(m.total_tokens)}</td>
                <td className={`py-2 text-right ${m.error_count > 0 ? 'text-red-400' : 'text-gray-500'}`}>{m.error_count}</td>
                <td className="py-2 text-right text-gray-400">{m.avg_latency_ms != null ? `${m.avg_latency_ms}ms` : '—'}</td>
                {tier !== 'user' && <td className="py-2 text-right text-emerald-400">{fmtUsd(m.total_cost_usd)}</td>}
                {tier === 'super_admin' && <td className="py-2 text-right text-gray-400 text-xs">{fmtUsd(m.avg_cost_per_call)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* By Operation (company_admin+) */}
      {tier !== 'user' && data.by_operation && data.by_operation.length > 0 && (
        <Section
          title="By Operation"
          expanded={!!expanded['op']}
          onToggle={() => toggleSection('op')}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700">
                <th className="pb-2 font-medium">Operation</th>
                <th className="pb-2 font-medium text-right">Calls</th>
                <th className="pb-2 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.by_operation.map((o) => (
                <tr key={o.process_type} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-2 font-mono text-xs text-gray-300">{o.process_type}</td>
                  <td className="py-2 text-right text-gray-300">{fmt(o.call_count)}</td>
                  <td className="py-2 text-right text-gray-300">{fmtTokens(o.total_tokens)}</td>
                  <td className="py-2 text-right text-emerald-400">{fmtUsd(o.total_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

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
                <th className="pb-2 font-medium text-right">Cost (USD)</th>
                <th className="pb-2 font-medium text-right">% of Cost</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalCost = data.by_feature_area!.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0);
                return data.by_feature_area!.map((fa) => {
                  const pct = totalCost > 0 ? ((fa.total_cost_usd ?? 0) / totalCost) * 100 : 0;
                  return (
                    <tr key={fa.feature_area} className="border-b border-gray-800 hover:bg-gray-800/40">
                      <td className="py-2 text-white">
                        <span className="mr-2">{FEATURE_AREA_EMOJI[fa.feature_area] ?? '⚙️'}</span>
                        {fa.feature_area}
                      </td>
                      <td className="py-2 text-right text-gray-300">{fmt(fa.call_count)}</td>
                      <td className="py-2 text-right text-gray-300">{fmtTokens(fa.total_tokens)}</td>
                      <td className="py-2 text-right text-emerald-400">{fmtUsd(fa.total_cost_usd)}</td>
                      {(
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
                <th className="pb-2 font-medium">User ID</th>
                <th className="pb-2 font-medium text-right">Calls</th>
                <th className="pb-2 font-medium text-right">Tokens</th>
                <th className="pb-2 font-medium text-right">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.by_user.map((u) => (
                <tr key={u.user_id ?? '__system__'} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-2 font-mono text-xs text-gray-300">{u.user_id ?? 'system'}</td>
                  <td className="py-2 text-right text-gray-300">{fmt(u.call_count)}</td>
                  <td className="py-2 text-right text-gray-300">{fmtTokens(u.total_tokens)}</td>
                  <td className="py-2 text-right text-emerald-400">{fmtUsd(u.total_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value, wide = false, highlight = false }: {
  label: string; value: string; wide?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-red-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function Section({ title, expanded, onToggle, children, icon }: {
  title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/60 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700/40 rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
          {icon}{title}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && <div className="px-4 pb-4 overflow-x-auto">{children}</div>}
    </div>
  );
}
