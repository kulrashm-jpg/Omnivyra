/**
 * A3R — the Lead Sources tab of the API Connections page.
 *
 * A control plane and nothing else: it configures and revokes a tenant's own
 * provider credential through the A3P API. It activates nothing, verifies
 * nothing, and contacts no provider — the browser here talks only to Omnivyra.
 *
 * ─── THE ONE THING THIS UI MUST NOT DO ────────────────────────────────────
 * Let "the key is saved" read as "this works". Every other connection surface
 * in this page shows `connected` once a credential exists, and copying that
 * habit here would be a lie: no lead provider has an adapter or a registered
 * credit action, so a configured provider still refuses at the cost gate. So
 * `configured` and `operational` are rendered as SEPARATE facts, both taken
 * verbatim from the server, and the component contains no expression that
 * derives one from the other.
 *
 * ─── THE SERVER OWNS THE PROVIDER LIST ────────────────────────────────────
 * The card list is exactly what `GET /api/prospect-sources/credentials`
 * returns, which is the A3C registry filtered to sources that can hold a
 * tenant credential. There is no provider array in this file. A source that
 * authenticates some other way — the browser extension through its HMAC
 * session, manual entry through no credential at all — is absent from the
 * response and therefore absent here, which is why no API-key form can ever be
 * offered for one.
 *
 * ─── THE SECRET'S LIFETIME ────────────────────────────────────────────────
 * A typed key lives in one piece of component state, is sent once, and the
 * field is cleared on success. It is never put in the URL, in storage, in a
 * telemetry payload, or into an error message — the server's masked value is
 * the only credential representation this component ever renders.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';
import {
  KeyRound, ShieldCheck, ShieldAlert, Trash2, RefreshCw, AlertCircle, Lock,
} from 'lucide-react';

/** Mirrors `ProviderCredentialStatus` from the A3P handler. Read-only DTO. */
export interface LeadSourceStatus {
  providerId: string;
  displayName: string;
  sourceType: 'external_api' | 'gateway_api' | 'browser_extension' | 'manual';
  authMode: 'api_key' | 'gateway_api_key' | 'browser_session' | 'none';
  configured: boolean;
  credentialFields: Record<string, string>;
  operational: boolean;
  operationalReason: string;
}

const ENDPOINT = '/api/prospect-sources/credentials';

const AUTH_MODE_LABEL: Record<LeadSourceStatus['authMode'], string> = {
  api_key: 'API key',
  gateway_api_key: 'Gateway API key',
  browser_session: 'Browser session',
  none: 'No credential',
};

/** Only these modes take a typed secret. Everything else is read-only here. */
const ACCEPTS_TYPED_KEY: readonly LeadSourceStatus['authMode'][] = ['api_key', 'gateway_api_key'];

/**
 * Turn a failed response into something safe to show.
 *
 * The server already refuses to put a credential in an error body; this is the
 * second half of that contract — the client never echoes what was submitted,
 * and an unrecognised failure becomes a generic sentence rather than a raw
 * server string.
 */
function messageFor(status: number, body: unknown): string {
  if (status === 401) return 'Your session has expired. Sign in again to manage lead sources.';
  if (status === 403) return 'You do not have permission to manage this company’s API connections.';
  if (status === 503) return 'Could not reach Omnivyra. Check your connection and retry.';
  const reason = (body as { reason?: string; error?: string } | null)?.reason;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return 'The request could not be completed. Please try again.';
}

