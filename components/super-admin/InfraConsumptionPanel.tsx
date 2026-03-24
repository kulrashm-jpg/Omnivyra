/**
 * InfraConsumptionPanel
 * Tracks monthly infrastructure costs (hosting, DB, Redis, CDN, email, etc.)
 * persisted in localStorage. Also shows system-detected cost from live metrics.
 * Emits combined total upward so AllOrgsConsumptionTable can compute per-head share.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Server, Edit3, Check, X, Plus, Trash2, RefreshCw, Cpu } from 'lucide-react';
import { getAuthToken } from '../../utils/getAuthToken';

const STORAGE_KEY = 'virality_infra_costs_v1';
const STARTER_PLAN_USD = 29;

interface InfraItem {
  id: string;
  label: string;
  costUsd: number;
}

interface SysEstimate {
  totalMonthlyEstimate: number;
  breakdown: Record<string, { estimatedMonthly: number }>;
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
  activeOrgs: number;
  perHeadUsd: number;
}

interface Props {
  /** Called whenever the combined infra total changes — used by parent to pass to All-Orgs table */
  onTotalChange?: (total: number, orgCount: number) => void;
}

const DEFAULT_ITEMS: InfraItem[] = [
  { id: 'hosting',   label: 'Hosting (Vercel / Railway)',  costUsd: 0 },
  { id: 'database',  label: 'Database (Supabase)',          costUsd: 0 },
  { id: 'cache',     label: 'Cache (Redis / Upstash)',      costUsd: 0 },
  { id: 'cdn',       label: 'CDN',                          costUsd: 0 },
  { id: 'email',     label: 'Email (Resend / SendGrid)',    costUsd: 0 },
  { id: 'other',     label: 'Other',                        costUsd: 0 },
];

function loadItems(): InfraItem[] {
  if (typeof window === 'undefined') return DEFAULT_ITEMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ITEMS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  return DEFAULT_ITEMS;
}

