/**
 * ActivityControlPanel — Activity Control tab in the super-admin Consumption page.
 *
 * Sections:
 *   1. Infrastructure Hard Limits — Redis daily commands cap, Redis memory cap,
 *      DB reads/writes advisory limits, LLM token budget.
 *   2. Activity Configuration — per job-type toggle + tuning, grouped by function,
 *      with optional per-company override mode.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  SlidersHorizontal, Database, Cpu, Zap, MemoryStick,
  Globe, FileText, MessageSquare, Radio, Send, RefreshCw,
  ChevronDown, ChevronRight, Save, RotateCcw, AlertTriangle,
  CheckCircle2, XCircle, Building2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InfraEffective {
  redis: { maxCommandsPerDay: number; maxMemoryBytes: number; maxMemoryMB: number };
  db:    { maxReadsPerDay: number; maxWritesPerDay: number };
  llm:   { maxTokensPerDay: number };
}

interface InfraConfig {
  redis: { maxCommandsPerDay: number; maxMemoryBytes: number };
  db:    { maxReadsPerDay: number; maxWritesPerDay: number };
  llm:   { maxTokensPerDay: number };
  updatedAt: string;
  updatedBy: string;
}

interface ActivityRow {
  job_type:          string;
  label:             string;
  group:             string;
  enabled:           boolean;
  priority:          number;
  frequency_minutes: number;
  max_concurrent:    number;
  daily_job_limit:   number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  // company mode extras
  global_enabled?:   boolean;
  has_override?:     boolean;
  source?:           'global' | 'override' | 'boosted';
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, React.ReactNode> = {
  'Website Analysis': <Globe className="w-4 h-4 text-blue-600" />,
  'Create Campaign':  <Radio className="w-4 h-4 text-purple-600" />,
  'Blog Create':      <FileText className="w-4 h-4 text-emerald-600" />,
  'Engagement':       <MessageSquare className="w-4 h-4 text-orange-600" />,
  'Post Publishing':  <Send className="w-4 h-4 text-rose-600" />,
  'Other':            <Cpu className="w-4 h-4 text-slate-500" />,
};

const GROUP_COLORS: Record<string, string> = {
  'Website Analysis': 'border-l-blue-500',
  'Create Campaign':  'border-l-purple-500',
  'Blog Create':      'border-l-emerald-500',
  'Engagement':       'border-l-orange-500',
  'Post Publishing':  'border-l-rose-500',
  'Other':            'border-l-slate-400',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function LimitInput({
  label, value, onChange, unit = '', min = 0, placeholder = '0 = unlimited',
}: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; min?: number; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          value={value === 0 ? '' : value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure Limits Section
// ─────────────────────────────────────────────────────────────────────────────

function InfraLimitsSection({ companyId }: { companyId?: string }) {
  const [config, setConfig]     = useState<InfraConfig | null>(null);
  const [effective, setEff]     = useState<InfraEffective | null>(null);
  const [dirty, setDirty]       = useState(false);
  const [saving, setSaving]     = useState(false);
  const [status, setStatus]     = useState<'idle' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg]     = useState('');
  const [loading, setLoading]   = useState(true);

  // Local editable state
  const [redisCmds, setRedisCmds]     = useState(0);
  const [redisMem, setRedisMem]       = useState(0);  // in MB
  const [dbReads, setDbReads]         = useState(0);
  const [dbWrites, setDbWrites]       = useState(0);
  const [llmTokens, setLlmTokens]     = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/super-admin/activity-control?type=infra_limits', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setConfig(data.config);
      setEff(data.effective);
      setRedisCmds(data.config.redis.maxCommandsPerDay);
      setRedisMem(Math.round(data.config.redis.maxMemoryBytes / (1024 * 1024)));
      setDbReads(data.config.db.maxReadsPerDay);
      setDbWrites(data.config.db.maxWritesPerDay);
      setLlmTokens(data.config.llm.maxTokensPerDay);
    } catch { /* non-fatal */ }
    finally { setLoading(false); setDirty(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true); setStatus('idle'); setErrMsg('');
    try {
      const res = await fetch('/api/super-admin/activity-control', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_infra_limits',
          limits: {
            redis: {
              maxCommandsPerDay: redisCmds,
              maxMemoryBytes:    redisMem * 1024 * 1024,
            },
            db:  { maxReadsPerDay: dbReads, maxWritesPerDay: dbWrites },
            llm: { maxTokensPerDay: llmTokens },
          },
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Save failed'); }
      setStatus('ok'); setDirty(false);
      await load();
    } catch (err: any) {
      setStatus('err'); setErrMsg(err.message);
    } finally { setSaving(false); }
  }

  function reset() {
    if (!config) return;
    setRedisCmds(config.redis.maxCommandsPerDay);
    setRedisMem(Math.round(config.redis.maxMemoryBytes / (1024 * 1024)));
    setDbReads(config.db.maxReadsPerDay);
    setDbWrites(config.db.maxWritesPerDay);
    setLlmTokens(config.llm.maxTokensPerDay);
    setDirty(false); setStatus('idle');
  }

  const markDirty = () => setDirty(true);

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-500 text-sm py-4"><RefreshCw className="w-4 h-4 animate-spin" /> Loading limits…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Infrastructure Hard Limits</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Set to 0 to use the environment-variable default. Redis limits are enforced in real time; DB/LLM limits are advisory alerts only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          )}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {status === 'ok' && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4" /> Limits saved and applied.
        </div>
      )}
      {status === 'err' && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <XCircle className="w-4 h-4" /> {errMsg}
        </div>
      )}

      {/* Redis */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-red-600" />
          <span className="text-sm font-semibold text-slate-800">Redis</span>
          {effective && (
            <span className="ml-auto text-xs text-slate-500">
              Effective: <strong>{effective.redis.maxCommandsPerDay.toLocaleString()} cmds/day</strong> · <strong>{effective.redis.maxMemoryMB} MB</strong>
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <LimitInput
            label="Max commands / day"
            value={redisCmds}
            unit="cmds"
            placeholder="e.g. 450000"
            onChange={v => { setRedisCmds(v); markDirty(); }}
          />
          <LimitInput
            label="Max memory"
            value={redisMem}
            unit="MB"
            placeholder="e.g. 256"
            onChange={v => { setRedisMem(v); markDirty(); }}
          />
        </div>
        {effective && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div className="text-slate-500">Daily cap</div>
              <div className="font-semibold text-slate-800">{effective.redis.maxCommandsPerDay.toLocaleString()} commands</div>
              {redisCmds === 0 && <div className="text-slate-400">(from env var)</div>}
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div className="text-slate-500">Memory cap</div>
              <div className="font-semibold text-slate-800">{effective.redis.maxMemoryMB} MB ({fmtBytes(effective.redis.maxMemoryBytes)})</div>
              {redisMem === 0 && <div className="text-slate-400">(from env var / default)</div>}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          The protection engine automatically throttles at 70%, slows queues at 85%, and blocks non-essential workers at 95% of these limits.
        </div>
      </div>

      {/* Database */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-slate-800">Database (Supabase)</span>
          <span className="ml-2 text-xs font-normal text-slate-500">Advisory — alerts only</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <LimitInput
            label="Max DB reads / day"
            value={dbReads}
            unit="rows"
            placeholder="0 = unlimited"
            onChange={v => { setDbReads(v); markDirty(); }}
          />
          <LimitInput
            label="Max DB writes / day"
            value={dbWrites}
            unit="rows"
            placeholder="0 = unlimited"
            onChange={v => { setDbWrites(v); markDirty(); }}
          />
        </div>
      </div>

      {/* LLM */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-slate-800">LLM Tokens</span>
          <span className="ml-2 text-xs font-normal text-slate-500">Advisory — alerts only</span>
        </div>
        <LimitInput
          label="Max LLM tokens / day"
          value={llmTokens}
          unit="tokens"
          placeholder="0 = unlimited"
          onChange={v => { setLlmTokens(v); markDirty(); }}
        />
      </div>

      {config && (
        <div className="text-xs text-slate-400 text-right">
          Last updated: {new Date(config.updatedAt).getTime() === 0 ? 'never' : new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Row
// ─────────────────────────────────────────────────────────────────────────────

function ActivityRowEditor({
  row, scopeMode, companyId, onSaved,
}: {
  row: ActivityRow;
  scopeMode: 'global' | 'company';
  companyId?: string;
  onSaved: () => void;
}) {
  const [enabled, setEnabled]       = useState(row.enabled);
  const [freq, setFreq]             = useState(row.frequency_minutes);
  const [dailyLimit, setDailyLimit] = useState(row.daily_job_limit ?? 0);
  const [maxConc, setMaxConc]       = useState(row.max_concurrent);
  const [saving, setSaving]         = useState(false);
  const [status, setStatus]         = useState<'idle' | 'ok' | 'err'>('idle');

  const dirty =
    enabled !== row.enabled ||
    freq !== row.frequency_minutes ||
    dailyLimit !== (row.daily_job_limit ?? 0) ||
    maxConc !== row.max_concurrent;

  async function save() {
    setSaving(true); setStatus('idle');
    try {
      const body: Record<string, unknown> = {
        enabled,
        frequency_minutes: freq,
        daily_job_limit:   dailyLimit,
        max_concurrent:    maxConc,
      };
      if (scopeMode === 'global') {
        body.action   = 'update_global_activity';
        body.job_type = row.job_type;
      } else {
        body.action     = 'update_company_activity';
        body.job_type   = row.job_type;
        body.company_id = companyId;
      }
      const res = await fetch('/api/super-admin/activity-control', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Save failed'); }
      setStatus('ok');
      onSaved();
    } catch { setStatus('err'); }
    finally { setSaving(false); }
  }

  return (
    <div className={`border rounded-lg px-4 py-3 ${enabled ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-75'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Toggle */}
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>

        {/* Label */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-slate-900">{row.label}</span>
          <span className="ml-2 text-xs text-slate-400">{row.job_type}</span>
          {scopeMode === 'company' && row.has_override && (
            <span className="ml-2 text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">custom override</span>
          )}
          {scopeMode === 'company' && !row.has_override && (
            <span className="ml-2 text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">global default</span>
          )}
        </div>

        {/* Frequency */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-500">Every</label>
          <input
            type="number"
            min={1}
            value={freq}
            onChange={e => setFreq(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
          <label className="text-xs text-slate-500">min</label>
        </div>

        {/* Daily limit */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-500">Daily cap</label>
          <input
            type="number"
            min={0}
            value={dailyLimit === 0 ? '' : dailyLimit}
            placeholder="∞"
            onChange={e => setDailyLimit(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-16 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Concurrency */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-500">Concur.</label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxConc}
            onChange={e => setMaxConc(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            className="w-12 border border-slate-300 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Save */}
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        )}
        {status === 'ok'  && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
        {status === 'err' && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Group
// ─────────────────────────────────────────────────────────────────────────────

function ActivityGroup({
  group, rows, scopeMode, companyId, onSaved,
}: {
  group: string;
  rows: ActivityRow[];
  scopeMode: 'global' | 'company';
  companyId?: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(true);
  const enabledCount = rows.filter(r => r.enabled).length;

  return (
    <div className={`border-l-4 ${GROUP_COLORS[group] ?? 'border-l-slate-300'} pl-4 space-y-2`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-1"
      >
        {GROUP_ICONS[group]}
        <span className="text-sm font-semibold text-slate-800">{group}</span>
        <span className="text-xs text-slate-500 ml-1">({enabledCount}/{rows.length} active)</span>
        <span className="ml-auto text-slate-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>
      {open && rows.map(r => (
        <ActivityRowEditor
          key={r.job_type}
          row={r}
          scopeMode={scopeMode}
          companyId={companyId}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Config Section
// ─────────────────────────────────────────────────────────────────────────────

function ActivityConfigSection({
  scopeMode, companyId,
}: {
  scopeMode: 'global' | 'company';
  companyId?: string;
}) {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = scopeMode === 'global'
        ? '/api/super-admin/activity-control?type=global_activities'
        : `/api/super-admin/activity-control?type=company_activities&company_id=${companyId}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setActivities(data.activities ?? []);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [scopeMode, companyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-500 text-sm py-4"><RefreshCw className="w-4 h-4 animate-spin" /> Loading activities…</div>;
  }

  // Group activities
  const grouped: Record<string, ActivityRow[]> = {};
  for (const row of activities) {
    if (!grouped[row.group]) grouped[row.group] = [];
    grouped[row.group].push(row);
  }

  const groupOrder = ['Website Analysis', 'Create Campaign', 'Blog Create', 'Engagement', 'Post Publishing', 'Other'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Activity Configuration
            {scopeMode === 'company' && <span className="ml-2 text-sm font-normal text-slate-500">— Company override</span>}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {scopeMode === 'global'
              ? 'Global defaults. Changes affect all companies that do not have a specific override.'
              : 'Per-company overrides. Leave at global default by not changing, or set a custom value to override.'}
          </p>
        </div>
        <button onClick={load} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {groupOrder
        .filter(g => grouped[g]?.length > 0)
        .map(g => (
          <ActivityGroup
            key={g}
            group={g}
            rows={grouped[g]}
            scopeMode={scopeMode}
            companyId={companyId}
            onSaved={load}
          />
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root panel
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** When provided, "Company Override" sub-tab becomes available. */
  companyId?: string;
}

type SubTab = 'infra' | 'global' | 'company';

export default function ActivityControlPanel({ companyId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('infra');

  const subTabs: { key: SubTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: 'infra',   label: 'Infrastructure Limits', icon: <SlidersHorizontal className="w-4 h-4" />, show: true },
    { key: 'global',  label: 'Global Activity Config', icon: <Globe className="w-4 h-4" />, show: true },
    { key: 'company', label: 'Company Override',       icon: <Building2 className="w-4 h-4" />, show: !!companyId },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-orange-600" />
          Activity Control
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Set hard limits on infrastructure resources and tune per-activity job scheduling.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {subTabs.filter(t => t.show).map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              subTab === t.key
                ? 'bg-orange-600 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div>
        {subTab === 'infra'   && <InfraLimitsSection companyId={companyId} />}
        {subTab === 'global'  && <ActivityConfigSection scopeMode="global" />}
        {subTab === 'company' && companyId && <ActivityConfigSection scopeMode="company" companyId={companyId} />}
      </div>
    </div>
  );
}