export default function LeadSourcesPanel({ companyId }: { companyId: string | null }) {
  const [providers, setProviders] = useState<LeadSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`${ENDPOINT}?companyId=${encodeURIComponent(companyId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(messageFor(res.status, body));
        setProviders([]);
      } else {
        setProviders(Array.isArray(body?.providers) ? body.providers : []);
      }
    } catch {
      setLoadError('The request could not be completed. Please try again.');
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const submitKey = async (provider: LeadSourceStatus) => {
    const value = draftKey.trim();
    if (!value) {
      setRowError({ id: provider.providerId, message: 'Enter a key before saving.' });
      return;
    }
    setBusy(provider.providerId);
    setRowError(null);
    try {
      const res = await apiFetch(`${ENDPOINT}?companyId=${encodeURIComponent(companyId ?? '')}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // The company id is NOT sent in the body: the server takes it from the
        // verified query parameter, and duplicating it here would invite a
        // reader to think the body could influence which tenant is written.
        body: JSON.stringify({ provider: provider.providerId, credentials: { api_key: value } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError({ id: provider.providerId, message: messageFor(res.status, body) });
        return;
      }
      // Cleared on success, so the secret does not outlive the request.
      setDraftKey('');
      setEditing(null);
      await load();
    } catch {
      setRowError({ id: provider.providerId, message: 'The request could not be completed. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (provider: LeadSourceStatus) => {
    setBusy(provider.providerId);
    setRowError(null);
    try {
      const url = `${ENDPOINT}?companyId=${encodeURIComponent(companyId ?? '')}`
        + `&provider=${encodeURIComponent(provider.providerId)}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError({ id: provider.providerId, message: messageFor(res.status, body) });
        return;
      }
      setConfirmRevoke(null);
      await load();
    } catch {
      setRowError({ id: provider.providerId, message: 'The request could not be completed. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        Select a company to manage its lead sources.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3" data-testid="lead-sources-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="text-sm text-red-800">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!providers.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
        No lead sources are available for configuration.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
        <p className="text-xs text-amber-800">
          Keys are encrypted and stored against this company only. Omnivyra never displays a key
          after it is saved, and saving one does not contact the provider.
        </p>
      </div>

      {providers.map((p) => {
        const typedKeyProvider = ACCEPTS_TYPED_KEY.includes(p.authMode);
        const isEditing = editing === p.providerId;
        const isBusy = busy === p.providerId;
        const err = rowError?.id === p.providerId ? rowError.message : null;

        return (
          <div
            key={p.providerId}
            data-testid={`lead-source-${p.providerId}`}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{p.displayName}</h3>
                  {p.configured ? (
                    <span
                      data-testid={`state-${p.providerId}`}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                    >
                      <ShieldCheck className="h-3 w-3" /> Configured
                    </span>
                  ) : (
                    <span
                      data-testid={`state-${p.providerId}`}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
                    >
                      <ShieldAlert className="h-3 w-3" /> Not configured
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Authentication: {AUTH_MODE_LABEL[p.authMode]}
                </p>
                {p.configured && p.credentialFields?.api_key && (
                  <p className="mt-1 font-mono text-xs text-gray-500">
                    API key: <span data-testid={`masked-${p.providerId}`}>{p.credentialFields.api_key}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {typedKeyProvider && !isEditing && (
                  <button
                    type="button"
                    onClick={() => { setEditing(p.providerId); setDraftKey(''); setRowError(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {p.configured ? 'Replace key' : 'Configure'}
                  </button>
                )}
                {p.configured && (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(p.providerId)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Revoke
                  </button>
                )}
              </div>
            </div>

            {/*
              The operational line is ALWAYS rendered, configured or not. It is
              the server's answer, not a conclusion drawn from `configured`.
            */}
            {!p.operational && (
              <p
                data-testid={`not-operational-${p.providerId}`}
                className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600"
              >
                <span className="font-medium text-gray-700">Enrichment not yet available.</span>{' '}
                {p.operationalReason}
              </p>
            )}

            {isEditing && typedKeyProvider && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <label className="block text-xs font-medium text-gray-700" htmlFor={`key-${p.providerId}`}>
                  API key
                </label>
                <input
                  id={`key-${p.providerId}`}
                  data-testid={`key-input-${p.providerId}`}
                  type="password"
                  autoComplete="off"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Paste the key issued by the provider"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void submitKey(p)}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isBusy ? 'Saving…' : 'Save key'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(null); setDraftKey(''); setRowError(null); }}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {confirmRevoke === p.providerId && (
              <div
                data-testid={`confirm-revoke-${p.providerId}`}
                className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <p className="text-xs text-amber-900">
                  Remove the stored key for {p.displayName}? This cannot be undone.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void revoke(p)}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isBusy ? 'Removing…' : 'Yes, revoke'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(null)}
                    className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}

            {err && (
              <p data-testid={`error-${p.providerId}`} className="mt-3 text-xs text-red-700">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
