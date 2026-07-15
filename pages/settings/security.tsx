/**
 * Security settings page — MFA / passkeys / TOTP / recovery codes /
 * trusted devices / active sessions.
 *
 * Wave 2C-B scope: minimal but functional dashboard. Server-authoritative:
 *   - All state hydrated from /api/auth/*.
 *   - No local capability derivation, no local step-up trust.
 *   - Sensitive actions (revoke) use withStepUp() to handle the
 *     STEP_UP_REQUIRED retry transparently.
 *
 * Wave 2C-C will polish the UX (loading states, error toasts, layout).
 */

import { useVisibilityPolling } from '../../lib/client/dataKit'; // W5-6
import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import {
  fetchSessionSnapshot,
  fetchCapabilities,
  logoutCurrentSession,
  type FrontendSessionSnapshot,
  type FrontendCapabilitiesSnapshot,
} from '@/lib/security/sessionClient';
import { withStepUp, triggerWebAuthnStepUp, STEP_UP_ELEVATED_EVENT } from '@/lib/security/stepUpClient';
import { startRegistration } from '@simplewebauthn/browser';

// ── Shared types (mirror server route shapes) ────────────────────────────────

interface PasskeyRow {
  id: string;
  label: string | null;
  deviceType: string | null;
  isBackedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface DeviceRow {
  id: string;
  label: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function jsonOrThrow<T>(r: Response): Promise<T> {
  // Phase: Global Fetch Hardening — validate content-type on BOTH success
  // and failure paths. Previously the success path called r.json() directly
  // and could throw "Unexpected token '<'" if the response was a 200 with
  // an HTML body (rare but possible from upstream interceptors).
  const contentType = r.headers.get('content-type') ?? '';
  const isJson = /\bapplication\/(?:json|problem\+json)\b/i.test(contentType);
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Request failed: ${r.status} ${isJson ? detail : `(${contentType || 'no content-type'}) ${detail.slice(0, 200)}`}`);
  }
  if (!isJson) {
    const snippet = await r.text().catch(() => '');
    throw new Error(`Expected JSON response, got ${contentType || 'no content-type'} (status ${r.status}): ${snippet.slice(0, 200)}`);
  }
  return await r.json() as T;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// ── Top-level page ───────────────────────────────────────────────────────────

export default function SecuritySettingsPage() {
  const [session, setSession] = useState<FrontendSessionSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<FrontendCapabilitiesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const reloadAuthState = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchSessionSnapshot(), fetchCapabilities()]);
      // Wave 2C-C: revoked-session detection. If the server reports
      // unauthenticated where we previously had a session, redirect to
      // /login so the user re-authenticates. We do this BEFORE setState
      // so the dashboard never renders a stale-state mismatch.
      if (s === null && session !== null) {
        window.location.href = '/login?reason=session_revoked';
        return;
      }
      setSession(s);
      setCapabilities(c);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    }
  }, [session]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await reloadAuthState();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh session + capability projections when any nested action
  // performs a step-up — the auth_session may have been rotated and the
  // capability set may now include elevated entries for the next 10 min.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => { void reloadAuthState(); };
    window.addEventListener(STEP_UP_ELEVATED_EVENT, handler);
    return () => window.removeEventListener(STEP_UP_ELEVATED_EVENT, handler);
  }, [reloadAuthState]);

  // Periodic stale-session check: every 60s, refresh session snapshot.
  // Catches revoked-on-another-device cases without requiring user action.
  // W5-6 (audit B-77): visibility-aware — hidden tabs stop polling and the
  // check fires immediately on return (which is exactly when a revoked
  // session matters). Same cadence while visible.
  useVisibilityPolling(() => { void reloadAuthState(); }, 60_000);

  if (loading) {
    return <div style={{ padding: 24 }}>Loading security settings…</div>;
  }
  if (!session) {
    return <div style={{ padding: 24 }}>You must be signed in to view security settings.</div>;
  }
  if (session.legacyCookieSuperAdmin) {
    return (
      <div style={{ padding: 24 }}>
        Security settings are not available to legacy cookie super-admin sessions. Please sign in
        with a Supabase user account.
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Security settings</title>
      </Head>
      <main style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Security</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>
          Manage your authenticators, recovery codes, trusted devices, and active sessions.
        </p>

        {globalError ? (
          <div style={{
            background: '#fee2e2', border: '1px solid #ef4444', padding: 12,
            borderRadius: 6, marginBottom: 16, color: '#991b1b',
          }}>
            {globalError}
          </div>
        ) : null}

        <AuthStateSection session={session} capabilities={capabilities} />
        <PasskeysSection onChanged={reloadAuthState} />
        <TotpSection session={session} onChanged={reloadAuthState} />
        <RecoveryCodesSection />
        <TrustedDevicesSection onChanged={reloadAuthState} />
        <ActiveSessionsSection onChanged={reloadAuthState} />
      </main>
    </>
  );
}

// ── Auth-state summary ───────────────────────────────────────────────────────

function AuthStateSection({
  session,
  capabilities,
}: {
  session: FrontendSessionSnapshot;
  capabilities: FrontendCapabilitiesSnapshot | null;
}) {
  const lastVerified = session.mfa.lastVerifiedAt ? fmtDate(session.mfa.lastVerifiedAt) : 'never';
  const stepUpExpiry = session.stepUp.active ? fmtDate(session.stepUp.expiresAt) : '—';
  return (
    <Card title="Authenticator state">
      <KV label="Email" value={`${session.user?.email ?? '—'}${session.user?.emailVerified ? ' (verified)' : ''}`} />
      <KV label="Factors enrolled" value={session.mfa.factors.length === 0 ? 'none' : session.mfa.factors.join(', ')} />
      <KV label="Last MFA verification" value={lastVerified} />
      <KV label="Phishing-resistant verification" value={session.mfa.phishingResistant ? 'yes' : 'no'} />
      <KV label="Active step-up" value={session.stepUp.active ? `yes (expires ${stepUpExpiry})` : 'no'} />
      <KV label="Trusted device" value={session.device.trusted ? 'yes' : 'no'} />
      <KV label="Capabilities held" value={capabilities ? String(capabilities.capabilities.length) : '—'} />
    </Card>
  );
}

// ── Passkeys ─────────────────────────────────────────────────────────────────

function PasskeysSection({ onChanged }: { onChanged: () => Promise<void> }) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/passkeys', { credentials: 'same-origin' });
      const data = await jsonOrThrow<{ credentials: PasskeyRow[] }>(r);
      setPasskeys(data.credentials);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function enroll() {
    setBusy(true); setErr(null);
    try {
      const optionsRes = await fetch('/api/auth/passkeys/begin-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const options = await jsonOrThrow<Parameters<typeof startRegistration>[0]['optionsJSON']>(optionsRes);
      const attestation = await startRegistration({ optionsJSON: options });
      await jsonOrThrow(await fetch('/api/auth/passkeys/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ response: attestation }),
      }));
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true); setErr(null);
    try {
      // mfa.revoke is step-up-required; withStepUp handles the challenge.
      const r = await withStepUp(() => fetch('/api/auth/passkeys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id, reason: 'user_initiated_via_settings' }),
      }));
      if (!r.ok) throw new Error(`Revoke failed: ${r.status}`);
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Passkeys">
      {err ? <ErrorRow message={err} /> : null}
      <div style={{ marginBottom: 12 }}>
        <button onClick={enroll} disabled={busy} style={btn}>
          {busy ? 'Working…' : 'Enroll new passkey'}
        </button>
      </div>
      {passkeys === null
        ? (err
            ? <button onClick={() => { setErr(null); void reload(); }} style={btn}>Retry</button>
            : <div>Loading…</div>)
        : passkeys.length === 0 ? <div style={muted}>No passkeys registered.</div>
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {passkeys.map((p) => (
              <li key={p.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.label ?? p.deviceType ?? 'Passkey'}</div>
                  <div style={muted}>
                    Created {fmtDate(p.createdAt)} · Last used {fmtDate(p.lastUsedAt)}
                    {p.isBackedUp ? ' · synced' : ' · device-bound'}
                  </div>
                </div>
                <button onClick={() => revoke(p.id)} disabled={busy} style={btnDanger}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

// ── TOTP ─────────────────────────────────────────────────────────────────────

function TotpSection({ session, onChanged }: { session: FrontendSessionSnapshot; onChanged: () => Promise<void> }) {
  const enrolled = session.mfa.factors.includes('totp');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enrollState, setEnrollState] = useState<{ factorId: string; otpauthUri: string; secret: string } | null>(null);
  const [token, setToken] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<ReadonlyArray<string> | null>(null);

  async function start() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/totp/begin-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const data = await jsonOrThrow<{ factorId: string; otpauthUri: string; secret: string }>(r);
      setEnrollState(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function activate() {
    if (!enrollState) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/totp/verify-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ factorId: enrollState.factorId, token: token.trim() }),
      });
      const data = await jsonOrThrow<{ recoveryCodes: ReadonlyArray<string> }>(r);
      setRecoveryCodes(data.recoveryCodes);
      setEnrollState(null);
      setToken('');
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true); setErr(null);
    try {
      const r = await withStepUp(() => fetch('/api/auth/totp/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'user_initiated_via_settings' }),
      }));
      if (!r.ok) throw new Error(`Revoke failed: ${r.status}`);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Card title="Authenticator app (TOTP)">
      {err ? <ErrorRow message={err} /> : null}

      {!enrolled && !enrollState ? (
        <div>
          <p style={muted}>No authenticator app enrolled.</p>
          <button onClick={start} disabled={busy} style={btn}>Set up authenticator app</button>
        </div>
      ) : null}

      {enrollState ? (
        <div>
          <p>Scan the QR or paste the secret into your authenticator app.</p>
          <KV label="otpauth URI" value={enrollState.otpauthUri} />
          <KV label="Secret" value={enrollState.secret} />
          <input
            value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="6-digit code" maxLength={8}
            style={{ padding: 8, marginRight: 8, fontFamily: 'monospace' }}
          />
          <button onClick={activate} disabled={busy || token.length < 6} style={btn}>
            Verify and enable
          </button>
        </div>
      ) : null}

      {recoveryCodes ? (
        <div style={{ marginTop: 16, padding: 12, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6 }}>
          <strong>Save these recovery codes.</strong> They will not be shown again.
          <pre style={{ margin: '8px 0', fontFamily: 'monospace' }}>
            {recoveryCodes.join('\n')}
          </pre>
        </div>
      ) : null}

      {enrolled && !enrollState ? (
        <button onClick={revoke} disabled={busy} style={btnDanger}>Remove authenticator app</button>
      ) : null}
    </Card>
  );
}

// ── Recovery codes ───────────────────────────────────────────────────────────

function RecoveryCodesSection() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<ReadonlyArray<string> | null>(null);

  async function regenerate() {
    setBusy(true); setErr(null);
    try {
      // Wave 2C-C: standalone regenerate endpoint. Gated on mfa.revoke +
      // phishing-resistant step-up. withStepUp launches a WebAuthn
      // challenge on 401 STEP_UP_REQUIRED and retries once.
      const r = await withStepUp(() => fetch('/api/auth/totp/recovery/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      }));
      if (!r.ok) throw new Error(`Regenerate failed: ${r.status}`);
      const data = await r.json() as { codes: ReadonlyArray<string>; batchId: string };
      setCodes(data.codes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Card title="Recovery codes">
      <p style={muted}>
        Each code can be used once to sign in if you lose access to your authenticator. Regenerating
        revokes any unused codes from a previous batch and requires a passkey verification.
      </p>
      {err ? <ErrorRow message={err} /> : null}
      <button onClick={regenerate} disabled={busy} style={btn}>
        {busy ? 'Working…' : 'Regenerate recovery codes'}
      </button>
      {codes ? (
        <div style={{ marginTop: 8 }}>
          <strong>Save these codes — they will not be shown again.</strong>
          <pre style={{ marginTop: 8, padding: 12, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6 }}>
            {codes.join('\n')}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}

// ── Trusted devices ──────────────────────────────────────────────────────────

function TrustedDevicesSection({ onChanged }: { onChanged: () => Promise<void> }) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/devices', { credentials: 'same-origin' });
      const data = await jsonOrThrow<{ devices: DeviceRow[] }>(r);
      setDevices(data.devices);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function trustCurrent() {
    setBusy(true); setErr(null);
    try {
      // Trusting a device requires step-up — withStepUp handles the challenge.
      const r = await withStepUp(() => fetch('/api/auth/devices/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ label: 'this browser' }),
      }));
      if (!r.ok) throw new Error(`Trust failed: ${r.status}`);
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/devices/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id, reason: 'user_initiated_via_settings' }),
      });
      if (!r.ok) throw new Error(`Revoke failed: ${r.status}`);
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const currentTrusted = devices?.some((d) => d.isCurrent) ?? false;

  return (
    <Card title="Trusted devices">
      {err ? <ErrorRow message={err} /> : null}
      {!currentTrusted ? (
        <div style={{ marginBottom: 12 }}>
          <button onClick={trustCurrent} disabled={busy} style={btn}>
            Trust this browser
          </button>
        </div>
      ) : null}
      {devices === null
        ? (err
            ? <button onClick={() => { setErr(null); void reload(); }} style={btn}>Retry</button>
            : <div>Loading…</div>)
        : devices.length === 0 ? <div style={muted}>No trusted devices.</div>
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {devices.map((d) => (
              <li key={d.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {d.label ?? 'Device'} {d.isCurrent ? <span style={{ color: '#065f46' }}>(this)</span> : null}
                  </div>
                  <div style={muted}>
                    Trusted {fmtDate(d.firstSeenAt)} · Last seen {fmtDate(d.lastSeenAt)} · Expires {fmtDate(d.expiresAt)}
                  </div>
                </div>
                <button onClick={() => revoke(d.id)} disabled={busy} style={btnDanger}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

// ── Active sessions ──────────────────────────────────────────────────────────

function ActiveSessionsSection({ onChanged }: { onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/sessions/list', { credentials: 'same-origin' });
      const data = await jsonOrThrow<{ sessions: SessionRow[] }>(r);
      setSessions(data.sessions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function revokeOne(id: string, isCurrent: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`Revoke failed: ${r.status}`);
      if (isCurrent) {
        // Revoked own session — sign-out client-side too.
        await logoutCurrentSession().catch(() => undefined);
        window.location.href = '/login';
        return;
      }
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function revokeOthers() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ revokeOthers: true }),
      });
      if (!r.ok) throw new Error(`Revoke failed: ${r.status}`);
      await reload();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const otherCount = (sessions ?? []).filter((s) => !s.isCurrent).length;

  return (
    <Card title="Active sessions">
      {err ? <ErrorRow message={err} /> : null}
      {otherCount > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <button onClick={revokeOthers} disabled={busy} style={btnDanger}>
            Sign out of all other sessions ({otherCount})
          </button>
        </div>
      ) : null}
      {sessions === null ? <div>Loading…</div>
        : sessions.length === 0 ? <div style={muted}>No active sessions.</div>
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {s.userAgent?.slice(0, 64) ?? 'Unknown browser'}{' '}
                    {s.isCurrent ? <span style={{ color: '#065f46' }}>(this session)</span> : null}
                  </div>
                  <div style={muted}>
                    {s.ip ?? 'unknown ip'} · Started {fmtDate(s.createdAt)} · Last seen {fmtDate(s.lastSeenAt)}
                  </div>
                </div>
                <button onClick={() => revokeOne(s.id, s.isCurrent)} disabled={busy} style={btnDanger}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

// ── Tiny presentation helpers ───────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16,
      background: '#fff',
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
      <span style={{ ...muted, minWidth: 220 }}>{label}</span>
      <span style={{ fontFamily: 'inherit', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div style={{
      background: '#fee2e2', border: '1px solid #ef4444',
      padding: 8, borderRadius: 4, marginBottom: 12, color: '#991b1b',
    }}>{message}</div>
  );
}

const muted: React.CSSProperties = { color: '#6b7280' };
const btn: React.CSSProperties = {
  background: '#111', color: '#fff', border: 'none', padding: '8px 14px',
  borderRadius: 6, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  background: '#dc2626', color: '#fff', border: 'none', padding: '6px 10px',
  borderRadius: 6, cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 0', borderTop: '1px solid #f3f4f6',
};
