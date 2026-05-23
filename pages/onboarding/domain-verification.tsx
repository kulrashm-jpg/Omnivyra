'use client';

/**
 * /onboarding/domain-verification
 *
 * Domain-ownership onboarding screen.
 *
 * Sections (per spec):
 *   1. Header — title + subtitle (final_domain interpolated)
 *   2. Status — pending / verified
 *   3. Instructions — DNS (recommended) + HTTP (alternative), with copy buttons
 *   4. Action — Verify domain CTA + Skip for now
 *
 * Token surfacing:
 *   - Read once from sessionStorage (key domain_verification_token_v1) which
 *     was populated by pages/auth/callback.tsx after sync-supabase-user.
 *   - The DB stores HMAC(token); the server cannot return the raw value.
 *   - When the token is absent we surface the "Generate new token" fallback
 *     (calls a future regenerate endpoint).
 *
 * Tracking events emitted via POST /api/domain/track-event:
 *   - VIEW_DOMAIN_VERIFICATION (once on first render)
 *   - CLICK_VERIFY (every Verify button press)
 *   - VERIFICATION_SUCCESS (UI mirror of server success)
 *   - VERIFICATION_FAILED (UI mirror of server fail)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAuthToken } from '../../utils/getAuthToken';
import { apiFetch } from '../../lib/apiFetch';

const DOMAIN_TOKEN_KEY = 'domain_verification_token_v1';
const RETRY_INTERVALS_MS = [30_000, 60_000, 120_000];

type Status = 'unverified' | 'pending' | 'verified' | 'admin_override';

type StatusResponse = {
  final_domain: string;
  verification_status: Status;
  verification_method: string | null;
  verified_at: string | null;
  token: null;
  token_issued: boolean;
  instructions: { dns: string; http: string };
};

type CarriedToken = { token: string; final_domain: string };

function readCarriedToken(): CarriedToken | null {
  try {
    const raw = window.sessionStorage.getItem(DOMAIN_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CarriedToken;
    if (parsed?.token && parsed?.final_domain) return parsed;
    return null;
  } catch { return null; }
}

async function trackEvent(event: string, opts?: {
  final_domain?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await apiFetch('/api/domain/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        final_domain: opts?.final_domain ?? null,
        metadata:     opts?.metadata     ?? null,
      }),
    });
  } catch { /* fire-and-forget */ }
}

