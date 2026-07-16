/**
 * /super-admin/operations-center — read-only Production Operations Center.
 *
 * Renders the repository-owned operational snapshot from
 * /api/super-admin/operations-center: rollout flags (incl. canonical-grounding)
 * with resolved mode/source, deployment/version fingerprint, runtime/queue/cron
 * topology, and single-points-of-failure. No secrets, no mutations, read-only.
 */
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '../../lib/apiFetch';

type RolloutFlagView = { key: string; description: string; envPrefix: string; mode: string; source: string; killed: boolean };
type Snapshot = {
  version: { fingerprint: string; build: string | null; environment: string; nodeVersion: string; nodeEnv: string; authContractVersion: string; schemaManifestHash: string | null };
  rolloutFlags: RolloutFlagView[];
  topology: {
    app: { host: string; deploy: string };
    worker: { host: string; entry: string; replicas: number | null; restartPolicy: string | null; deploy: string };
    queues: string[]; workers: string[];
    vercelCrons: { path: string; schedule: string }[];
    workerCronCoLocated: boolean; redis: string; db: string;
  };
  singlePointsOfFailure: string[];
  note: string;
};

const box: React.CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 8, padding: 16, marginBottom: 16, background: '#0f0f0f' };
const h2: React.CSSProperties = { fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: '#9aa', margin: '0 0 10px' };
const td: React.CSSProperties = { padding: '4px 10px', borderBottom: '1px solid #1e1e1e', fontFamily: 'ui-monospace, monospace', fontSize: 13 };

function modeColor(mode: string, killed: boolean): string {
  if (killed) return '#e06c75';
  if (mode === 'enforce') return '#e5c07b';
  if (mode === 'shadow') return '#61afef';
  return '#7f8c8d'; // off
}

// Canonical Operations navigation — links to EXISTING operational routes only.
// Pages are internal; API endpoints (↗) open the raw JSON. No new pages created.
type NavLink = { label: string; href: string; api?: boolean };
const NAV_MAP: { group: string; links: NavLink[] }[] = [
  { group: 'Infrastructure', links: [
    { label: 'System Health', href: '/super-admin/system-health' },
    { label: 'Redis Metrics', href: '/api/super-admin/redis-metrics', api: true },
    { label: 'Runtime Pressure', href: '/api/super-admin/runtime-pressure', api: true },
  ] },
  { group: 'Runtime & Observability', links: [
    { label: 'Observability Snapshot', href: '/api/super-admin/observability', api: true },
    { label: 'Runtime Pressure', href: '/api/super-admin/runtime-pressure', api: true },
  ] },
  { group: 'Queues', links: [
    { label: 'Queue Metrics', href: '/api/super-admin/queue-metrics', api: true },
    { label: 'Dead-Letter Queue', href: '/api/super-admin/dead-letter-queue', api: true },
    { label: 'Recovery State', href: '/api/super-admin/recovery-state', api: true },
  ] },
  { group: 'Scheduler & Cron', links: [
    { label: 'Cron Metrics', href: '/api/super-admin/cron-metrics', api: true },
    { label: 'Recovery State', href: '/api/super-admin/recovery-state', api: true },
  ] },
  { group: 'Integrations & OAuth', links: [
    { label: 'Integration Health (page)', href: '/super-admin/oauth-health' },
    { label: 'Integration Health API', href: '/api/super-admin/integration-health', api: true },
    { label: 'Connection Health', href: '/api/super-admin/connection-health', api: true },
  ] },
  { group: 'Billing & Settlement', links: [
    { label: 'Billing Forensics', href: '/api/super-admin/billing-forensics/timeline', api: true },
    { label: 'Settlement Ops', href: '/api/super-admin/settlement-ops', api: true },
    { label: 'Credit Reconciliation', href: '/api/super-admin/credit-reconciliation', api: true },
    { label: 'Credits & Billing (dashboard)', href: '/super-admin/dashboard' },
  ] },
  { group: 'Customer Health', links: [
    { label: 'Customer Operations', href: '/super-admin/customer-operations' },
    { label: 'Customer Readiness', href: '/super-admin/customer-readiness' },
    { label: 'Activation Workbench', href: '/super-admin/customer-activation-workbench' },
  ] },
  { group: 'Runtime Economics', links: [
    { label: 'Consumption', href: '/super-admin/consumption' },
    { label: 'Profitability', href: '/api/super-admin/economics/profitability', api: true },
    { label: 'Savings Report', href: '/api/super-admin/savings-report', api: true },
  ] },
  { group: 'BOLT', links: [
    { label: 'BOLT Failures', href: '/super-admin/bolt-failures' },
  ] },
  { group: 'Governance & Rollout', links: [
    { label: 'Planner Control', href: '/super-admin/planner-control' },
    { label: 'Enterprise Governance', href: '/super-admin/enterprise-governance' },
  ] },
  { group: 'Deployments & Version', links: [
    { label: 'Health / Version', href: '/api/health/version', api: true },
  ] },
];