function saveItems(items: InfraItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

function uid() { return Math.random().toString(36).slice(2, 9); }

const confidenceColor = (c: SysEstimate['confidence']) =>
  c === 'high' ? 'text-emerald-400' : c === 'medium' ? 'text-yellow-400' : 'text-gray-500';

export default function InfraConsumptionPanel({ onTotalChange }: Props) {
  const [items, setItems] = useState<InfraItem[]>(DEFAULT_ITEMS);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; cost: string }>({ label: '', cost: '' });
  const [newLabel, setNewLabel] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  const [sysEst, setSysEst] = useState<SysEstimate | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysError, setSysError] = useState<string | null>(null);

  // Load manual items from localStorage after mount
  useEffect(() => { setItems(loadItems()); }, []);

  const update = (next: InfraItem[]) => { setItems(next); saveItems(next); };

  const startEdit = (item: InfraItem) => {
    setEditId(item.id);
    setDraft({ label: item.label, cost: String(item.costUsd) });
  };

  const commitEdit = () => {
    if (!editId) return;
    const cost = parseFloat(draft.cost) || 0;
    update(items.map(i => i.id === editId ? { ...i, label: draft.label.trim() || i.label, costUsd: cost } : i));
    setEditId(null);
  };

  const removeItem = (id: string) => update(items.filter(i => i.id !== id));

  const addItem = () => {
    const label = newLabel.trim();
    if (!label) return;
    update([...items, { id: uid(), label, costUsd: 0 }]);
    setNewLabel('');
    setAddingNew(false);
  };

  // Fetch system-detected estimate
  const loadSysEst = useCallback(async () => {
    setSysLoading(true);
    setSysError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/admin/consumption/infra-estimate', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setSysEst(await res.json());
    } catch (e: any) {
      setSysError(e.message);
    } finally {
      setSysLoading(false);
    }
  }, []);

  useEffect(() => { loadSysEst(); }, [loadSysEst]);

  // Notify parent whenever totals change
  const manualTotal = items.reduce((s, i) => s + i.costUsd, 0);
  const combinedTotal = manualTotal + (sysEst?.totalMonthlyEstimate ?? 0);
  const activeOrgs = sysEst?.activeOrgs ?? 0;

  useEffect(() => {
    onTotalChange?.(combinedTotal, activeOrgs);
  }, [combinedTotal, activeOrgs, onTotalChange]);

  const starterPct = (combinedTotal / STARTER_PLAN_USD) * 100;
  const breakEvenOrgs = combinedTotal > 0 ? Math.ceil(combinedTotal / STARTER_PLAN_USD) : 0;
  const perHeadUsd = activeOrgs > 0 ? combinedTotal / activeOrgs : 0;

  const barColor =
    starterPct >= 100 ? 'bg-red-500' :
    starterPct >= 50  ? 'bg-yellow-500' :
    'bg-emerald-500';
  const pctColor =
    starterPct >= 100 ? 'text-red-400' :
    starterPct >= 50  ? 'text-yellow-400' :
    'text-emerald-400';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">Infrastructure Costs</h2>
          <span className="text-xs text-gray-500 ml-1">monthly estimates</span>
        </div>
        <button
          onClick={loadSysEst}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${sysLoading ? 'animate-spin' : ''}`} />
          Refresh estimate
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Combined Monthly Infra</p>
          <p className="text-xl font-bold text-white">${combinedTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            manual ${manualTotal.toFixed(2)} + sys ${(sysEst?.totalMonthlyEstimate ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">vs Starter Plan Revenue</p>
          <p className={`text-xl font-bold ${pctColor}`}>{starterPct.toFixed(1)}%</p>
          <div className="mt-1.5 w-full bg-gray-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${barColor} transition-all`}
              style={{ width: `${Math.min(starterPct, 100)}%` }}
            />
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Break-even (Starter)</p>
          <p className="text-xl font-bold text-white">
            {breakEvenOrgs > 0 ? `${breakEvenOrgs} org${breakEvenOrgs !== 1 ? 's' : ''}` : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">at $29/mo each</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Per-Head Cost</p>
          <p className="text-xl font-bold text-sky-400">
            {perHeadUsd > 0 ? `$${perHeadUsd.toFixed(4)}` : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {activeOrgs > 0 ? `across ${activeOrgs} active orgs` : 'no org data'}
          </p>
        </div>
      </div>

      {/* System-detected estimate */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-gray-200">System-Detected Infra Cost</span>
            {sysEst && (
              <span className={`text-xs font-medium ${confidenceColor(sysEst.confidence)}`}>
                {sysEst.confidence} confidence
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">auto-detected from live metrics, read-only</span>
        </div>

        {sysLoading && (
          <div className="px-4 py-4 flex items-center gap-2 text-gray-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {sysError && (
          <div className="px-4 py-3 text-sm text-red-400">Failed to load: {sysError}</div>
        )}
        {!sysLoading && !sysError && sysEst && (
          <div className="divide-y divide-gray-800">
            {Object.entries(sysEst.breakdown)
              .sort(([, a], [, b]) => (b.estimatedMonthly ?? 0) - (a.estimatedMonthly ?? 0))
              .map(([key, svc]) => (
                <div key={key} className="px-4 py-3 flex items-center">
                  <span className="flex-1 text-sm text-gray-300 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className={`text-sm font-semibold w-20 text-right ${svc.estimatedMonthly > 0 ? 'text-violet-300' : 'text-gray-600'}`}>
                    {svc.estimatedMonthly > 0 ? `$${svc.estimatedMonthly.toFixed(2)}` : '—'}
                  </span>
                  <div className="w-4" />
                  <div className="w-4" />
                </div>
              ))}
            {/* System total */}
            <div className="px-4 py-3 flex items-center bg-gray-800/60">
              <span className="flex-1 text-sm font-semibold text-gray-200">System Total (est.)</span>
              <span className="text-sm font-bold text-violet-300 w-20 text-right">
                ${sysEst.totalMonthlyEstimate.toFixed(2)}
              </span>
              <div className="w-4" /><div className="w-4" />
            </div>
          </div>
        )}
      </div>

      {/* Manual line items */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-200">Manual Cost Entries</span>
          <button
            onClick={() => setAddingNew(true)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        <div className="divide-y divide-gray-800">
          {items.map((item) => (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3">
              {editId === item.id ? (
                <>
                  <input
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500"
                    value={draft.label}
                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                  />
                  <span className="text-gray-400 text-sm">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-violet-500"
                    value={draft.cost}
                    onChange={e => setDraft(d => ({ ...d, cost: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                    autoFocus
                  />
                  <button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-200">{item.label}</span>
                  <span className={`text-sm font-semibold w-20 text-right ${item.costUsd > 0 ? 'text-white' : 'text-gray-600'}`}>
                    {item.costUsd > 0 ? `$${item.costUsd.toFixed(2)}` : '—'}
                  </span>
                  <button onClick={() => startEdit(item)} className="p-1 text-gray-500 hover:text-gray-300"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => removeItem(item.id)} className="p-1 text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          ))}

          {addingNew && (
            <div className="px-4 py-3 flex items-center gap-3">
              <input
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500"
                placeholder="Category name"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') { setAddingNew(false); setNewLabel(''); } }}
                autoFocus
              />
              <button onClick={addItem} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setAddingNew(false); setNewLabel(''); }} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="px-4 py-3 flex items-center gap-3 bg-gray-800/60">
            <span className="flex-1 text-sm font-semibold text-gray-200">Manual Total</span>
            <span className="text-sm font-bold text-white w-20 text-right">${manualTotal.toFixed(2)}</span>
            <div className="w-4" /><div className="w-4" />
          </div>
        </div>
      </div>

      {/* Combined total callout */}
      <div className="bg-sky-900/30 border border-sky-700/40 rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-sky-300">Combined infra cost (manual + system-detected)</span>
        <span className="text-lg font-bold text-white">${combinedTotal.toFixed(2)} / mo</span>
      </div>
      {perHeadUsd > 0 && (
        <div className="bg-violet-900/20 border border-violet-700/30 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-violet-300">
            Per-head cost allocated to each of {activeOrgs} organizations
          </span>
          <span className="text-lg font-bold text-violet-200">${perHeadUsd.toFixed(4)} / mo</span>
        </div>
      )}

      <p className="text-xs text-gray-600 text-center">
        Manual entries are stored locally in your browser. System estimates are derived from live metrics.
      </p>
    </div>
  );
}
