/**
 * /super-admin/customer-activation-operations
 *
 * OPERATIONAL execution surface (Phase 20) — tracks the execution of activation work, not
 * analytics. Per customer: milestone status, activation %, outreach workflow state (editable),
 * and the activity log (append notes). Mutations hit the isolated tracking tables.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';
import type { ActivationOperationRow, OutreachState } from '../../backend/services/customerActivationOperationsService';
import type { MilestoneStatus, MilestoneKey } from '../../backend/services/customerActivationWorkbenchService';

const STATES: OutreachState[] = ['NOT_CONTACTED', 'CONTACTED', 'CUSTOMER_RESPONDED', 'IN_PROGRESS', 'ACTIVATED'];
const MILESTONES: MilestoneKey[] = ['PROFILE', 'DOMAIN', 'GA', 'GSC', 'TEAM'];
const SC: Record<MilestoneStatus, string> = { COMPLETE: '#16794a', READY_NOW: '#9a6b00', BLOCKED: '#9a1f1f' };
const SB: Record<MilestoneStatus, string> = { COMPLETE: '#e3f5ec', READY_NOW: '#fbf2da', BLOCKED: '#fbe3e3' };

export default function CustomerActivationOperationsPage() {
  const [rows, setRows] = useState<ActivationOperationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/customer-activation-operations');
      const json = await res.json();
      setRows(json.operations ?? []);
    } catch (e) { setError((e as Error)?.message ?? 'load failed'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await apiFetch('/api/super-admin/customer-activation-operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.operations) setRows(json.operations);
      else if (json.error) setError(json.error);
    } catch (e) { setError((e as Error)?.message ?? 'action failed'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <Head><title>Customer Activation Operations</title></Head>
      <h1 style={{ fontSize: 22 }}>Customer Activation Operations</h1>
      <p style={{ color: '#666', marginTop: 4 }}>Execution tracking for activation work — outreach state, activity log, milestone progress. Operational, not analytics.</p>
      {error && <p style={{ color: '#9a1f1f' }}>Error: {error}</p>}
      {!rows && <p>Loading…</p>}

      {rows && rows.map((r) => (
        <div key={r.company_id} style={{ border: '1px solid #e3e3e8', borderRadius: 10, padding: 16, marginBottom: 14, background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{r.company_name}{r.is_activated && <span style={{ color: '#16794a' }}> ✓ ACTIVATED</span>}</strong>
            <span style={{ fontWeight: 700 }}>{r.activation_percent}% · {r.completed_milestones.length}/{MILESTONES.length}</span>
          </div>

          <div style={{ marginTop: 8 }}>
            {MILESTONES.map((m) => (
              <span key={m} style={{ display: 'inline-block', minWidth: 70, textAlign: 'center', padding: '3px 8px', margin: 2, borderRadius: 6, background: SB[r.milestones[m]], color: SC[r.milestones[m]], fontSize: 11, fontWeight: 600 }}>
                {m}<br />{r.milestones[m]}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555' }}>Workflow state:</label>
            <select
              value={r.current_state}
              disabled={busy === r.company_id}
              onChange={(e) => post({ action: 'set_state', company_id: r.company_id, state: e.target.value }, r.company_id)}
              style={{ padding: '4px 8px', borderRadius: 6 }}
            >
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 12, color: '#888' }}>last activity: {r.last_activity_date ? new Date(r.last_activity_date).toLocaleString() : '—'}</span>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <input
              placeholder="Log a note / activity…"
              value={noteDraft[r.company_id] ?? ''}
              onChange={(e) => setNoteDraft((d) => ({ ...d, [r.company_id]: e.target.value }))}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <button
              disabled={busy === r.company_id || !(noteDraft[r.company_id] ?? '').trim()}
              onClick={() => { post({ action: 'add_activity', company_id: r.company_id, activity_type: 'NOTE', notes: noteDraft[r.company_id] }, r.company_id); setNoteDraft((d) => ({ ...d, [r.company_id]: '' })); }}
              style={{ padding: '6px 12px', borderRadius: 6 }}
            >Add</button>
          </div>

          {r.recent_activity.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div style={{ color: '#666', marginBottom: 4 }}>Activity log</div>
              {r.recent_activity.map((a, i) => (
                <div key={a.id ?? i} style={{ borderTop: '1px solid #f0f0f0', padding: '4px 0', color: '#444' }}>
                  <b>{a.activity_type}</b> {a.status ? `→ ${a.status}` : ''} · {new Date(a.activity_date).toLocaleString()} · {a.owner ?? '—'}{a.notes ? ` — ${a.notes}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