export default function OperationsCenter() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/super-admin/operations-center')
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  return (
    <>
      <Head><title>Operations Center · Super Admin</title></Head>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, color: '#ddd', background: '#0a0a0a', minHeight: '100vh' }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Production Operations Center</h1>
        <p style={{ color: '#7f8c8d', fontSize: 13, marginTop: 0 }}>Read-only. The canonical hub for every operational surface. Rollout flags, deployment version, runtime topology, and SPOFs below.</p>

        <div style={box}>
          <h2 style={h2}>Operations Navigation</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {NAV_MAP.map((g) => (
              <div key={g.group} style={{ border: '1px solid #1e1e1e', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, color: '#9aa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{g.group}</div>
                {g.links.map((l) => (
                  <a
                    key={`${g.group}:${l.label}`}
                    href={l.href}
                    target={l.api ? '_blank' : undefined}
                    rel={l.api ? 'noopener noreferrer' : undefined}
                    style={{ display: 'block', fontSize: 13, color: '#61afef', textDecoration: 'none', padding: '2px 0' }}
                  >
                    {l.label}{l.api ? ' ↗' : ''}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        {error && <div style={{ ...box, borderColor: '#e06c75', color: '#e06c75' }}>Error: {error}</div>}
        {!data && !error && <div style={box}>Loading…</div>}

        {data && (
          <>
            <div style={box}>
              <h2 style={h2}>Deployment / Version</h2>
              <table><tbody>
                <tr><td style={td}>environment</td><td style={td}>{data.version.environment}</td></tr>
                <tr><td style={td}>build</td><td style={td}>{data.version.build ?? '—'}</td></tr>
                <tr><td style={td}>fingerprint</td><td style={td}>{data.version.fingerprint.slice(0, 16)}…</td></tr>
                <tr><td style={td}>node</td><td style={td}>{data.version.nodeVersion} ({data.version.nodeEnv})</td></tr>
                <tr><td style={td}>auth contract</td><td style={td}>{data.version.authContractVersion}</td></tr>
                <tr><td style={td}>schema manifest</td><td style={td}>{data.version.schemaManifestHash ?? '—'}</td></tr>
              </tbody></table>
            </div>

            <div style={box}>
              <h2 style={h2}>Rollout Flags</h2>
              {data.rolloutFlags.length === 0 && <div style={{ color: '#7f8c8d' }}>No flags registered in this instance.</div>}
              <table style={{ width: '100%' }}><tbody>
                {data.rolloutFlags.map((f) => (
                  <tr key={f.key}>
                    <td style={td}>{f.key}</td>
                    <td style={{ ...td, color: modeColor(f.mode, f.killed), fontWeight: 700 }}>{f.mode}{f.killed ? ' (killed)' : ''}</td>
                    <td style={{ ...td, color: '#7f8c8d' }}>{f.source}</td>
                    <td style={{ ...td, color: '#7f8c8d' }}>{f.envPrefix}_MODE</td>
                  </tr>
                ))}
              </tbody></table>
            </div>

            <div style={box}>
              <h2 style={h2}>Runtime Topology</h2>
              <table><tbody>
                <tr><td style={td}>app</td><td style={td}>{data.topology.app.host} — {data.topology.app.deploy}</td></tr>
                <tr><td style={td}>worker</td><td style={td}>{data.topology.worker.host} · {data.topology.worker.replicas} replica · restart {data.topology.worker.restartPolicy} · {data.topology.worker.deploy}</td></tr>
                <tr><td style={td}>queues</td><td style={td}>{data.topology.queues.join(', ')}</td></tr>
                <tr><td style={td}>workers</td><td style={td}>{data.topology.workers.join(', ')}</td></tr>
                <tr><td style={td}>vercel crons</td><td style={td}>{data.topology.vercelCrons.length} (+ worker co-located scheduler)</td></tr>
                <tr><td style={td}>redis</td><td style={td}>{data.topology.redis}</td></tr>
                <tr><td style={td}>db</td><td style={td}>{data.topology.db}</td></tr>
              </tbody></table>
            </div>

            <div style={{ ...box, borderColor: '#7a5' }}>
              <h2 style={h2}>Single Points of Failure</h2>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {data.singlePointsOfFailure.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
              </ul>
            </div>

            <p style={{ color: '#555', fontSize: 12 }}>{data.note}</p>
          </>
        )}
      </div>
    </>
  );
}
