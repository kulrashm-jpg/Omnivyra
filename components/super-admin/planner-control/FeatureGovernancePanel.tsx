/**
 * Feature governance panel.
 *
 * Two views in one card:
 *   - registry table (existing features + per-rule expand)
 *   - add-feature / add-rule forms (inline, no separate dialog)
 *
 * Mutating operations all flow through `callFeature(body)` from the hook
 * which handles pendingAction + refetch. Remove-rule asks for a confirm
 * via inline button state (no full modal) since the action is bounded.
 */

import React, { useState } from 'react';
import { Card, SectionHeader, StatusBadge, TableCompact, relativeTimeMs } from './PrimitiveTiles';
import ConfirmDialog from './ConfirmDialog';
import type { FeatureEntry } from '../../../hooks/usePlannerControl';

type ScopeType = 'global' | 'org' | 'env' | 'instance' | 'percent';
type Effect = 'on' | 'off' | 'default';

const SCOPE_OPTS: ScopeType[] = ['global', 'org', 'env', 'instance', 'percent'];
const EFFECT_OPTS: Effect[] = ['on', 'off', 'default'];

export default function FeatureGovernancePanel({
  features,
  pendingAction,
  callFeature,
}: {
  features: FeatureEntry[];
  pendingAction: string | null;
  callFeature: (body: Record<string, unknown>) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<null | { featureKey: string; ruleId: string }>(null);

  // New-feature form state
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDefault, setNewDefault] = useState(false);

  // New-rule form state (per-feature)
  const [ruleDraft, setRuleDraft] = useState<Record<string, {
    scopeType: ScopeType; scopeValue: string; percent: string; effect: Effect; note: string;
  }>>({});

  const toggle = (k: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const getRuleDraft = (key: string) => ruleDraft[key] ?? {
    scopeType: 'global' as ScopeType,
    scopeValue: '',
    percent: '',
    effect: 'on' as Effect,
    note: '',
  };

  const setRuleDraftFor = (key: string, patch: Partial<{
    scopeType: ScopeType; scopeValue: string; percent: string; effect: Effect; note: string;
  }>) => {
    setRuleDraft((cur) => ({ ...cur, [key]: { ...getRuleDraft(key), ...patch } }));
  };

  const submitRegister = () => {
    if (!newKey.trim()) return;
    callFeature({
      action: 'register',
      key: newKey.trim(),
      description: newDesc.trim(),
      default: newDefault,
    });
    setNewKey('');
    setNewDesc('');
    setNewDefault(false);
  };

  const submitAddRule = (featureKey: string) => {
    const d = getRuleDraft(featureKey);
    const body: Record<string, unknown> = {
      action: 'add_rule',
      featureKey,
      scopeType: d.scopeType,
      effect: d.effect,
    };
    if (d.scopeType === 'org' || d.scopeType === 'env' || d.scopeType === 'instance') {
      if (!d.scopeValue.trim()) return;
      body.scopeValue = d.scopeValue.trim();
    }
    if (d.scopeType === 'percent') {
      const n = Number(d.percent);
      if (!Number.isFinite(n) || n < 0 || n > 100) return;
      body.percent = n;
    }
    if (d.note.trim()) body.note = d.note.trim();
    callFeature(body);
    // Clear the per-feature draft so the form resets visually.
    setRuleDraft((cur) => {
      const next = { ...cur };
      delete next[featureKey];
      return next;
    });
  };

  return (
    <>
      <Card>
        <SectionHeader
          title="Feature governance"
          subtitle="Scoped runtime rollout — forced_off > forced_on > percent_on > default"
        />

        {/* New-feature form */}
        <div className="mb-3 p-2 rounded bg-slate-50 border border-slate-200">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">Register new feature</div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <input
              type="text"
              placeholder="feature key (e.g. streaming_drafting)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="sm:col-span-3 text-xs rounded border border-slate-300 px-2 py-1"
            />
            <input
              type="text"
              placeholder="description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="sm:col-span-6 text-xs rounded border border-slate-300 px-2 py-1"
            />
            <label className="sm:col-span-2 text-xs flex items-center gap-1.5">
              <input type="checkbox" checked={newDefault} onChange={(e) => setNewDefault(e.target.checked)} />
              default on
            </label>
            <button
              type="button"
              disabled={pendingAction !== null || !newKey.trim()}
              onClick={submitRegister}
              className="sm:col-span-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              {pendingAction === 'feature:register' ? '…' : 'Add'}
            </button>
          </div>
        </div>

        {/* Registry */}
        <TableCompact
          rows={features}
          empty="No features registered yet. Use the form above to add one."
          columns={[
            { key: 'key', label: 'Key', render: (f) => <span className="font-mono">{f.key}</span> },
            { key: 'desc', label: 'Description', render: (f) => <span className="text-slate-700">{f.description || '—'}</span> },
            {
              key: 'default', label: 'Default',
              render: (f) => f.default
                ? <StatusBadge tone="ok">on</StatusBadge>
                : <StatusBadge tone="neutral">off</StatusBadge>,
            },
            { key: 'rules', label: 'Rules', render: (f) => f.rules.length },
            { key: 'updated', label: 'Updated', render: (f) => relativeTimeMs(f.updated_at) },
            {
              key: 'actions', label: '',
              render: (f) => (
                <button
                  type="button"
                  onClick={() => toggle(f.key)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {expanded.has(f.key) ? 'Hide' : 'Rules'}
                </button>
              ),
            },
          ]}
        />

        {/* Expanded rules + add-rule form per feature */}
        {features.map((f) => expanded.has(f.key) && (
          <div key={`exp-${f.key}`} className="mt-2 p-2 rounded bg-slate-50 border border-slate-200">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">
              Rules for <span className="font-mono normal-case">{f.key}</span>
            </div>
            <TableCompact
              rows={f.rules}
              empty="No rules — feature evaluates to default."
              columns={[
                {
                  key: 'effect', label: 'Effect',
                  render: (r) => r.effect === 'on'
                    ? <StatusBadge tone="ok">on</StatusBadge>
                    : r.effect === 'off'
                    ? <StatusBadge tone="critical">off</StatusBadge>
                    : <StatusBadge tone="neutral">default</StatusBadge>,
                },
                { key: 'scope', label: 'Scope', render: (r) => <span className="font-mono">{r.scopeType}{r.scopeValue ? `=${r.scopeValue}` : ''}{r.percent != null ? `:${r.percent}%` : ''}</span> },
                { key: 'note', label: 'Note', render: (r) => r.note || '—' },
                { key: 'by', label: 'By', render: (r) => `${r.created_by ?? '—'} ${relativeTimeMs(r.created_at)}` },
                {
                  key: 'rm', label: '',
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove({ featureKey: f.key, ruleId: r.id })}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  ),
                },
              ]}
            />

            {/* Add-rule form */}
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-end">
              {(() => { const d = getRuleDraft(f.key); return (
                <>
                  <select
                    className="sm:col-span-2 text-xs rounded border border-slate-300 px-2 py-1"
                    value={d.scopeType}
                    onChange={(e) => setRuleDraftFor(f.key, { scopeType: e.target.value as ScopeType })}
                  >
                    {SCOPE_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {(d.scopeType === 'org' || d.scopeType === 'env' || d.scopeType === 'instance') && (
                    <input
                      type="text"
                      placeholder={`${d.scopeType} id…`}
                      className="sm:col-span-3 text-xs rounded border border-slate-300 px-2 py-1"
                      value={d.scopeValue}
                      onChange={(e) => setRuleDraftFor(f.key, { scopeValue: e.target.value })}
                    />
                  )}
                  {d.scopeType === 'percent' && (
                    <input
                      type="number" min={0} max={100}
                      placeholder="percent 0-100"
                      className="sm:col-span-2 text-xs rounded border border-slate-300 px-2 py-1"
                      value={d.percent}
                      onChange={(e) => setRuleDraftFor(f.key, { percent: e.target.value })}
                    />
                  )}
                  <select
                    className="sm:col-span-2 text-xs rounded border border-slate-300 px-2 py-1"
                    value={d.effect}
                    onChange={(e) => setRuleDraftFor(f.key, { effect: e.target.value as Effect })}
                  >
                    {EFFECT_OPTS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="note (audit)"
                    className="sm:col-span-3 text-xs rounded border border-slate-300 px-2 py-1"
                    value={d.note}
                    onChange={(e) => setRuleDraftFor(f.key, { note: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => submitAddRule(f.key)}
                    className="sm:col-span-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {pendingAction === 'feature:add_rule' ? '…' : 'Add rule'}
                  </button>
                </>
              ); })()}
            </div>
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove rule"
        description={
          confirmRemove
            ? <>Removing rule <code>{confirmRemove.ruleId.slice(0, 8)}</code> from feature <code>{confirmRemove.featureKey}</code>. This is appended to the feature audit trail.</>
            : ''
        }
        destructive
        pendingActionLabel={pendingAction === 'feature:remove_rule' ? 'Removing…' : null}
        onConfirm={(reason) => {
          if (confirmRemove) {
            callFeature({
              action: 'remove_rule',
              featureKey: confirmRemove.featureKey,
              ruleId: confirmRemove.ruleId,
              reason,
            });
          }
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  );
}
