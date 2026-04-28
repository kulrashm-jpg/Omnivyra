/**
 * Compact status strip for the Engagement Command Center. Sits under
 * PlatformTabs; renders a health line for the CURRENTLY SELECTED
 * platform — overall dot, per-mechanism mini-badges, a one-line
 * summary.
 *
 * When selectedPlatform === 'all', renders a row of dots for every
 * platform the admin has configured, each one clickable as a shortcut.
 *
 * Read-only. Gets its data from useEngagementPlatformHealth. Shows
 * nothing at all when the health fetch has no platforms (e.g. legacy
 * tenant with no admin-configured list and no tokens) — the inbox
 * still works, just no status surface.
 */

import React from 'react';
import type { PlatformHealth, EgressStatus, IngressStatus, ActionKey } from '@/hooks/useEngagementPlatformHealth';

const PLATFORM_LABEL: Record<string, string> = {
  linkedin:  'LinkedIn',
  twitter:   'X',
  x:         'X',
  facebook:  'Facebook',
  instagram: 'Instagram',
  youtube:   'YouTube',
  tiktok:    'TikTok',
  whatsapp:  'WhatsApp',
  reddit:    'Reddit',
  pinterest: 'Pinterest',
};

const DOT_CLASS: Record<PlatformHealth['overall'], string> = {
  green:  'bg-green-500',
  orange: 'bg-amber-400',
  red:    'bg-red-500',
};

const MECH_LABEL = {
  api:             'API',
  rpa:             'RPA',
  extension:       'Ext',
  publish_adapter: 'Publish',
} as const;

const EGRESS_BADGE: Record<EgressStatus, { cls: string; text: string }> = {
  ok:          { cls: 'bg-green-100 text-green-800',   text: 'ok' },
  unverified:  { cls: 'bg-amber-100 text-amber-800',   text: 'unverified' },
  no_session:  { cls: 'bg-amber-100 text-amber-800',   text: 'no session' },
  unsupported: { cls: 'bg-slate-100 text-slate-500',   text: 'unsupported' },
  none:        { cls: 'bg-slate-100 text-slate-400',   text: '—' },
};

const INGRESS_BADGE: Record<IngressStatus, { cls: string; text: string }> = {
  active: { cls: 'bg-blue-100 text-blue-800',   text: 'active' },
  none:   { cls: 'bg-slate-100 text-slate-400', text: '—' },
};

export interface PlatformHealthStripProps {
  platforms: PlatformHealth[];
  selectedPlatform: string;
  organizationId: string;
  onSelectPlatform?: (platform: string) => void;
  onHealthRefresh?: () => void;
  className?: string;
  loading?: boolean;
}

/**
 * Bridge to the Omnivyra extension's RPA session-capture helper.
 *
 * Communication is `window.postMessage` — the extension content script
 * (extension/shared/rpaSessionCapture.js) listens for messages with
 * `__omnivyra: 'rpa-capture'` and posts back a matching
 * `rpa-capture-response`. No page-side global object is needed (CSP
 * on Next.js dev blocks inline `<script>` injection, so the previous
 * `window.omnivyraRpaSessionCapture` approach was unreliable).
 *
 * Liveness check: send `ping`; if no response within 800 ms, treat as
 * "extension not loaded" and tell the user to install / reload it.
 */

type RpaStartResult = {
  session_token: string;
  login_url: string;
  expires_at: string;
  platform: string;
};

type RpaFinishResult = {
  success: boolean;
  organization_id?: string;
  platform?: string;
  cookie_count?: number;
};

const RPA_BRIDGE_REQUEST = 'rpa-capture' as const;
const RPA_BRIDGE_RESPONSE = 'rpa-capture-response' as const;
const RPA_PING_TIMEOUT_MS = 800;
const RPA_OP_TIMEOUT_MS   = 30_000;

