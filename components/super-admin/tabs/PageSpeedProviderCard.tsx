import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, Eye, EyeOff, Gauge, RefreshCw, Save } from 'lucide-react';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { parseJsonResponse } from '@/lib/utils/safeFetchJson';
import { runStepUpFlowIfNeeded, describeStepUpOutcome } from '@/lib/security/superAdminStepUp';

/** Shape-only summary from /api/super-admin/pagespeed-config (never contains the key). */
export type PageSpeedConfigSummary = {
  provider: 'google_pagespeed';
  enabled: boolean;
  configured: boolean;
  keySource: 'super_admin' | 'environment' | 'none';
  hasStoredKey: boolean;
  keyDisplay: string | null;
  envFallback: { name: string; present: boolean };
  keylessEnabled: boolean;
  status: 'active' | 'disabled' | 'not_configured' | 'error';
  statusDetail: string;
  lastCheck: { ok: boolean; issue: string | null; detail: string; at: string; keySource: string } | null;
};

const ROUTE = '/api/super-admin/pagespeed-config';

/**
 * Google PageSpeed Insights — one application-level key shared by every tenant report job.
 * Sits beside the Google Analytics + Search Console card and follows its pattern: pills for the
 * saved/enabled state, a collapsed form, a write-only secret field, and step-up on save.
 */
export default function PageSpeedProviderCard() {
  const [config, setConfig] = useState<PageSpeedConfigSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<'save' | 'check' | 'clear' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = (next: PageSpeedConfigSummary) => {
    setConfig(next);
    setEnabled(next.enabled);
    setLoaded(true);
  };

  const load = async () => {
    try {
      const response = await fetchWithAuth(ROUTE);
      if (!response.ok) return;
      const parsed = await parseJsonResponse<{ config?: PageSpeedConfigSummary }>(response, ROUTE);
      if (parsed.ok === true && parsed.data?.config) apply(parsed.data.config);
    } catch (error) {
      console.error('Failed to load PageSpeed provider config', error instanceof Error ? error.message : 'unknown error');
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (clearKey = false) => {
    setBusy(clearKey ? 'clear' : 'save');
    setMessage(null);
    try {
      const body = JSON.stringify({ enabled, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}), ...(clearKey ? { clear_key: true } : {}) });
      const fire = () => fetchWithAuth(ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const outcome = await runStepUpFlowIfNeeded(await fire(), fire, {
        onChallengeStart: () => setMessage({ type: 'success', text: 'Confirm with your passkey to save…' }),
      });
      if (outcome.kind === 'success') {
        const data = await outcome.response.json().catch(() => ({}));
        if (data?.config) apply(data.config);
        setApiKey('');
        setShowKey(false);
        setExpanded(false);
        setMessage({ type: 'success', text: clearKey ? 'Stored key removed' : 'PageSpeed provider saved' });
      } else if (outcome.kind === 'step_up_user_cancelled' || outcome.kind === 'step_up_unavailable') {
        setMessage({ type: 'error', text: describeStepUpOutcome(outcome) });
      } else {
        const errorBody = await outcome.response.json().catch(() => ({}));
        setMessage({ type: 'error', text: errorBody.error || describeStepUpOutcome(outcome) });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save the PageSpeed provider configuration.' });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    setMessage(null);
    try {
      const response = await fetchWithAuth(ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ type: 'error', text: data?.error || 'The PageSpeed check could not be run.' }); return; }
      if (data?.config) apply(data.config);
    } catch {
      setMessage({ type: 'error', text: 'The PageSpeed check could not be run.' });
    } finally {
      setBusy(null);
    }
  };

  const sourceLabel = config?.keySource === 'super_admin' ? 'Key: Super Admin' : config?.keySource === 'environment' ? `Key: ${config.envFallback.name} (env)` : 'No key';
  const last = config?.lastCheck;

  return (
    <div className="px-6 py-5 border-b border-gray-200 bg-white">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Google PageSpeed Insights Provider</h3>
                <p className="text-sm text-slate-600">
                  One application-level key measures public pages for every company report. Companies never supply their own.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {loaded && config ? (
                <>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${config.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                    {config.configured ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    {config.configured ? 'Key configured' : 'Not configured'}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${config.enabled ? 'border-blue-200 bg-blue-100 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {config.enabled ? 'Enabled for report jobs' : 'Disabled for report jobs'}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">{sourceLabel}</span>
                  {config.keyDisplay && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-600">{config.keyDisplay}</span>}
                  {last && (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${last.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`} title={last.detail}>
                      {last.ok ? 'Last check passed' : `Last check: ${last.issue?.replace(/_/g, ' ') ?? 'failed'}`} · {new Date(last.at).toLocaleString()}
                    </span>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2.5 py-1 font-medium text-slate-400">
                  <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-slate-300" />
                  Loading provider configuration…
                </span>
              )}
            </div>
            {loaded && config && (
              <p className="mt-2 text-xs text-slate-600" data-testid="pagespeed-status-detail">{config.statusDetail}</p>
            )}
            {last && !last.ok && (
              <p className="mt-1 text-xs text-red-700" data-testid="pagespeed-last-check-detail">{last.detail}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={check}
              disabled={!loaded || busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy === 'check' ? 'animate-spin' : ''}`} />
              {busy === 'check' ? 'Checking…' : 'Check'}
            </button>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              disabled={!loaded}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {config?.hasStoredKey ? 'Update PageSpeed Provider' : 'Configure PageSpeed Provider'}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-5 space-y-4 rounded-2xl border border-white/70 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Google API key (server-side only)</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  name=""
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  placeholder={config?.hasStoredKey ? 'Leave blank to keep the saved key' : 'Paste a Google Cloud API key with the PageSpeed Insights API enabled'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                <button type="button" onClick={() => setShowKey((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Stored encrypted and never shown again. Restrict the key to the PageSpeed Insights API in Google Cloud.
                {config?.envFallback.present ? ` ${config.envFallback.name} is also set in the environment and is used only when no key is saved here.` : ''}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="rounded border-slate-300" />
              Enable PageSpeed for company report jobs (off: no request is made; page speed shows as not measured)
            </label>

            {message && (
              <div className={`rounded-lg px-3 py-2 text-sm ${message.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                {message.text}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {config?.hasStoredKey && (
                <button type="button" onClick={() => save(true)} disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {busy === 'clear' ? 'Removing…' : 'Remove saved key'}
                </button>
              )}
              <button type="button" onClick={() => save(false)} disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                <Save className="h-4 w-4" />
                {busy === 'save' ? 'Saving...' : 'Save PageSpeed'}
              </button>
            </div>
          </div>
        )}
        {!expanded && message && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