export default function DomainVerificationPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'pending' | 'verified' | 'no-domain' | 'error' | 'forbidden'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [carriedToken, setCarriedToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    | null
    | { kind: 'success'; method: string }
    | { kind: 'failure'; details?: string }
  >(null);
  const [copied, setCopied] = useState<string | null>(null); // which copy button clicked
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<number>(0); // 1..3 while a retry is pending
  const [retrySecondsLeft, setRetrySecondsLeft] = useState<number>(0);
  const viewTracked = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) {
          if (!cancelled) router.replace('/login?next=/onboarding/domain-verification');
          return;
        }
        const carried = readCarriedToken();
        if (!cancelled && carried) setCarriedToken(carried.token);

        const res = await apiFetch('/api/domain/verification-status', {
          method: 'GET',
        });
        if (cancelled) return;
        if (res.status === 404) {
          setPhase('no-domain');
          return;
        }
        if (res.status === 403) {
          setPhase('forbidden');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body?.details ?? body?.error ?? `Status ${res.status}`);
          setPhase('error');
          return;
        }
        const data = (await res.json()) as StatusResponse;
        setStatus(data);
        if (data.verification_status === 'verified' || data.verification_status === 'admin_override') {
          setPhase('verified');
        } else {
          setPhase('pending');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg((err as Error)?.message ?? 'Network error.');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // VIEW event — fire once on first render of the pending screen.
  useEffect(() => {
    if (viewTracked.current) return;
    if (phase === 'pending' && status) {
      viewTracked.current = true;
      void trackEvent('VIEW_DOMAIN_VERIFICATION', {
        final_domain: status.final_domain,
      });
    }
  }, [phase, status]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
    } catch { /* clipboard blocked */ }
  }

  /**
   * Single-shot verify call. Returns true on success, false otherwise.
   * Updates state + emits tracking events. Used by both the manual button
   * and the auto-retry loop.
   */
  const runVerify = useCallback(async (
    opts: { source: 'manual' | 'auto' } = { source: 'manual' },
  ): Promise<boolean> => {
    if (!status) return false;
    setVerifying(true);
    setVerifyResult(null);
    if (opts.source === 'manual') {
      void trackEvent('CLICK_VERIFY', { final_domain: status.final_domain });
    }
    try {
      const res = await apiFetch('/api/domain/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: status.final_domain }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.status === 'verified') {
        setVerifyResult({ kind: 'success', method: body.method ?? 'unknown' });
        setStatus({
          ...status,
          verification_status: 'verified',
          verification_method: body.method ?? null,
          verified_at: new Date().toISOString(),
        });
        setPhase('verified');
        try { window.sessionStorage.removeItem(DOMAIN_TOKEN_KEY); } catch { /* ignore */ }
        void trackEvent('VERIFICATION_SUCCESS', {
          final_domain: status.final_domain,
          metadata: { method: body.method ?? null, source: opts.source },
        });
        return true;
      }
      const details = body?.details ?? body?.code ?? `Status ${res.status}`;
      setVerifyResult({ kind: 'failure', details });
      void trackEvent('VERIFICATION_FAILED', {
        final_domain: status.final_domain,
        metadata: { code: body?.code ?? null, details, source: opts.source },
      });
      return false;
    } catch (err) {
      const details = (err as Error)?.message ?? 'Network error.';
      setVerifyResult({ kind: 'failure', details });
      void trackEvent('VERIFICATION_FAILED', {
        final_domain: status?.final_domain ?? null,
        metadata: { details, source: opts.source },
      });
      return false;
    } finally {
      setVerifying(false);
    }
  }, [status]);

  function clearRetryTimers() {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (tickTimer.current)  { clearInterval(tickTimer.current);  tickTimer.current  = null; }
  }

  /**
   * Auto-retry the verify call up to 3 times at 30s / 60s / 120s. Cancellable
   * by a manual click, by component unmount, or by reaching the cap. UI shows
   * a live countdown 'Re-checking in Ns…' while waiting.
   */
  const scheduleRetry = useCallback((attempt: number) => {
    if (attempt < 1 || attempt > RETRY_INTERVALS_MS.length) return;
    const delayMs = RETRY_INTERVALS_MS[attempt - 1];
    setRetryAttempt(attempt);
    setRetrySecondsLeft(Math.round(delayMs / 1000));

    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = setInterval(() => {
      setRetrySecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(async () => {
      if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; }
      const ok = await runVerify({ source: 'auto' });
      if (ok) {
        setRetryAttempt(0);
        setRetrySecondsLeft(0);
        return;
      }
      if (attempt < RETRY_INTERVALS_MS.length) {
        scheduleRetry(attempt + 1);
      } else {
        setRetryAttempt(0);
        setRetrySecondsLeft(0);
      }
    }, delayMs);
  }, [runVerify]);

  async function onVerify() {
    clearRetryTimers();
    setRetryAttempt(0);
    setRetrySecondsLeft(0);
    const ok = await runVerify({ source: 'manual' });
    if (!ok) scheduleRetry(1);
  }

  // Cancel any pending retry on unmount.
  useEffect(() => () => clearRetryTimers(), []);

  async function onRegenerateToken() {
    if (!status) return;
    const confirmed = window.confirm(
      'Generating a new token will invalidate your existing DNS/file record.\n\n'
      + 'Do you want to continue?',
    );
    if (!confirmed) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await apiFetch('/api/domain/regenerate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: status.final_domain }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRegenError('Only an admin can regenerate this domain\'s token.');
        return;
      }
      if (!res.ok || !body?.token) {
        setRegenError(body?.details ?? body?.error ?? `Status ${res.status}`);
        return;
      }
      setCarriedToken(body.token as string);
      try {
        window.sessionStorage.setItem(
          DOMAIN_TOKEN_KEY,
          JSON.stringify({ token: body.token, final_domain: status.final_domain }),
        );
      } catch { /* sessionStorage blocked — UI still has the token in state */ }
      void trackEvent('DOMAIN_TOKEN_REGENERATED', {
        final_domain: status.final_domain,
        metadata: { user_confirmed: true },
      });
      // Status resets to pending on regen; keep it in sync so the UI stays
      // on the pending screen and shows the new token.
      setStatus({
        ...status,
        verification_status: 'pending',
        verification_method: null,
        verified_at: null,
        token_issued: true,
      });
      setVerifyResult(null);
    } catch (err) {
      setRegenError((err as Error)?.message ?? 'Network error.');
    } finally {
      setRegenerating(false);
    }
  }

  async function onSkip(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    void trackEvent('DOMAIN_VERIFICATION_SKIPPED', {
      final_domain: status?.final_domain ?? null,
    });
    router.push('/');
  }

  // ── render branches ────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <Layout><p style={muted}>Loading…</p></Layout>;
  }
  if (phase === 'error') {
    return (
      <Layout>
        <p style={errorBox}>Couldn't load verification status: {errorMsg}</p>
        <Link href="/" style={primaryBtn}>Back</Link>
      </Layout>
    );
  }
  if (phase === 'no-domain') {
    return (
      <Layout>
        <h1 style={h1}>Verify your domain</h1>
        <p style={p}>
          We couldn't find a domain on your company yet. Finish setting up your
          company first, then come back to verify.
        </p>
        <Link href="/onboarding/company" style={primaryBtn}>Set up company</Link>
      </Layout>
    );
  }
  if (phase === 'forbidden') {
    return (
      <Layout>
        <h1 style={h1}>Verify your domain</h1>
        <Subtitle>
          Only an admin can verify this domain. Please contact your administrator.
        </Subtitle>
        <Link href="/" style={primaryBtn}>Back</Link>
      </Layout>
    );
  }
  if (phase === 'verified') {
    return (
      <Layout>
        <h1 style={h1}>Verify your domain</h1>
        <Subtitle>Confirms you own <strong>{status?.final_domain}</strong>.</Subtitle>
        <div style={successBlock}>
          <p style={statusLabel}><span style={dotGreen} /> Domain verified</p>
          <p style={muted}>
            {status?.verification_method
              ? `Verified via ${status.verification_method}.`
              : 'Verification confirmed.'}
          </p>
        </div>
        <Link href="/" style={primaryBtn}>Continue</Link>
      </Layout>
    );
  }

  // phase === 'pending'
  const finalDomain = status!.final_domain;
  const tokenForDisplay = carriedToken ?? '<your-token>';
  const dnsValueForCopy = `omnivira-verification=${tokenForDisplay}`;
  const httpUrl = `https://${finalDomain}/.well-known/omnivira.txt`;

  return (
    <Layout>
      {/* 1. Header */}
      <h1 style={h1}>Verify your domain</h1>
      <Subtitle>
        This confirms you own <strong>{finalDomain}</strong> and unlocks full access.
      </Subtitle>

      {/* 2. Status */}
      <div style={statusBlock}>
        <p style={statusLabel}><span style={dotYellow} /> Verification pending</p>
        <p style={muted}>Add one of the methods below, then click verify.</p>
      </div>

      {/* Token-missing fallback */}
      {!carriedToken && (
        <div style={warnBox}>
          <p style={{ margin: 0, fontWeight: 600 }}>⚠️ Verification token not available</p>
          <p style={{ margin: '6px 0 12px', color: '#92400e' }}>
            Tokens are shown once during signup. If you've lost it, regenerate one below.
          </p>
          <button
            type="button"
            onClick={onRegenerateToken}
            disabled={regenerating}
            style={regenerating ? secondaryBtnDisabled : secondaryBtn}
          >
            {regenerating ? 'Generating…' : 'Generate new token'}
          </button>
          {regenError && <p style={errorDetail}>{regenError}</p>}
        </div>
      )}

      {/* 3. Instructions */}
      <h2 style={h2}>Recommended: DNS (fastest)</h2>
      <div style={methodCard}>
        <Row label="Record type" value="TXT" />
        <Row label="Name"        value="@" />
        <RowCopy
          label="Value"
          value={dnsValueForCopy}
          copied={copied === 'dns'}
          onCopy={() => copy('dns', dnsValueForCopy)}
        />
      </div>

      <details style={detailsBlock}>
        <summary style={detailsSummary}>Where do I add this?</summary>
        <div style={detailsBody}>
          <p style={providerHeader}>GoDaddy</p>
          <ul style={providerList}>
            <li>Go to DNS Management</li>
            <li>Add TXT record</li>
            <li>Name: <code>@</code></li>
            <li>Value: <code>{dnsValueForCopy}</code></li>
          </ul>
          <p style={providerHeader}>Cloudflare</p>
          <ul style={providerList}>
            <li>DNS → Records</li>
            <li>Add TXT</li>
            <li>Name: <code>@</code></li>
          </ul>
          <p style={providerHeader}>Route 53</p>
          <ul style={providerList}>
            <li>Hosted zone → Create record</li>
            <li>Type: TXT</li>
          </ul>
        </div>
      </details>

      <h2 style={h2}>Alternative: Upload a file</h2>
      <div style={methodCard}>
        <RowCopy
          label="URL"
          value={httpUrl}
          copied={copied === 'http_url'}
          onCopy={() => copy('http_url', httpUrl)}
        />
        <RowCopy
          label="Content"
          value={tokenForDisplay}
          copied={copied === 'http_content'}
          onCopy={() => copy('http_content', tokenForDisplay)}
        />
      </div>

      <p style={hint}>Changes may take a few minutes to propagate.</p>
      <p style={hintMuted}>If you're unsure, choose DNS — it's easiest for most users.</p>

      {/* 4. Action */}
      <div style={actionsRow}>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying || retryAttempt > 0}
          style={(verifying || retryAttempt > 0) ? primaryBtnDisabled : primaryBtn}
        >
          {verifying ? 'Verifying…' : 'Verify domain'}
        </button>
        <a href="/" onClick={onSkip} style={skipLink}>Skip for now</a>
      </div>

      {verifyResult?.kind === 'success' && (
        <p style={successBox}>Verified via {verifyResult.method}.</p>
      )}
      {verifyResult?.kind === 'failure' && (
        <div style={errorBox}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            We couldn’t detect your record yet.
          </p>
          <p style={{ margin: '6px 0 0' }}>
            It may take a few minutes to propagate.
          </p>
          {retryAttempt > 0 && retrySecondsLeft > 0 && (
            <p style={{ margin: '8px 0 0', color: '#7f1d1d', fontWeight: 500 }}>
              Re-checking in {retrySecondsLeft}s… (attempt {retryAttempt} of {RETRY_INTERVALS_MS.length})
            </p>
          )}
          {verifyResult.details && (
            <p style={errorDetail}>({verifyResult.details})</p>
          )}
        </div>
      )}
    </Layout>
  );
}

