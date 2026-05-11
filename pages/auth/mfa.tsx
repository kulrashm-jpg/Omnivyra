import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';

type Factor = 'totp' | 'webauthn' | 'recovery_code';

/**
 * /auth/mfa — challenge page that exchanges a server-issued mfa_intent
 * cookie for a real auth_session via /api/auth/mfa-verify. The page is
 * reached from /auth/callback when the server returns mfa_required.
 *
 * The user picks an available factor:
 *   - WebAuthn (passkey, security key)
 *   - TOTP (authenticator app code)
 *   - Recovery code
 *
 * On success the server attaches the new auth_session cookie and we
 * navigate to /. The home route then runs its own post-login-route
 * resolution and lands the user where they belong.
 */

export default function MfaChallengePage() {
  const router = useRouter();
  const factorsParam = typeof router.query.factors === 'string' ? router.query.factors : '';
  const availableFactors: Factor[] = useMemo(() => {
    const list = factorsParam.split(',').filter(Boolean) as Factor[];
    const valid: Factor[] = [];
    for (const f of list) {
      if (f === 'totp' || f === 'webauthn' || f === 'recovery_code') valid.push(f);
    }
    if (valid.length === 0) return ['totp', 'webauthn', 'recovery_code'];
    if (!valid.includes('recovery_code')) valid.push('recovery_code');
    return valid;
  }, [factorsParam]);

  const initialFactor: Factor = availableFactors.includes('webauthn')
    ? 'webauthn'
    : availableFactors[0] ?? 'totp';

  const [activeFactor, setActiveFactor] = useState<Factor>(initialFactor);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const submitTotp = useCallback(async () => {
    setError(null);
    if (!code.trim()) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/mfa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factor: 'totp', token: code.trim() }),
      });
      await handleResponse(r);
    } finally {
      setBusy(false);
    }
  }, [code]);

  const submitRecovery = useCallback(async () => {
    setError(null);
    if (!recovery.trim()) {
      setError('Enter one of your recovery codes.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/mfa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factor: 'recovery_code', code: recovery.trim() }),
      });
      await handleResponse(r);
    } finally {
      setBusy(false);
    }
  }, [recovery]);

  const submitWebAuthn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const beginRes = await fetch('/api/auth/passkeys/begin-authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!beginRes.ok) {
        setError('Could not start passkey challenge. Try again.');
        return;
      }
      const options = (await beginRes.json()) as PublicKeyCredentialRequestOptionsJSON;
      const assertion = await startAuthentication({ optionsJSON: options });
      const r = await fetch('/api/auth/mfa-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factor: 'webauthn', response: assertion }),
      });
      await handleResponse(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey challenge cancelled.');
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleResponse(r: Response) {
    if (r.ok) {
      // Auth session cookie is now attached. If the caller threaded a
      // `next` param through (e.g. /super-admin/login forwards
      // `next=/super-admin/dashboard` so platform operators don't get
      // detoured through the tenant command-center), honor it. Otherwise
      // land on the home route, which runs post-login-route and forwards
      // to the right destination.
      router.replace(safeNextDestination(router.query.next) ?? '/');
      return;
    }
    if (r.status === 429) {
      const data = (await r.clone().json().catch(() => ({}))) as { retryAfterSeconds?: number };
      setRetryAfterSeconds(data.retryAfterSeconds ?? 60);
      setError('Too many attempts. Wait a moment and try again.');
      return;
    }
    if (r.status === 401) {
      const data = (await r.clone().json().catch(() => ({}))) as { code?: string };
      if (data.code === 'MFA_INTENT_INVALID' || data.code === 'MFA_INTENT_STALE') {
        setError('Your sign-in session expired. Please sign in again.');
        setTimeout(() => router.replace('/login'), 1500);
        return;
      }
      setError('That code did not match. Try again.');
      return;
    }
    if (r.status === 403) {
      setError('Account unavailable. Please contact support.');
      setTimeout(() => router.replace('/login'), 1500);
      return;
    }
    setError('Could not complete the challenge. Try again.');
  }

  // Render
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Confirm it&apos;s you</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your account requires a second factor before signing in.
          </p>
        </div>

        {availableFactors.length > 1 && (
          <div className="flex gap-2 border-b border-slate-200 pb-3">
            {availableFactors.includes('webauthn') && (
              <FactorTab active={activeFactor === 'webauthn'} onClick={() => setActiveFactor('webauthn')} label="Passkey" />
            )}
            {availableFactors.includes('totp') && (
              <FactorTab active={activeFactor === 'totp'} onClick={() => setActiveFactor('totp')} label="Authenticator" />
            )}
            <FactorTab active={activeFactor === 'recovery_code'} onClick={() => setActiveFactor('recovery_code')} label="Recovery code" />
          </div>
        )}

        {activeFactor === 'webauthn' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Click below and follow your device&apos;s prompt — fingerprint, face, PIN, or hardware key.
            </p>
            <button
              type="button"
              onClick={submitWebAuthn}
              disabled={busy}
              className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Waiting for passkey…' : 'Use passkey'}
            </button>
          </div>
        )}

        {activeFactor === 'totp' && (
          <form
            onSubmit={(e) => { e.preventDefault(); void submitTotp(); }}
            className="space-y-3"
          >
            <label className="block text-sm font-medium text-slate-700">
              6-digit code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                disabled={busy}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base tracking-widest font-mono"
                placeholder="123 456"
              />
            </label>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Verify'}
            </button>
          </form>
        )}

        {activeFactor === 'recovery_code' && (
          <form
            onSubmit={(e) => { e.preventDefault(); void submitRecovery(); }}
            className="space-y-3"
          >
            <label className="block text-sm font-medium text-slate-700">
              Recovery code
              <input
                type="text"
                autoComplete="one-time-code"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value.toUpperCase())}
                disabled={busy}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base font-mono"
                placeholder="ABCD-EFGH-IJKL-MNOP"
              />
            </label>
            <p className="text-xs text-slate-500">
              Each recovery code works only once. After signing in, generate new codes from <span className="font-medium">Settings → Security</span>.
            </p>
            <button
              type="submit"
              disabled={busy || recovery.replace(/[-\s]/g, '').length < 16}
              className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Use recovery code'}
            </button>
          </form>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
            {retryAfterSeconds && retryAfterSeconds > 0 ? ` (retry in ~${retryAfterSeconds}s)` : ''}
          </div>
        )}

        <CountdownEffect seconds={retryAfterSeconds} onElapsed={() => setRetryAfterSeconds(null)} />
      </div>
    </div>
  );
}

/**
 * Accept a `next` query value only when it is a same-origin app path.
 * Rejects absolute URLs, protocol-relative URLs, and anything not starting
 * with a single `/` so an attacker can't craft `?next=https://evil.com`
 * and ride the post-MFA redirect off-site.
 */
function safeNextDestination(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  return decoded;
}

function FactorTab(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        'rounded-md px-3 py-1.5 text-sm font-medium ' +
        (props.active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100')
      }
    >
      {props.label}
    </button>
  );
}

function CountdownEffect(props: { seconds: number | null; onElapsed: () => void }) {
  useEffect(() => {
    if (!props.seconds) return;
    const t = setTimeout(props.onElapsed, props.seconds * 1000);
    return () => clearTimeout(t);
  }, [props.seconds, props.onElapsed]);
  return null;
}
