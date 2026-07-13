'use client';

/**
 * /customer-success — the canonical Customer Success Workspace page (CSA-007).
 *
 * The single operational Customer Success surface. It fetches the composed
 * workspace from the workspace authority (GET /api/customer-success/workspace)
 * and renders it through the reusable CustomerSuccessWorkspace component. It
 * computes nothing and executes nothing — every action/playbook links to an
 * existing surface. Section/playbook interactions fire read-only telemetry (§8).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { apiFetch } from '../lib/apiFetch';
import CustomerSuccessWorkspace from '../components/customerSuccess/CustomerSuccessWorkspace';
import type { CustomerSuccessWorkspace as WorkspaceView } from '../lib/customerSuccess/workspace';

export default function CustomerSuccessWorkspacePage() {
  const [orgId, setOrgId] = useState<string>('');
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('org_id') ?? '';
      setOrgId(q);
    } catch { /* no-op */ }
  }, []);

  const load = useCallback(async (org: string) => {
    if (!org) { setLoading(false); setError('Add ?org_id=<company> to view a workspace.'); return; }
    try {
      const res = await apiFetch(`/api/customer-success/workspace?org_id=${encodeURIComponent(org)}`);
      if (!res.ok) { setError('Could not load the Customer Success workspace.'); setLoading(false); return; }
      setWorkspace((await res.json()) as WorkspaceView);
      setError(null);
    } catch {
      setError('Network error loading the workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (orgId) void load(orgId); }, [orgId, load]);

  const onTelemetry = useMemo(() => (event: 'section_view' | 'playbook_open', label: string) => {
    if (!orgId) return;
    const key = event === 'playbook_open' ? 'playbook' : 'section';
    // Read-only telemetry ping (no data write); fire-and-forget.
    void apiFetch(`/api/customer-success/workspace?org_id=${encodeURIComponent(orgId)}&event=${event}&${key}=${encodeURIComponent(label)}`).catch(() => {});
  }, [orgId]);

  return (
    <>
      <Head><title>Customer Success | Omnivyra</title></Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/command-center" className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">Dashboard</Link>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-6 py-10">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Customer Success</h1>
          <p className="mt-2 text-sm text-[#6B7C93]">
            One view of health, lifecycle, the next best action, and the playbook to get there.
          </p>

          {error && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</p>}
          {loading && <p className="mt-8 text-sm text-[#6B7C93]">Loading the workspace…</p>}

          {!loading && workspace && (
            <div className="mt-6">
              <CustomerSuccessWorkspace workspace={workspace} onTelemetry={onTelemetry} />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
