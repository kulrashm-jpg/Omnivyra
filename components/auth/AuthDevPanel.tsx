/**
 * AuthDevPanel — DEV-only floating diagnostics widget for the auth FSM.
 *
 * Why this exists
 * ───────────────
 * Auth bugs are notoriously hard to debug from the UI alone. Pre-Phase-2.B,
 * to understand why a user was bouncing back to /login you had to (a)
 * open the Network tab, (b) re-trigger the flow, (c) read the JSON,
 * (d) read server logs, (e) correlate. This panel collapses (a)-(c) into
 * a single always-on indicator visible while developing locally.
 *
 * Production hides it completely (env check). It never reads or writes
 * any user-visible state — purely a read surface on CompanyContext +
 * SchemaHealth / single-flight diagnostics.
 *
 * Mount it once at the app root (already done in _app.tsx). Toggle open
 * with the floating button in the bottom-right.
 */

import React, { useState, useEffect } from 'react';
import { useCompanyContext } from '../CompanyContext';
import {
  AUTH_ERROR_REGISTRY,
} from '../../shared/contracts/security/AuthErrorRegistry';

interface ReadinessSnapshot {
  status:    string;
  schemaHealthy: boolean;
  reasons:   string[];
  fingerprint: {
    fingerprint: string;
    authContractVersion: string;
    schemaManifestHash: string | null;
    nodeEnv: string;
  };
}

export const AuthDevPanel: React.FC = () => {
  // Always-bound conditional render — production strips the body but
  // keeps the component reference null so we never violate hooks rules.
  const enabled =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
  if (!enabled) return null;
  return <AuthDevPanelInner />;
};

const AuthDevPanelInner: React.FC = () => {
  const { authFsm, authError, isAuthenticated, authChecked, companies, user } = useCompanyContext();
  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/health/readiness')
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setReadiness(data); })
      .catch(() => { /* dev panel — no-op on failure */ });
    return () => { cancelled = true; };
  }, [open]);

  const stateColor: Record<string, string> = {
    initializing:  '#9ca3af',
    authenticated: '#16a34a',
    degraded:      '#f59e0b',
    retrying:      '#3b82f6',
    blocked:       '#dc2626',
    signed_out:    '#6b7280',
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
      }}
    >
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open auth dev panel"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: stateColor[authFsm.state] ?? '#000',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            fontWeight: 700,
          }}
          title={`Auth FSM: ${authFsm.state}`}
        >
          A
        </button>
      )}

      {open && (
        <div
          style={{
            width: 320,
            background: 'rgba(17,24,39,0.95)',
            color: 'white',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>Auth Diagnostics</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <Section label="FSM">
            <Row k="state"      v={
              <span style={{ color: stateColor[authFsm.state] ?? 'white', fontWeight: 600 }}>
                {authFsm.state}
              </span>
            } />
            <Row k="transitions" v={String(authFsm.transitionCount)} />
            <Row k="retries"     v={String(authFsm.retryAttempts)} />
            <Row k="offline"     v={authFsm.offline ? 'yes' : 'no'} />
            <Row k="last code"   v={authFsm.lastErrorCode ?? '—'} />
          </Section>

          <Section label="Context">
            <Row k="authChecked"     v={authChecked ? 'true' : 'false'} />
            <Row k="isAuthenticated" v={isAuthenticated ? 'true' : 'false'} />
            <Row k="user"            v={user?.userId ?? '—'} />
            <Row k="companies"       v={String(companies.length)} />
          </Section>

          {authError && (
            <Section label="Visible Error">
              <Row k="code"     v={authError.code} />
              <Row k="category" v={AUTH_ERROR_REGISTRY[authError.code]?.category ?? '—'} />
              <Row k="details"  v={authError.details ?? '—'} />
            </Section>
          )}

          <Section label="Schema / Boot">
            <Row k="schema ok"   v={readiness?.schemaHealthy ? 'yes' : (readiness ? 'NO' : '…')} />
            <Row k="contract"    v={readiness?.fingerprint.authContractVersion ?? '…'} />
            <Row k="fingerprint" v={readiness?.fingerprint.fingerprint.slice(0, 12) ?? '…'} />
            {readiness?.reasons.length ? (
              <div style={{ color: '#fbbf24', marginTop: 4, fontSize: 11 }}>
                {readiness.reasons.join(' · ')}
              </div>
            ) : null}
          </Section>

          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8 }}>
            dev-only · process.env.NODE_ENV={'{development}'}
          </div>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
    <div style={{ color: '#9ca3af', textTransform: 'uppercase', fontSize: 10, marginBottom: 4, letterSpacing: 0.5 }}>
      {label}
    </div>
    {children}
  </div>
);

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
    <span style={{ color: '#d1d5db' }}>{k}</span>
    <span style={{ color: 'white' }}>{v}</span>
  </div>
);
