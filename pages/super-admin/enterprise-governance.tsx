/**
 * Enterprise Governance — Consolidated Admin Page
 *
 * Single-pane operator surface combining:
 *   - Executive summary headline + health grade
 *   - Approval queue + decision actions (approve/reject/archive/override)
 *   - Active operational alerts + notification queue
 *   - Per-asset workflow timeline (selected asset detail)
 *   - Cross-team collaboration comments (per-asset)
 *
 * Read-only by default; decision/comment/ack actions require the user to
 * be authenticated with CONTENT_REVIEWER+ role (enforced server-side).
 *
 * Intentionally lightweight — uses native HTML + minimal styling. The
 * design team can refine visuals; the data + actions are functional.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';

type Severity = 'info' | 'warning' | 'critical';
type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

type ExecutiveSummary = {
  companyId: string;
  computedAt: string;
  campaign: {
    totalAssets: number;
    publishedRate: number;
    approvalProgress: number;
    rejectionRate: number;
    staleCount: number;
    bottleneck: string | null;
  };
  qa: {
    avgDraftToApprovedHours: number;
    avgDraftToPublishedHours: number;
    reviewerAttribution: Record<string, number>;
  };
  governance: {
    totalEscalations: number;
    overdueEscalations: number;
    severeViolations24h: number;
    criticalActiveAlerts: number;
  };
  operationsHealth: {
    unacknowledgedNotifications: number;
    activeAlerts: Record<Severity, number>;
  };
  overallHealthGrade: HealthGrade;
  headlines: string[];
};

type ReviewRecord = {
  assetId: string;
  companyId: string;
  campaignId: string | null;
  currentState: string;
  campaignLocked: boolean;
  stale: boolean;
  overrideCount: number;
  escalationCount: number;
  lastTransitionedAt: string;
};

type SummaryResponse = {
  health: { byState: Record<string, number>; totalAssets: number };
  recentEvents: Array<{ eventId: string; type: string; assetId: string; occurredAt: string; context: Record<string, unknown> }>;
};

type AssetLifecycle = {
  assetId: string;
  currentState: string | null;
  stateHistory: Array<{ from: string | null; to: string; actorRole: string | null; reason: string | null; occurredAt: string; bypassed: boolean }>;
  escalations: Array<{ escalationId: string; reason: string; level: string; priority: string; assignedRole: string; deadline: string; createdAt: string }>;
  recentEvents: Array<{ eventId: string; type: string; occurredAt: string; context: Record<string, unknown> }>;
  timeline: Array<{ at: string; source: string; kind: string; actor?: string | null; detail: Record<string, unknown> }>;
};

type AlertsResponse = {
  alerts: Array<{ id: string; rule: string; severity: Severity; message: string; lastFiredAt: string; fireCount: number }>;
  notifications: Array<{ id: string; type: string; severity: Severity; message: string; occurredAt: string; assetId: string }>;
};

function gradeColor(grade: HealthGrade): string {
  switch (grade) {
    case 'A': return '#22c55e';
    case 'B': return '#84cc16';
    case 'C': return '#eab308';
    case 'D': return '#f97316';
    case 'F': return '#ef4444';
  }
}

function severityColor(sev: Severity): string {
  switch (sev) {
    case 'info': return '#3b82f6';
    case 'warning': return '#f59e0b';
    case 'critical': return '#ef4444';
  }
}

export default function EnterpriseGovernancePage(): React.ReactElement {
  const { selectedCompanyId: companyId } = useCompanyContext();
  const [exec, setExec] = useState<ExecutiveSummary | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetDetail, setAssetDetail] = useState<AssetLifecycle | null>(null);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [execRes, summRes, alertRes] = await Promise.all([
        fetch(`/api/enterprise-governance/executive-summary?companyId=${encodeURIComponent(companyId)}`),
        fetch(`/api/enterprise-governance/summary?companyId=${encodeURIComponent(companyId)}&eventLimit=30`),
        fetch(`/api/enterprise-governance/alerts?companyId=${encodeURIComponent(companyId)}`),
      ]);
      if (execRes.ok) setExec(await execRes.json());
      if (summRes.ok) setSummary(await summRes.json());
      if (alertRes.ok) setAlerts(await alertRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-refresh every 30s.
  useEffect(() => {
    if (!companyId) return;
    const id = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(id);
  }, [companyId, refresh]);

  // Load asset detail when selection changes.
  useEffect(() => {
    if (!selectedAssetId || !companyId) { setAssetDetail(null); return; }
    void (async () => {
      try {
        const res = await fetch(`/api/enterprise-governance/asset/${encodeURIComponent(selectedAssetId)}?companyId=${encodeURIComponent(companyId)}`);
        if (res.ok) setAssetDetail(await res.json());
      } catch {}
    })();
  }, [selectedAssetId, companyId]);

  const onDecide = useCallback(async (assetId: string, decision: 'approve' | 'reject' | 'archive' | 'override') => {
    if (!companyId) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { assetId, decision };
      if (decision === 'override') { body.decision = 'approve'; body.bypass = true; }
      const res = await fetch(`/api/enterprise-governance/approvals/decide?companyId=${encodeURIComponent(companyId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.skipped) setError(json.error ?? 'transition rejected');
      await refresh();
      if (selectedAssetId === assetId) {
        const detailRes = await fetch(`/api/enterprise-governance/asset/${encodeURIComponent(assetId)}?companyId=${encodeURIComponent(companyId)}`);
        if (detailRes.ok) setAssetDetail(await detailRes.json());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [companyId, refresh, selectedAssetId]);

  const onComment = useCallback(async () => {
    if (!companyId || !selectedAssetId || !commentText.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/enterprise-governance/approvals/comment?companyId=${encodeURIComponent(companyId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: selectedAssetId, text: commentText.trim() }),
      });
      setCommentText('');
      // Reload asset detail
      const detailRes = await fetch(`/api/enterprise-governance/asset/${encodeURIComponent(selectedAssetId)}?companyId=${encodeURIComponent(companyId)}`);
      if (detailRes.ok) setAssetDetail(await detailRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [companyId, selectedAssetId, commentText]);

  const onAckNotification = useCallback(async (id: string) => {
    if (!companyId) return;
    try {
      await fetch(`/api/enterprise-governance/notifications/acknowledge?companyId=${encodeURIComponent(companyId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      await refresh();
    } catch {}
  }, [companyId, refresh]);

  // Derive review queue from recent events (assets seen recently).
  const recentAssets = useMemo<ReadonlyArray<{ assetId: string; lastSeen: string }>>(() => {
    if (!summary?.recentEvents) return [];
    const seen = new Map<string, string>();
    for (const e of summary.recentEvents) {
      if (!seen.has(e.assetId)) seen.set(e.assetId, e.occurredAt);
    }
    return Array.from(seen.entries()).map(([assetId, lastSeen]) => ({ assetId, lastSeen })).slice(0, 25);
  }, [summary]);

  if (!companyId) {
    return <div style={{ padding: 24 }}>Select a company to view enterprise governance.</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 16 }}>Enterprise Governance — Operations Center</h1>
      {error && (
        <div style={{ background: '#fee', border: '1px solid #fcc', padding: 12, marginBottom: 16, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Executive summary */}
      {exec && (
        <section style={{ marginBottom: 32, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: gradeColor(exec.overallHealthGrade),
              color: 'white', fontSize: 32, fontWeight: 'bold',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{exec.overallHealthGrade}</div>
            <div>
              <h2 style={{ margin: 0 }}>Health Grade</h2>
              <div style={{ color: '#6b7280', fontSize: 14 }}>Updated {new Date(exec.computedAt).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <Metric label="Total Assets" value={exec.campaign.totalAssets} />
            <Metric label="Publish Rate" value={`${(exec.campaign.publishedRate * 100).toFixed(0)}%`} />
            <Metric label="Rejection Rate" value={`${(exec.campaign.rejectionRate * 100).toFixed(0)}%`} />
            <Metric label="Stale Reviews" value={exec.campaign.staleCount} />
            <Metric label="Avg Draft→Approved" value={`${exec.qa.avgDraftToApprovedHours.toFixed(1)}h`} />
            <Metric label="Avg Draft→Published" value={`${exec.qa.avgDraftToPublishedHours.toFixed(1)}h`} />
            <Metric label="Total Escalations" value={exec.governance.totalEscalations} />
            <Metric label="Overdue" value={exec.governance.overdueEscalations} severity={exec.governance.overdueEscalations > 0 ? 'warning' : undefined} />
          </div>
          <div>
            <strong>Headlines</strong>
            <ul style={{ marginTop: 4 }}>
              {exec.headlines.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Active alerts */}
        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Active Operational Alerts</h3>
          {!alerts?.alerts?.length ? (
            <div style={{ color: '#6b7280' }}>No active alerts.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th>Severity</th><th>Rule</th><th>Message</th><th>Last Fired</th>
                </tr>
              </thead>
              <tbody>
                {alerts.alerts.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td><span style={{ color: severityColor(a.severity), fontWeight: 600 }}>{a.severity}</span></td>
                    <td>{a.rule}</td>
                    <td>{a.message}</td>
                    <td style={{ fontSize: 11, color: '#6b7280' }}>{new Date(a.lastFiredAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Unacked notifications */}
        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Unacknowledged Notifications</h3>
          {!alerts?.notifications?.length ? (
            <div style={{ color: '#6b7280' }}>No unacknowledged notifications.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, maxHeight: 280, overflowY: 'auto' }}>
              {alerts.notifications.map((n) => (
                <li key={n.id} style={{ padding: 8, borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: severityColor(n.severity), fontWeight: 600 }}>{n.severity}</span>
                    <button onClick={() => onAckNotification(n.id)} style={{ padding: '2px 8px' }}>Ack</button>
                  </div>
                  <div>{n.message}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{n.type} · {new Date(n.occurredAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Review queue + selected asset */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginTop: 16 }}>
        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Recent Assets</h3>
          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {recentAssets.length === 0 && <div style={{ color: '#6b7280' }}>No recent activity.</div>}
            {recentAssets.map((a) => (
              <div
                key={a.assetId}
                onClick={() => setSelectedAssetId(a.assetId)}
                style={{
                  padding: 8, borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                  background: selectedAssetId === a.assetId ? '#eff6ff' : 'transparent',
                }}
              >
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.assetId.slice(0, 24)}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(a.lastSeen).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Asset Detail</h3>
          {!assetDetail ? (
            <div style={{ color: '#6b7280' }}>Select an asset to inspect its workflow timeline.</div>
          ) : (
            <>
              <div style={{ marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{assetDetail.assetId}</div>
                <div>State: <strong>{assetDetail.currentState ?? 'unknown'}</strong></div>
              </div>

              {/* Decision actions */}
              <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={() => onDecide(assetDetail.assetId, 'approve')}>Approve</button>
                <button disabled={busy} onClick={() => onDecide(assetDetail.assetId, 'reject')}>Reject</button>
                <button disabled={busy} onClick={() => onDecide(assetDetail.assetId, 'archive')}>Archive</button>
                <button disabled={busy} onClick={() => onDecide(assetDetail.assetId, 'override')} style={{ background: '#fef3c7' }}>Override (Bypass)</button>
              </div>

              {/* Comment box */}
              <div style={{ marginBottom: 16 }}>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a review comment…"
                  style={{ width: '100%', minHeight: 48, padding: 8, fontFamily: 'inherit', fontSize: 13 }}
                />
                <button disabled={busy || !commentText.trim()} onClick={onComment}>Post comment</button>
              </div>

              {/* Timeline */}
              <div>
                <strong>Workflow Timeline</strong>
                <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: 8 }}>
                  {assetDetail.timeline.map((t, i) => (
                    <div key={i} style={{ padding: 8, borderLeft: '3px solid ' + (t.source === 'escalation' ? '#ef4444' : t.source === 'state' ? '#3b82f6' : '#a3a3a3'), marginBottom: 6, fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{t.kind} <span style={{ color: '#6b7280', fontSize: 10 }}>({t.source})</span></div>
                      {t.actor && <div style={{ color: '#6b7280' }}>by {t.actor}</div>}
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>{new Date(t.at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, severity }: { label: string; value: number | string; severity?: Severity }): React.ReactElement {
  return (
    <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: severity ? severityColor(severity) : undefined }}>{value}</div>
    </div>
  );
}
