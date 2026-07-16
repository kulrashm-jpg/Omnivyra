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
        <p style={{ color: '#7f8c8d', fontSize: 13, marginTop: 0 }}>Read-only. Rollout flags, deployment version, runtime topology, and SPOFs.</p>

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