// ── small components ────────────────────────────────────────────────────
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Verify domain</title></Head>
      <main style={main}>
        <div style={card}>{children}</div>
      </main>
    </>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return <p style={subtitle}>{children}</p>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowFlex}>
      <span style={rowLabel}>{label}</span>
      <code style={rowValue}>{value}</code>
    </div>
  );
}

function RowCopy({
  label, value, copied, onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div style={rowFlex}>
      <span style={rowLabel}>{label}</span>
      <code style={rowValueCopy}>{value}</code>
      <button type="button" onClick={onCopy} style={copyBtn}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────
const main: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: '#f7f7f9',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
};
const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 680,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: 36,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const h1: React.CSSProperties = { fontSize: 24, margin: '0 0 6px', color: '#0b0b0d', fontWeight: 600 };
const h2: React.CSSProperties = { fontSize: 14, margin: '24px 0 8px', color: '#374151', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' };
const subtitle: React.CSSProperties = { fontSize: 14, color: '#6b7280', margin: '0 0 20px' };
const p: React.CSSProperties = { margin: '8px 0', color: '#374151', fontSize: 14 };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 13, margin: '6px 0 0' };
const hint: React.CSSProperties = { color: '#374151', fontSize: 13, margin: '16px 0 4px' };
const hintMuted: React.CSSProperties = { color: '#6b7280', fontSize: 12, margin: '0 0 12px' };
const statusBlock: React.CSSProperties = {
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 10,
  padding: '14px 16px',
  margin: '12px 0 20px',
};
const successBlock: React.CSSProperties = {
  background: '#ecfdf5',
  border: '1px solid #a7f3d0',
  borderRadius: 10,
  padding: '14px 16px',
  margin: '12px 0 20px',
};
const statusLabel: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 600,
  color: '#0b0b0d',
  fontSize: 14,
};
const dotYellow: React.CSSProperties = { width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' };
const dotGreen:  React.CSSProperties = { width: 10, height: 10, borderRadius: '50%', background: '#10b981', display: 'inline-block' };
const methodCard: React.CSSProperties = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '12px 16px',
  margin: '8px 0',
};
const rowFlex: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 0',
  borderBottom: '1px dashed #e5e7eb',
};
const rowLabel: React.CSSProperties = { width: 110, fontSize: 13, color: '#6b7280' };
const rowValue: React.CSSProperties = {
  flex: 1,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
  color: '#0b0b0d',
  background: 'transparent',
  padding: '2px 0',
  wordBreak: 'break-all',
};
const rowValueCopy: React.CSSProperties = { ...rowValue, background: '#fff', border: '1px solid #e5e7eb', padding: '6px 10px', borderRadius: 6 };
const detailsBlock: React.CSSProperties = {
  margin: '8px 0 16px',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fafafa',
};
const detailsSummary: React.CSSProperties = {
  cursor: 'pointer',
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  listStyle: 'revert',
};
const detailsBody: React.CSSProperties = {
  padding: '4px 14px 12px',
  borderTop: '1px solid #e5e7eb',
};
const providerHeader: React.CSSProperties = {
  margin: '12px 0 4px',
  fontSize: 13,
  fontWeight: 600,
  color: '#0b0b0d',
};
const providerList: React.CSSProperties = {
  margin: '0 0 4px',
  paddingLeft: 18,
  fontSize: 13,
  color: '#374151',
  lineHeight: 1.6,
};
const copyBtn: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: 13,
  color: '#374151',
};
const actionsRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  marginTop: 28,
};
const primaryBtn: React.CSSProperties = {
  background: '#0b0b0d',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '12px 22px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
};
const primaryBtnDisabled: React.CSSProperties = {
  ...primaryBtn,
  background: '#9ca3af',
  cursor: 'not-allowed',
};
const secondaryBtn: React.CSSProperties = {
  background: '#fff',
  color: '#0b0b0d',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
const secondaryBtnDisabled: React.CSSProperties = {
  ...secondaryBtn,
  background: '#f3f4f6',
  color: '#9ca3af',
  cursor: 'not-allowed',
};
const skipLink: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 13,
  textDecoration: 'underline',
};
const errorBox: React.CSSProperties = {
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: 10,
  padding: '12px 14px',
  margin: '14px 0',
  fontSize: 13,
};
const errorDetail: React.CSSProperties = { margin: '8px 0 0', color: '#7f1d1d', fontSize: 12 };
const successBox: React.CSSProperties = {
  background: '#ecfdf5',
  color: '#065f46',
  border: '1px solid #a7f3d0',
  borderRadius: 10,
  padding: '10px 12px',
  margin: '12px 0',
  fontSize: 13,
};
const warnBox: React.CSSProperties = {
  background: '#fffbeb',
  color: '#92400e',
  border: '1px solid #fde68a',
  borderRadius: 10,
  padding: '14px 16px',
  margin: '14px 0',
  fontSize: 13,
};
