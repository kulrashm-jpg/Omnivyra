import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, GitBranch } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';

type HealthStatus = 'PASS' | 'WARNING' | 'FAILED';
interface SectionHealth { section: string; status: HealthStatus; reasons: string[]; metrics?: Record<string, number> }
interface IntegrityFinding { type: string; severity: 'warning' | 'error'; objectType: string; objectId: string; detail: string }
interface GraphNode { id: string; type: string; label: string }
interface GraphEdge { from: string; to: string }
interface OpsReport { overall: HealthStatus; sections: SectionHealth[]; integrity: IntegrityFinding[]; graph: { nodes: GraphNode[]; edges: GraphEdge[] }; generatedFor: string }

const STATUS_STYLE: Record<HealthStatus, { color: string; Icon: typeof CheckCircle2 }> = {
  PASS: { color: '#86efac', Icon: CheckCircle2 },
  WARNING: { color: '#fbbf24', Icon: AlertTriangle },
  FAILED: { color: '#fca5a5', Icon: XCircle },
};

/**
 * Creator Observability & Operations Center — one read-only operational view of
 * every Creator subsystem (health · metrics · integrity · dependency graph).
 * Deterministic; reuses existing subsystems; no destructive actions.
 */
export default function CreatorOpsPage() {
  const router = useRouter();
  const { selectedCompanyId, isLoading } = useCompanyContext();
  const [report, setReport] = React.useState<OpsReport | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/creator-templates/observability?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.report) setReport(d.report); })
      .catch(() => { /* best-effort */ })
      .finally(() => setLoaded(true));
  }, [selectedCompanyId]);
  React.useEffect(() => { load(); }, [load]);

  async function retryPreview(templateId: string) {
    if (busy) return; setBusy(true);
    try {
      await fetch('/api/creator-templates/observability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, action: 'retry_preview', template_id: templateId }) });
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  // Trace a finding back to its originating object (read-only navigation).
  function inspect(f: IntegrityFinding) {
    if (f.objectType === 'template') router.push(`/command-center/creator-content/templates-editor?id=${encodeURIComponent(f.objectId)}`);
    else if (f.objectType === 'collection') router.push(`/command-center/creator-content/collections-editor?id=${encodeURIComponent(f.objectId)}`);
    else if (f.objectType === 'campaign') router.push(`/command-center/creator-content/campaign-design-system?campaign_id=${encodeURIComponent(f.objectId)}`);
  }

  if (isLoading) return <PageLoader />;

  const grouped: Record<string, GraphNode[]> = {};
  for (const n of report?.graph.nodes ?? []) (grouped[n.type] ??= []).push(n);
  const chain = ['template', 'collection', 'campaign_design_system', 'campaign', 'assets', 'analytics', 'performance', 'evolution'];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 28, color: '#e5e7eb' }}>
      <button type="button" onClick={() => router.push('/command-center/creator-content/create')} style={linkBtn}><ArrowLeft size={15} /> Creator</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Activity size={22} color="#60a5fa" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Creator Operations Center</h1>
        {report ? (() => { const { color, Icon } = STATUS_STYLE[report.overall]; return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, color, fontWeight: 800, fontSize: 14 }}><Icon size={16} /> {report.overall}</span>; })() : null}
        <button type="button" onClick={load} style={{ ...linkBtn, marginLeft: 'auto' }}><RefreshCw size={14} /> Refresh</button>
      </div>

      {loaded && !report ? <div style={{ marginTop: 24, color: '#64748b' }}>No report available.</div> : null}

      {report ? (
        <>
          {/* Health sections */}
          <div style={{ ...sectionLabel, marginTop: 22 }}>Subsystem Health</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {report.sections.map((s) => { const { color, Icon } = STATUS_STYLE[s.status]; return (
              <div key={s.section} style={{ border: '1px solid #1f2937', borderRadius: 12, padding: 12, background: '#0b1220' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#f8fafc' }}>{s.section}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontSize: 11.5, fontWeight: 800 }}><Icon size={13} /> {s.status}</span>
                </div>
                <ul style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0', paddingLeft: 16, lineHeight: 1.6 }}>{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                {s.metrics ? <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{Object.entries(s.metrics).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div> : null}
              </div>
            ); })}
          </div>

          {/* Integrity findings */}
          <div style={{ ...sectionLabel, marginTop: 24 }}>Integrity ({report.integrity.length})</div>
          {report.integrity.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.integrity.map((f, i) => (
                <div key={`${f.type}:${f.objectId}:${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${f.severity === 'error' ? '#7f1d1d' : '#92400e'}`, borderRadius: 8, padding: '8px 11px' }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: f.severity === 'error' ? '#fca5a5' : '#fbbf24', textTransform: 'uppercase' }}>{f.type.replace(/_/g, ' ')}</span>
                    <div style={{ fontSize: 12, color: '#cbd5e1' }}>{f.detail}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{f.objectType} · {f.objectId.slice(0, 12)}…</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => inspect(f)} style={iconBtnText}>Inspect</button>
                    {f.type === 'preview_mismatch' ? <button type="button" onClick={() => retryPreview(f.objectId)} disabled={busy} style={iconBtnText}>Retry preview</button> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 13, color: '#86efac' }}>No integrity issues detected.</div>}

          {/* Dependency graph */}
          <div style={{ ...sectionLabel, marginTop: 24 }}><GitBranch size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Dependency Graph</div>
          <div style={{ border: '1px solid #1f2937', borderRadius: 12, padding: 14, background: '#0b1220' }}>
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>Template → Collection → Campaign Design System → Campaign → Assets → Analytics → Performance → Evolution</div>
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto' }}>
              {chain.map((type) => (
                <div key={type} style={{ minWidth: 120 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', marginBottom: 6 }}>{type.replace(/_/g, ' ')}</div>
                  {(grouped[type] ?? []).slice(0, 8).map((n) => <div key={n.id} style={{ fontSize: 11.5, color: '#cbd5e1', padding: '2px 0' }}>{n.label}</div>)}
                  {!(grouped[type] ?? []).length ? <div style={{ fontSize: 11.5, color: '#475569' }}>—</div> : null}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', fontSize: 13, cursor: 'pointer', padding: 0 };
const iconBtnText: React.CSSProperties = { background: 'transparent', border: '1px solid #1f2937', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 12 };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 };
