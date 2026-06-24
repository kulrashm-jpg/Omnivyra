/**
 * /super-admin/customer-activation-workbench
 *
 * OPERATIONAL tooling (Phase 17) — the Customer Activation Workbench. Action-oriented (not an
 * analytics dashboard): per-customer milestone status, executable Action Cards, the Customer
 * Success Queue, and the First Customer Success Tracker. Read-only.
 */

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';
import type { WorkbenchResult, CustomerActivationRow, MilestoneStatus, MilestoneKey } from '../../backend/services/customerActivationWorkbenchService';

const STATUS_COLOR: Record<MilestoneStatus, string> = {
  COMPLETE: '#16794a',
  READY_NOW: '#9a6b00',
  BLOCKED: '#9a1f1f',
};
const STATUS_BG: Record<MilestoneStatus, string> = {
  COMPLETE: '#e3f5ec',
  READY_NOW: '#fbf2da',
  BLOCKED: '#fbe3e3',
};
const MILESTONES: MilestoneKey[] = ['PROFILE', 'DOMAIN', 'GA', 'GSC', 'TEAM'];

function Chip({ label, status }: { label: string; status: MilestoneStatus }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 78, padding: '4px 8px', margin: 2, borderRadius: 6, background: STATUS_BG[status], color: STATUS_COLOR[status], fontSize: 11, fontWeight: 600 }}>
      <span style={{ opacity: 0.75, fontSize: 10 }}>{label}</span>
      <span>{status}</span>
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ background: '#eee', borderRadius: 6, height: 10, width: 160, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16794a' : '#3b6fd4' }} />
    </div>
  );
}

function CustomerCard({ row }: { row: CustomerActivationRow }) {
  return (
    <div style={{ border: '1px solid #e3e3e8', borderRadius: 10, padding: 16, marginBottom: 12, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{row.company_name}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProgressBar pct={row.activation_pct} />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{row.activation_pct}%</span>
          <span style={{ color: '#666', fontSize: 12 }}>{row.completed_count}/{row.required_count}</span>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        {MILESTONES.map((m) => <Chip key={m} label={m} status={row.milestones[m]} />)}
      </div>
      {row.action_cards.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Action cards ({row.action_cards.length})</div>
          {row.action_cards.map((a) => (
            <div key={a.milestone} style={{ borderLeft: `3px solid ${a.owner === 'PRODUCT' ? '#9a1f1f' : '#9a6b00'}`, padding: '6px 10px', marginBottom: 6, background: '#fafafa', borderRadius: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.milestone}: {a.action}</div>
              <div style={{ fontSize: 12, color: '#555' }}>
                owner <b>{a.owner}</b> · <a href={a.execution_url}>{a.execution_url}</a> · done when <code>{a.completion_criteria}</code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerActivationWorkbenchPage() {
  const [data, setData] = useState<WorkbenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch('/api/super-admin/customer-activation-workbench');
        const json = (await res.json()) as WorkbenchResult;
        if (active) { setData(json); setLoading(false); }
      } catch (e) {
        if (active) { setError((e as Error)?.message ?? 'load failed'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <Head><title>Customer Activation Workbench</title></Head>
      <h1 style={{ fontSize: 22 }}>Customer Activation Workbench</h1>
      <p style={{ color: '#666', marginTop: 4 }}>Operational view — milestone status, executable action cards, and the path to the first activated customer. Read-only.</p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#9a1f1f' }}>Error: {error}</p>}

      {data && (
        <>
          {/* First Customer Success Tracker */}
          {data.tracker && (
            <section style={{ marginTop: 16, marginBottom: 24, padding: 16, border: '2px solid #3b6fd4', borderRadius: 10, background: '#f4f8ff' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#3b6fd4', letterSpacing: 0.5 }}>FIRST CUSTOMER SUCCESS TRACKER · TARGET</div>
              <CustomerCard row={data.tracker} />
              <div style={{ fontSize: 12, color: '#555' }}>
                Completed: {data.tracker.completed_count}/{data.tracker.required_count} ·
                Remaining: {data.tracker.remaining.join(', ') || 'none — ACTIVATED'} · {data.tracker.activation_pct}%
              </div>
            </section>
          )}

          {/* Customer Success Queue (sorted) */}
          <section>
            <h2 style={{ fontSize: 17 }}>Customer Success Queue <span style={{ color: '#888', fontWeight: 400, fontSize: 13 }}>({data.queue.length} customers, closest first)</span></h2>
            {data.queue.map((row) => <CustomerCard key={row.company_id} row={row} />)}
          </section>
        </>
      )}
    </div>
  );
}