function rpaBridgeCall<T>(action: 'ping' | 'start' | 'finish', payload: Record<string, unknown>, timeoutMs = RPA_OP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('window unavailable'));
      return;
    }
    const requestId = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const onMessage = (event: MessageEvent) => {
      const data = event?.data as { __omnivyra?: string; request_id?: string; ok?: boolean; result?: unknown; error?: string } | null;
      if (!data || data.__omnivyra !== RPA_BRIDGE_RESPONSE) return;
      if (data.request_id !== requestId) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (data.ok) resolve(data.result as T);
      else reject(new Error(data.error || 'rpa capture failed'));
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('extension_not_responding'));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage(
      { __omnivyra: RPA_BRIDGE_REQUEST, request_id: requestId, action, payload },
      '*',
    );
  });
}

async function rpaExtensionAlive(): Promise<boolean> {
  try {
    await rpaBridgeCall<{ ok: boolean }>('ping', {}, RPA_PING_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

export function PlatformHealthStrip({
  platforms,
  selectedPlatform,
  organizationId,
  onSelectPlatform,
  onHealthRefresh,
  className = '',
  loading = false,
}: PlatformHealthStripProps) {
  if (!platforms || platforms.length === 0) {
    if (loading) {
      return (
        <div className={`text-xs text-slate-400 px-3 py-2 ${className}`}>
          Checking platform status…
        </div>
      );
    }
    return null;
  }

  const normalizedSelected =
    selectedPlatform === 'x' ? 'twitter' : (selectedPlatform || '').toLowerCase();
  const selected =
    normalizedSelected !== 'all'
      ? platforms.find((p) => p.platform === normalizedSelected) ?? null
      : null;

  // Multi-platform summary row when "All" is selected.
  if (!selected) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white text-xs ${className}`}>
        <span className="font-medium text-slate-600 mr-1">Platforms:</span>
        {platforms.map((p) => (
          <button
            key={p.platform}
            type="button"
            onClick={() => onSelectPlatform?.(p.platform)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-slate-200 hover:bg-slate-50"
            title={`${PLATFORM_LABEL[p.platform] ?? p.platform}: ${p.overall}`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${DOT_CLASS[p.overall]}`} />
            <span className="text-slate-700">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
          </button>
        ))}
      </div>
    );
  }

  // Detailed view for the selected platform.
  const actions: ActionKey[] = ['reply', 'like', 'dm', 'post'];
  const summary = summarize(selected);

  // RPA is "unconfigured but capable" when at least one action cell is
  // no_session (we have a script, just no stored cookies). That's the
  // state where a "Connect RPA" button is meaningful.
  const needsRpaSession = Object.values(selected.egress).some((row) => row.rpa === 'no_session');

  return (
    <div className={`border-b border-slate-200 bg-white px-3 py-2 ${className}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_CLASS[selected.overall]}`} />
        <span className="font-semibold text-slate-800">
          {PLATFORM_LABEL[selected.platform] ?? selected.platform}
        </span>
        <span className="text-slate-500">· {summary}</span>
        {!selected.has_live_connection && selected.admin_configured && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-red-50 text-red-700 text-[11px]">
            Not authenticated — admin configured but no live token
          </span>
        )}
        {needsRpaSession && (
          <RpaConnectButton
            platform={selected.platform}
            organizationId={organizationId}
            onDone={onHealthRefresh}
          />
        )}
      </div>

      {/* Per-action grid */}
      <div className="mt-2 grid grid-cols-[auto_repeat(4,1fr)] gap-x-3 gap-y-1 text-[11px]">
        <div className="text-slate-400" />
        {actions.map((a) => (
          <div key={a} className="text-slate-500 font-medium uppercase tracking-wide">
            {a}
          </div>
        ))}

        {(['api', 'rpa', 'extension', 'publish_adapter'] as const).map((mech) => (
          <React.Fragment key={mech}>
            <div className="text-slate-500 font-medium">{MECH_LABEL[mech]}</div>
            {actions.map((a) => {
              const status = selected.egress[a][mech];
              const badge = EGRESS_BADGE[status];
              return (
                <div key={`${mech}-${a}`}>
                  <span className={`inline-block rounded px-1.5 py-0.5 ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Ingress row */}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="font-medium">Ingress:</span>
        {(['polling', 'webhook', 'extension_events'] as const).map((key) => {
          const status = selected.ingress[key];
          const badge = INGRESS_BADGE[status];
          return (
            <span key={key} className="inline-flex items-center gap-1">
              <span className="capitalize">{key.replace('_', ' ')}:</span>
              <span className={`inline-block rounded px-1.5 py-0.5 ${badge.cls}`}>
                {badge.text}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Two-step connect button. Step 1: call start() → backend issues a
 * session_token, opens the platform login in a new tab. User signs in
 * there. Step 2: click "Finish" → calls finish() which reads
 * chrome.cookies via the extension helper + POSTs to
 * /api/rpa/auth/complete → rpa_sessions row lands → health refresh
 * flips the RPA column from 'no session' to 'ok'.
 *
 * If the extension helper isn't present (manifest doesn't load
 * rpaSessionCapture.js, or extension not installed), the button
 * degrades gracefully — opens login in a tab + surfaces a hint to
 * install/reload the extension. The server endpoints still accept a
 * manual storage_state upload via /api/rpa/auth/save-session for the
 * fallback path.
 */
function RpaConnectButton({
  platform,
  organizationId,
  onDone,
}: {
  platform: string;
  organizationId: string;
  onDone?: () => void;
}) {
  const [phase, setPhase] = React.useState<'idle' | 'started' | 'finishing' | 'done' | 'error'>('idle');
  const [token, setToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    setError(null);
    // Liveness probe before doing anything visible. If the extension's
    // content script isn't injecting on this origin, the ping will
    // time out and we surface a clear, actionable error.
    const alive = await rpaExtensionAlive();
    if (!alive) {
      setError('Extension not loaded. Install / reload the Omnivyra extension.');
      setPhase('error');
      return;
    }
    try {
      const resp = await rpaBridgeCall<RpaStartResult>('start', { organizationId, platform });
      setToken(resp.session_token);
      setPhase('started');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
      setPhase('error');
    }
  };

  const finish = async () => {
    if (!token) return;
    setError(null);
    setPhase('finishing');
    const alive = await rpaExtensionAlive();
    if (!alive) {
      setError('Extension not loaded.');
      setPhase('error');
      return;
    }
    try {
      const resp = await rpaBridgeCall<RpaFinishResult>('finish', { platform, session_token: token });
      if (!resp.success) throw new Error('Capture rejected by server');
      setPhase('done');
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finish');
      setPhase('error');
    }
  };

  if (phase === 'done') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-green-50 text-green-700 text-[11px]">
        RPA connected. Refreshing…
      </span>
    );
  }

  if (phase === 'error') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-red-600" title={error ?? ''}>
        {error ?? 'Connection error'}
        <button type="button" onClick={() => { setPhase('idle'); setError(null); }} className="underline">
          retry
        </button>
      </span>
    );
  }

  if (phase === 'started') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-[11px]">
        <span className="text-slate-500">Sign in to {PLATFORM_LABEL[platform] ?? platform} in the opened tab, then</span>
        <button
          type="button"
          onClick={finish}
          className="inline-flex items-center rounded px-2 py-0.5 bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Finish connection
        </button>
      </span>
    );
  }

  if (phase === 'finishing') {
    return <span className="ml-2 text-[11px] text-slate-500">Capturing session…</span>;
  }

  return (
    <button
      type="button"
      onClick={start}
      className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[11px] hover:bg-amber-100"
    >
      Connect RPA
    </button>
  );
}

function summarize(p: PlatformHealth): string {
  const bits: string[] = [];
  for (const via of p.connected_via) {
    bits.push(MECH_LABEL[via] ?? via);
  }
  if (bits.length === 0) return 'no active mechanism';
  return `via ${bits.join(' + ')}`;
}
