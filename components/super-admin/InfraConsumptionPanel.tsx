/**
 * InfraConsumptionPanel
 * Tracks monthly infrastructure costs (hosting, DB, Redis, CDN, email, etc.)
 * persisted in localStorage. Shows total infra spend vs Starter plan revenue.
 */
import React, { useState, useEffect } from 'react';
import { Server, Edit3, Check, X, Plus, Trash2 } from 'lucide-react';

const STORAGE_KEY = 'virality_infra_costs_v1';
const STARTER_PLAN_USD = 29;

interface InfraItem {
  id: string;
  label: string;
  costUsd: number;
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

export default function InfraConsumptionPanel() {
  const [items, setItems] = useState<InfraItem[]>(DEFAULT_ITEMS);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ label: string; cost: string }>({ label: '', cost: '' });
  const [newLabel, setNewLabel] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  // Load from localStorage after mount
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

  const totalUsd = items.reduce((s, i) => s + i.costUsd, 0);
  const starterPct = (totalUsd / STARTER_PLAN_USD) * 100;
  const breakEvenOrgs = totalUsd > 0 ? Math.ceil(totalUsd / STARTER_PLAN_USD) : 0;

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
      <div className="flex items-center gap-2">
        <Server className="w-5 h-5 text-sky-400" />
        <h2 className="text-lg font-semibold text-white">Infrastructure Costs</h2>
        <span className="text-xs text-gray-500 ml-1">monthly estimates, stored locally</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Total Monthly Infra</p>
          <p className="text-xl font-bold text-white">${totalUsd.toFixed(2)}</p>
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
          <p className="text-xs text-gray-400 mb-1">Cost per Org (10 orgs)</p>
          <p className="text-xl font-bold text-white">
            {totalUsd > 0 ? `$${(totalUsd / 10).toFixed(2)}` : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">infra share</p>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-gray-800/60 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-200">Cost Breakdown</span>
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
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-violet-500"
                    value={draft.cost}
                    onChange={e => setDraft(d => ({ ...d, cost: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditId(null); }}
                    autoFocus
                  />
                  <button onClick={commitEdit} className="p-1 text-emerald-400 hover:text-emerald-300">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditId(null)} className="p-1 text-gray-500 hover:text-gray-300">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-200">{item.label}</span>
                  <span className={`text-sm font-semibold w-20 text-right ${item.costUsd > 0 ? 'text-white' : 'text-gray-600'}`}>
                    {item.costUsd > 0 ? `$${item.costUsd.toFixed(2)}` : '—'}
                  </span>
                  <button onClick={() => startEdit(item)} className="p-1 text-gray-500 hover:text-gray-300">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeItem(item.id)} className="p-1 text-gray-600 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}

          {/* New item row */}
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
              <button onClick={addItem} className="p-1 text-emerald-400 hover:text-emerald-300">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => { setAddingNew(false); setNewLabel(''); }} className="p-1 text-gray-500 hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Total row */}
          <div className="px-4 py-3 flex items-center gap-3 bg-gray-800/60">
            <span className="flex-1 text-sm font-semibold text-gray-200">Total</span>
            <span className="text-sm font-bold text-white w-20 text-right">${totalUsd.toFixed(2)}</span>
            <div className="w-4" /><div className="w-4" />
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">
        These figures are stored locally in your browser and are not synced to the database.
      </p>
    </div>
  );
}
