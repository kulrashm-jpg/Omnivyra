/**
 * Engagement System Controls
 * Super admin page to manage automation and AI behavior per organization.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Settings2, RefreshCw, AlertCircle, Check } from 'lucide-react';

type EngagementControls = {
  auto_reply_enabled: boolean;
  bulk_reply_enabled: boolean;
  ai_suggestions_enabled: boolean;
  triage_engine_enabled: boolean;
  opportunity_detection_enabled: boolean;
  response_strategy_learning_enabled: boolean;
  digest_generation_enabled: boolean;
};

type CompanyOption = { id: string; name: string };

const CONTROL_KEYS: { key: keyof EngagementControls; label: string }[] = [
  { key: 'auto_reply_enabled', label: 'Auto reply' },
  { key: 'bulk_reply_enabled', label: 'Bulk reply' },
  { key: 'ai_suggestions_enabled', label: 'AI suggestions' },
  { key: 'triage_engine_enabled', label: 'Triage engine' },
  { key: 'opportunity_detection_enabled', label: 'Opportunity detection' },
  { key: 'response_strategy_learning_enabled', label: 'Response strategy learning' },
  { key: 'digest_generation_enabled', label: 'Digest generation' },
];

const DEFAULTS: EngagementControls = {
  auto_reply_enabled: true,
  bulk_reply_enabled: true,
  ai_suggestions_enabled: true,
  triage_engine_enabled: true,
  opportunity_detection_enabled: true,
  response_strategy_learning_enabled: true,
  digest_generation_enabled: true,
};

export default function EngagementControlsPage() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [organizationId, setOrganizationId] = useState<string>('');
  const [controls, setControls] = useState<EngagementControls>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/companies', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access denied');
        throw new Error(res.statusText);
      }
      const data = await res.json();
      const list = (data.companies ?? []).map((c: { id: string; name?: string }) => ({
        id: c.id,
        name: c.name || c.id,
      }));
      setCompanies(list);
      if (list.length > 0 && !organizationId) {
        setOrganizationId(list[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load companies');
    }
  }, [organizationId]);

  const fetchControls = useCallback(async () => {
    if (!organizationId) {
      setControls(DEFAULTS);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/system/engagement-controls?organization_id=${encodeURIComponent(organizationId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        if (res.status === 403) throw new Error('Access denied');
        throw new Error(res.statusText);
      }
      const data = await res.json();
      setControls({
        auto_reply_enabled: data.auto_reply_enabled ?? true,
        bulk_reply_enabled: data.bulk_reply_enabled ?? true,
        ai_suggestions_enabled: data.ai_suggestions_enabled ?? true,
        triage_engine_enabled: data.triage_engine_enabled ?? true,
        opportunity_detection_enabled: data.opportunity_detection_enabled ?? true,
        response_strategy_learning_enabled: data.response_strategy_learning_enabled ?? true,
        digest_generation_enabled: data.digest_generation_enabled ?? true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load controls');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchControls();
  }, [fetchControls]);

  const handleToggle = (key: keyof EngagementControls, value: boolean) => {
    setControls((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/system/engagement-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organization_id: organizationId, ...controls }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? res.statusText);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Engagement Controls | Omnivyra</title>
      </Head>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4">
        <div className="max-w-2xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Engagement Controls</h1>
              <p className="text-sm text-slate-600">Automation and AI behavior per organization</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/super-admin" className="text-sm text-blue-600 hover:text-blue-800">
                ← Super Admin
              </Link>
              <Link href="/system/workers" className="text-sm text-blue-600 hover:text-blue-800">
                Workers
              </Link>
              <button
                type="button"
                onClick={() => fetchControls()}
                disabled={loading || !organizationId}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </header>

          {error && (
            <div
              className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {saveSuccess && (
            <div
              className="mb-4 p-3 rounded bg-green-50 text-green-700 text-sm flex items-center gap-2"
              role="status"
            >
              <Check className="w-4 h-4 shrink-0" />
              Saved
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Organization</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="w-full max-w-sm border border-slate-300 rounded px-3 py-2 text-sm bg-white"
            >
              <option value="">Select organization</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {!organizationId ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
              Select an organization to view and edit controls
            </div>
          ) : loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
              Loading…
            </div>
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                <Settings2 className="w-4 h-4 text-slate-600" />
                <h2 className="text-sm font-medium text-slate-800">Control Flags</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {CONTROL_KEYS.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50"
                  >
                    <span className="text-sm text-slate-700">{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={controls[key]}
                      onClick={() => handleToggle(key, !controls[key])}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 ${
                        controls[key] ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          controls[key] ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
