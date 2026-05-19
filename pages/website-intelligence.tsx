import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';

type Dashboard = {
  websites?: any[];
  overview?: Record<string, number>;
  publishing_overview?: { failed?: number; integrity?: any[]; recent?: any[] };
  intelligence_alerts?: any[];
  form_performance?: any[];
  cms_health?: { plugins?: any[] };
  tracking_health?: { status?: string; totals?: Record<string, number> };
  setup_progress?: { complete: boolean; steps: Array<{ label: string; complete: boolean; action: string }> };
  operational_alerts?: any[];
};

export default function WebsiteIntelligencePage() {
  const [companyId, setCompanyId] = useState('');
  const [websiteId, setWebsiteId] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('company_id', companyId);
    if (websiteId) params.set('website_id', websiteId);
    return params.toString();
  }, [companyId, websiteId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    setCompanyId(url.searchParams.get('company_id') || '');
    setWebsiteId(url.searchParams.get('website_id') || '');
  }, []);

  async function loadDashboard() {
    if (!companyId) {
      setError('Enter a company id to load website intelligence.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/website-intelligence/dashboard?${query}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load dashboard');
      setDashboard(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function generateSignals() {
    if (!companyId) return;
    await fetch('/api/website-intelligence/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, website_id: websiteId || undefined }),
    });
    await loadDashboard();
  }

  async function createSetupToken() {
    if (!companyId) return;
    const res = await fetch('/api/wordpress-plugin/setup-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, website_id: websiteId || undefined }),
    });
    const json = await res.json();
    if (res.ok) {
      window.prompt('WordPress setup token', json.setupToken);
    } else {
      setError(json.error || 'Failed to create setup token');
    }
  }

  async function runQueueMetrics() {
    if (!companyId) return;
    await fetch(`/api/admin/website-intelligence/queue-metrics?${query}`);
    await fetch('/api/admin/website-intelligence/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, website_id: websiteId || undefined }),
    });
    await loadDashboard();
  }

  return (
    <main className="wi-page">
      <header className="wi-header">
        <div>
          <h1>Website Intelligence</h1>
          <p>Operational visibility for tracking, attribution, publishing, forms, WordPress health, and conversion signals.</p>
        </div>
        <Link href={`/website-setup${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''}`}>Setup wizard</Link>
      </header>

      <section className="wi-controls">
        <label>
          Company ID
          <input value={companyId} onChange={(event) => setCompanyId(event.target.value)} placeholder="company uuid" />
        </label>
        <label>
          Website ID
          <input value={websiteId} onChange={(event) => setWebsiteId(event.target.value)} placeholder="optional website uuid" />
        </label>
        <button onClick={loadDashboard} disabled={loading}>{loading ? 'Loading...' : 'Load'}</button>
        <button onClick={generateSignals} disabled={!companyId || loading}>Generate signals</button>
        <button onClick={createSetupToken} disabled={!companyId || loading}>Setup token</button>
        <button onClick={runQueueMetrics} disabled={!companyId || loading}>Refresh ops</button>
      </section>

      {error && <div className="wi-error">{error}</div>}

      {!dashboard && !loading && (
        <section className="wi-empty">
          <h2>Connect a website to begin</h2>
          <p>Use the setup wizard to create a website, verify the domain, connect WordPress, install tracking, and attach forms.</p>
        </section>
      )}

      {dashboard && (
        <div className="wi-grid">
          <Panel title="Website Overview">
            <Metric label="Websites" value={dashboard.websites?.length ?? 0} />
            <Metric label="Page views" value={dashboard.overview?.page_views ?? 0} />
            <Metric label="Visitors" value={dashboard.overview?.unique_visitors ?? 0} />
            <Metric label="Tracking" value={dashboard.tracking_health?.status ?? 'unknown'} />
            {dashboard.setup_progress?.steps?.map((step) => (
              <StatusRow key={step.label} label={step.label} status={step.complete ? 'Ready' : 'Needs attention'} detail={step.action} />
            ))}
          </Panel>

          <Panel title="Conversion Overview">
            <Metric label="CTA clicks" value={dashboard.overview?.cta_clicks ?? 0} />
            <Metric label="Form starts" value={dashboard.overview?.form_starts ?? 0} />
            <Metric label="Form submits" value={dashboard.overview?.form_submits ?? 0} />
            <Metric label="Tracked forms" value={dashboard.form_performance?.length ?? 0} />
          </Panel>

          <Panel title="Publishing Overview">
            <Metric label="Recent jobs" value={dashboard.publishing_overview?.recent?.length ?? 0} />
            <Metric label="Failed jobs" value={dashboard.publishing_overview?.failed ?? 0} />
            <Metric label="Integrity issues" value={dashboard.publishing_overview?.integrity?.filter((row) => row.integrity_status !== 'healthy').length ?? 0} />
          </Panel>

          <Panel title="CMS Health">
            {(dashboard.cms_health?.plugins ?? []).slice(0, 5).map((plugin) => (
              <StatusRow key={plugin.id} label={plugin.site_url} status={plugin.status} detail={plugin.compatibility_status} />
            ))}
            {!(dashboard.cms_health?.plugins ?? []).length && <p className="wi-muted">No WordPress plugin registrations yet.</p>}
          </Panel>

          <Panel title="Intelligence Alerts">
            {(dashboard.operational_alerts ?? []).slice(0, 5).map((alert) => (
              <StatusRow key={alert.id} label={alert.alert_type} status={alert.severity} detail={alert.remediation || alert.message} />
            ))}
            {(dashboard.intelligence_alerts ?? []).slice(0, 8).map((signal) => (
              <StatusRow key={signal.id} label={signal.type} status={signal.severity} detail={signal.recommendation} />
            ))}
            {!(dashboard.intelligence_alerts ?? []).length && <p className="wi-muted">No active signals. Generate signals after data has been collected.</p>}
          </Panel>

          <Panel title="Recovery Actions">
            <StatusRow label="WordPress onboarding" status="Setup token" detail="Create a setup token and paste it into the WordPress plugin." />
            <StatusRow label="Publishing failures" status="Retry ready" detail="Use the publishing queue to retry failed jobs after fixing credentials." />
            <StatusRow label="Attribution readiness" status={dashboard.overview?.form_submits ? 'Ready' : 'Needs data'} detail="Collect form submissions with tracking metadata enabled." />
          </Panel>
        </div>
      )}

      <style jsx>{`
        .wi-page { padding: 32px; color: #17202a; background: #f7f8fa; min-height: 100vh; }
        .wi-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
        h1 { margin: 0 0 6px; font-size: 28px; }
        h2 { margin: 0 0 12px; font-size: 18px; }
        p { margin: 0; color: #5b6472; }
        .wi-controls { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr) auto auto auto auto; gap: 12px; align-items: end; margin-bottom: 20px; }
        label { display: grid; gap: 6px; font-size: 13px; color: #4d5663; }
        input { height: 38px; border: 1px solid #cfd6df; border-radius: 6px; padding: 0 10px; background: white; }
        button, a { height: 38px; border-radius: 6px; border: 1px solid #17202a; background: #17202a; color: white; padding: 0 14px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
        button:disabled { opacity: 0.55; }
        .wi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .wi-error, .wi-empty, .panel { background: white; border: 1px solid #e0e5ec; border-radius: 8px; padding: 18px; }
        .wi-error { color: #9b1c1c; margin-bottom: 16px; }
        .metric { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #edf0f4; }
        .metric:first-of-type { border-top: 0; }
        .status { display: grid; gap: 3px; padding: 10px 0; border-top: 1px solid #edf0f4; }
        .status strong { font-size: 13px; }
        .wi-muted { color: #7b8491; }
        @media (max-width: 900px) {
          .wi-page { padding: 18px; }
          .wi-header { display: grid; }
          .wi-controls, .wi-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusRow({ label, status, detail }: { label: string; status: string; detail?: string }) {
  return (
    <div className="status">
      <strong>{label}</strong>
      <span>{status}{detail ? ` - ${detail}` : ''}</span>
    </div>
  );
}
