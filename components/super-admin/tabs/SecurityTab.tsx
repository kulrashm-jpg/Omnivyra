/**
 * SecurityTab — Phase 2 passkey enrollment + trusted-device surface
 * inside the super-admin shell.
 *
 * Operator flow:
 *   1. Open the Security tab. The component fetches `/api/auth/passkeys`.
 *      - Bridge principals get a 403 BRIDGE_FACTOR_INSUFFICIENT and a
 *        banner instructing them to log in via Supabase first (Phase-2
 *        bootstrap canonical session is the path).
 *   2. Click "Enroll passkey" → begin-registration → @simplewebauthn/browser
 *      → verify-registration. Audit row written server-side.
 *   3. After enrolling AND completing a step-up (e.g. via the next
 *      protected action), click "Trust this device" → /api/auth/devices/trust.
 *
 * This UI does NOT redesign /settings/security. It exists as a
 * super-admin-shell-local entry point so first-deploy operators can
 * enroll without leaving the platform admin context.
 *
 * Constraints:
 *   - Bridge principals are explicitly rejected by the underlying
 *     endpoints; this UI surfaces the rejection rather than hiding it.
 *   - We never re-derive trust client-side. Every step is server-
 *     verified.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { safeFetchJson, parseJsonResponse } from '@/lib/utils/safeFetchJson';
import { classifyAuthFailure, describeAuthFailure, type AuthFailure } from '@/lib/security/superAdminAuthFailure';
import { runStepUpFlowIfNeeded, describeStepUpOutcome } from '@/lib/security/superAdminStepUp';
import { Shield, KeyRound, Smartphone, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

interface PasskeyRow {
  id: string;
  label: string | null;
  deviceType: string | null;
  isBackedUp: boolean | null;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SecurityTab() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollLabel, setEnrollLabel] = useState('');
  const [trustingDevice, setTrustingDevice] = useState(false);
  const [authFailure, setAuthFailure] = useState<AuthFailure | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadPasskeys = useCallback(async () => {
    setLoadingPasskeys(true);
    try {
      const response = await fetchWithAuth('/api/auth/passkeys');
      if (!response.ok) {
        const failure = await classifyAuthFailure(response);
        if (failure.kind !== 'ok') setAuthFailure(failure);
        return;
      }
      setAuthFailure(null);
      const parsed = await parseJsonResponse<{ credentials: PasskeyRow[] }>(response, '/api/auth/passkeys');
      if (parsed.ok === true) setPasskeys(parsed.data.credentials || []);
    } catch (err) {
      setStatusMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load passkeys' });
    } finally {
      setLoadingPasskeys(false);
    }
  }, []);

  useEffect(() => { void loadPasskeys(); }, [loadPasskeys]);

  const enrollPasskey = async () => {
    setEnrolling(true);
    setStatusMsg(null);
    try {
      // Step 1 — begin registration; server stores a one-shot challenge.
      const begin = await fetchWithAuth('/api/auth/passkeys/begin-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!begin.ok) {
        const failure = await classifyAuthFailure(begin);
        if (failure.kind !== 'ok') setAuthFailure(failure);
        setStatusMsg({ type: 'error', text: failure.kind !== 'ok' ? describeAuthFailure(failure) : 'Failed to begin enrollment' });
        return;
      }
      const options = await begin.json() as PublicKeyCredentialCreationOptionsJSON;

      // Step 2 — browser-side WebAuthn ceremony.
      let attestation: RegistrationResponseJSON;
      try {
        attestation = await startRegistration({ optionsJSON: options });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMsg({ type: 'error', text: `Passkey ceremony failed: ${msg}` });
        return;
      }

      // Step 3 — verify on server, persist credential, audit.
      const verify = await safeFetchJson<{ verified: boolean }>('/api/auth/passkeys/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          response: attestation,
          label: enrollLabel || null,
        }),
      });
      if (verify.ok !== true) {
        setStatusMsg({ type: 'error', text: verify.message });
        return;
      }
      setStatusMsg({ type: 'success', text: 'Passkey enrolled successfully.' });
      setEnrollLabel('');
      await loadPasskeys();
    } finally {
      setEnrolling(false);
    }
  };

  const trustThisDevice = async () => {
    setTrustingDevice(true);
    setStatusMsg(null);
    try {
      // /api/auth/devices/trust requires `principal.stepUp.active === true`.
      // To remove the chicken-and-egg (operator can't get step-up without
      // triggering it, but the trust button doesn't trigger it), we wrap the
      // call in `runStepUpFlowIfNeeded`: if the first call returns
      // STEP_UP_REQUIRED, the helper auto-launches the WebAuthn passkey
      // challenge, mints a stepup_session, and retries the trust call once.
      const fire = () => fetchWithAuth('/api/auth/devices/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Super-admin browser' }),
      });

      const initial = await fire();
      const outcome = await runStepUpFlowIfNeeded(initial, fire, {
        onChallengeStart: () => setStatusMsg({ type: 'success', text: 'Confirm with your passkey to trust this device…' }),
      });

      if (outcome.kind === 'success') {
        setAuthFailure(null);
        setStatusMsg({ type: 'success', text: 'Device trusted. Trusted-device step-up will satisfy elevated capabilities until revoked.' });
      } else if (outcome.kind === 'session_lost') {
        setAuthFailure(outcome.failure);
        setStatusMsg({ type: 'error', text: describeAuthFailure(outcome.failure) });
      } else if (outcome.kind === 'step_up_user_cancelled' || outcome.kind === 'step_up_unavailable') {
        setStatusMsg({ type: 'error', text: describeStepUpOutcome(outcome) });
      } else {
        // auth_banner — capability not held / bridge / unknown
        setAuthFailure(outcome.failure);
        setStatusMsg({ type: 'error', text: describeAuthFailure(outcome.failure) });
      }
    } finally {
      setTrustingDevice(false);
    }
  };

  return (
    <div className="space-y-6">
      {authFailure && authFailure.kind !== 'ok' && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-amber-900">{describeAuthFailure(authFailure)}</div>
              {authFailure.correlationId && (
                <div className="mt-1 text-xs text-amber-800">
                  Correlation id: <span className="font-mono">{authFailure.correlationId}</span>
                </div>
              )}
              {/*
                Failure-kind-specific guidance. Previously this slot showed an
                unconditional "Bridge-cookie sessions cannot enroll passkeys"
                line, which was misleading for canonical SUPER_ADMINs hitting
                step-up or capability denials. The text below is selected
                strictly by the classifier's `kind`.
              */}
              {authFailure.kind === 'bridge_factor_insufficient' && (
                <div className="mt-2 text-xs text-amber-800">
                  Bridge-cookie sessions cannot enroll passkeys or trust devices. Sign in via Supabase
                  as the canonical SUPER_ADMIN (provisioned via{' '}
                  <span className="font-mono">/api/admin/bootstrap-super-admin</span>) to use this tab.
                </div>
              )}
              {authFailure.kind === 'step_up_required' && (
                <div className="mt-2 text-xs text-amber-800">
                  Click the button again to launch the passkey challenge. Once you confirm with your
                  passkey, the action will retry automatically. (You must have at least one passkey
                  enrolled — use the &quot;Enroll passkey&quot; button above first.)
                </div>
              )}
              {authFailure.kind === 'trusted_device_required' && (
                <div className="mt-2 text-xs text-amber-800">
                  This action requires a trusted device. Confirm with your passkey on a browser you
                  intend to keep using, then click &quot;Trust this device&quot;.
                </div>
              )}
              {authFailure.kind === 'capability_not_held' && (
                <div className="mt-2 text-xs text-amber-800">
                  Your account does not hold the capability needed for this action. If you believe this
                  is wrong, check that your{' '}
                  <span className="font-mono">user_company_roles</span> row is{' '}
                  <span className="font-mono">role=&apos;SUPER_ADMIN&apos;, status=&apos;active&apos;</span>.
                </div>
              )}
              {authFailure.kind === 'not_authenticated' && (
                <div className="mt-2 text-xs text-amber-800">
                  Your session has expired. Sign in again to continue.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50"><Shield className="h-5 w-5 text-indigo-600" /></div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Passkeys</h3>
              <p className="text-sm text-gray-500">Step-up actions (managing OAuth credentials, billing, identity changes) require a passkey.</p>
            </div>
          </div>
          <button
            onClick={loadPasskeys}
            disabled={loadingPasskeys}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loadingPasskeys ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {passkeys.length === 0 && !loadingPasskeys && (
            <div className="text-sm text-gray-500">No passkeys enrolled on this account yet.</div>
          )}

          {passkeys.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-gray-500" />
                <div>
                  <div className="text-sm font-medium text-gray-900">{row.label || '(unlabeled)'}</div>
                  <div className="text-xs text-gray-500">
                    {row.deviceType ?? 'unknown device'} · enrolled {new Date(row.createdAt).toLocaleString()}
                    {row.lastUsedAt && ` · last used ${new Date(row.lastUsedAt).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle className="h-3 w-3" />
                Active
              </span>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <input
              type="text"
              value={enrollLabel}
              onChange={(event) => setEnrollLabel(event.target.value)}
              placeholder="Label (e.g. MacBook Touch ID, YubiKey 5C)"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={enrollPasskey}
              disabled={enrolling}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              {enrolling ? 'Enrolling…' : 'Enroll passkey'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50"><Smartphone className="h-5 w-5 text-blue-600" /></div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Trusted device</h3>
            <p className="text-sm text-gray-500">
              Some capabilities (platform OAuth credential management, identity admin, org transfer) require BOTH a passkey AND a trusted device.
              Trusting requires an active step-up session — perform a privileged action first, complete the passkey challenge, then return here.
            </p>
          </div>
        </div>
        <div className="px-6 py-4">
          <button
            onClick={trustThisDevice}
            disabled={trustingDevice}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Smartphone className="h-4 w-4" />
            {trustingDevice ? 'Trusting…' : 'Trust this device'}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            statusMsg.type === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {statusMsg.text}
        </div>
      )}
    </div>
  );
}
