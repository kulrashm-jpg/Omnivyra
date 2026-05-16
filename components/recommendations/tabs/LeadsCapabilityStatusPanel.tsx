/**
 * Phase 0 — Active Leads capability status panel.
 *
 * Three explicit sections:
 *   • Connected Integrations
 *   • Available for Listening
 *   • Listening Enabled
 *
 * Renders the current state read from /api/active-leads/capabilities and
 * exposes a per-(platform, capability) toggle that POSTs back to the same
 * endpoint. Nothing is auto-enabled; the toggle requires an explicit user
 * click. No monitoring is started — Phase 0 only flips the capability flag
 * and writes a consent_record.
 *
 * Wiring (one line to add inside the existing Active Leads tab):
 *
 *   import LeadsCapabilityStatusPanel from './LeadsCapabilityStatusPanel';
 *   // ...inside the canonical tab, above the filter section:
 *   <LeadsCapabilityStatusPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ListeningConfigurationDialog from './ListeningConfigurationDialog';

type CapabilityStatus = 'active' | 'revoked' | 'pending';
type PlatformListeningState =
  | 'connected'
  | 'available_for_listening'
  | 'listening_approved'
  | 'listening_active';

type CapabilityStateEntry = {
  capability:
    | 'publish'
    | 'listen'
    | 'monitor_competitors'
    | 'ingest_dms'
    | 'ingest_comments'
    | 'ingest_mentions'
    | 'ingest_communities';
  enabled: boolean;
  status: CapabilityStatus;
  granted_at: string | null;
  consent_record_age_days?: number | null;
};

type HealthSeverity = 'info' | 'warning' | 'error';

type PlatformBucket = {
  platform: string;
  state: PlatformListeningState;
  capabilities: CapabilityStateEntry[];
  monitoring_ready?: boolean;
  monitoring_blockers?: string[];
  health?: { severity: HealthSeverity; codes: string[] } | null;
  readiness_snapshot?: {
    consent_freshness_score: number;
    scope_sufficiency: 'sufficient' | 'insufficient' | 'not_required';
    source_ready: boolean;
    orchestration_eligible: boolean;
  };
};

type CapabilitiesResponse = {
  companyId: string;
  generated_at?: string;
  buckets: {
    connected: PlatformBucket[];
    available_for_listening: PlatformBucket[];
    listening_enabled: PlatformBucket[];
  };
  all_platforms: PlatformBucket[];
  health?: {
    rollups: { info: number; warning: number; error: number };
    findings: Array<{
      code: string;
      severity: HealthSeverity;
      platform: string | null;
      detail: string;
    }>;
  };
};

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  companyId: string | null;
  fetchWithAuth: FetchWithAuth;
};

function platformLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized === 'x' || normalized === 'twitter') return 'X';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'youtube') return 'YouTube';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function stateBadge(state: PlatformListeningState): { label: string; tone: string } {
  switch (state) {
    case 'listening_active':
      return { label: 'Listening enabled', tone: 'bg-emerald-100 text-emerald-800' };
    case 'listening_approved':
      return { label: 'Listening approved (paused)', tone: 'bg-amber-100 text-amber-800' };
    case 'available_for_listening':
      return { label: 'Available for listening', tone: 'bg-sky-100 text-sky-800' };
    case 'connected':
    default:
      return { label: 'Connected', tone: 'bg-slate-200 text-slate-700' };
  }
}

function healthDotTone(severity: HealthSeverity | undefined): string {
  if (severity === 'error') return 'bg-rose-500';
  if (severity === 'warning') return 'bg-amber-500';
  if (severity === 'info') return 'bg-sky-500';
  return 'bg-emerald-500';
}

function healthLabel(severity: HealthSeverity | undefined, codes: string[] | undefined): string {
  if (!severity) return 'Healthy';
  if (severity === 'error') return `Action needed${codes && codes.length > 0 ? `: ${codes[0]}` : ''}`;
  if (severity === 'warning') return `Warning${codes && codes.length > 0 ? `: ${codes[0]}` : ''}`;
  return `Notice${codes && codes.length > 0 ? `: ${codes[0]}` : ''}`;
}

function blockerLabel(blocker: string): string {
  if (blocker === 'oauth_not_connected') return 'OAuth missing';
  if (blocker === 'listen_capability_not_enabled') return 'Listening not enabled';
  if (blocker === 'no_active_consent' || blocker === 'consent_not_active') return 'No active consent';
  if (blocker === 'consent_stale') return 'Consent stale';
  if (blocker.startsWith('scope_insufficient')) return 'Scope insufficient';
  if (blocker === 'no_ready_source') return 'No ready source';
  return blocker;
}

export default function LeadsCapabilityStatusPanel({ companyId, fetchWithAuth }: Props) {
  const [data, setData] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState<boolean>(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(
        `/api/active-leads/capabilities?companyId=${encodeURIComponent(companyId)}`,
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to load capabilities (${response.status}): ${body}`);
      }
      const json: CapabilitiesResponse = await response.json();
      if (requestSeq.current !== seq) return;
      setData(json);
    } catch (err: any) {
      if (requestSeq.current !== seq) return;
      setError(err?.message ?? 'Failed to load capabilities');
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (
      platform: string,
      capability: CapabilityStateEntry['capability'],
      nextEnabled: boolean,
    ) => {
      if (!companyId) return;
      const key = `${platform}:${capability}`;
      setPendingKey(key);
      setError(null);
      try {
        const response = await fetchWithAuth('/api/active-leads/capabilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            platform,
            capability,
            action: nextEnabled ? 'enable' : 'disable',
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Capability change failed (${response.status}): ${body}`);
        }
        await load();
      } catch (err: any) {
        setError(err?.message ?? 'Capability change failed');
      } finally {
        setPendingKey(null);
      }
    },
    [companyId, fetchWithAuth, load],
  );

  const buckets = useMemo(() => {
    if (!data) {
      return {
        connectedOnly: [] as PlatformBucket[],
        availableForListening: [] as PlatformBucket[],
        listeningEnabled: [] as PlatformBucket[],
      };
    }
    const listeningEnabled = data.all_platforms.filter((p) => p.state === 'listening_active');
    const availableForListening = data.all_platforms.filter(
      (p) => p.state === 'available_for_listening' || p.state === 'listening_approved',
    );
    const connectedOnly = data.all_platforms.filter((p) => p.state === 'connected');
    return { connectedOnly, availableForListening, listeningEnabled };
  }, [data]);

  if (!companyId) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Select a company to view integration listening status.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Integration listening status</h3>
          <p className="text-xs text-slate-500">
            Listening is off by default. Enabling a capability records explicit consent — it does not
            start any monitoring on its own.
          </p>
          {data?.generated_at && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              Snapshot refreshed {new Date(data.generated_at).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            disabled={!companyId || (buckets.listeningEnabled.length === 0 && buckets.availableForListening.length === 0)}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Configure autonomous listening"
          >
            Configure listening
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {companyId && (
        <ListeningConfigurationDialog
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          isOpen={configOpen}
          onClose={() => setConfigOpen(false)}
          onActivated={() => void load()}
          availablePlatforms={buckets.listeningEnabled.map((p) => p.platform)}
        />
      )}

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {data?.health && (data.health.rollups.error > 0 || data.health.rollups.warning > 0) && (
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          <span className="font-medium">Operational health:</span>
          {data.health.rollups.error > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
              {data.health.rollups.error} error{data.health.rollups.error === 1 ? '' : 's'}
            </span>
          )}
          {data.health.rollups.warning > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              {data.health.rollups.warning} warning{data.health.rollups.warning === 1 ? '' : 's'}
            </span>
          )}
          {data.health.rollups.info > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
              {data.health.rollups.info} notice{data.health.rollups.info === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      <Section
        title="Listening Enabled"
        emptyMessage="No integrations have listening enabled yet."
        platforms={buckets.listeningEnabled}
        onToggle={toggle}
        pendingKey={pendingKey}
      />
      <Section
        title="Available for Listening"
        emptyMessage="No connected integration is awaiting a listening opt-in."
        platforms={buckets.availableForListening}
        onToggle={toggle}
        pendingKey={pendingKey}
      />
      <Section
        title="Connected Integrations"
        emptyMessage="No connected integrations found for this company."
        platforms={buckets.connectedOnly}
        onToggle={toggle}
        pendingKey={pendingKey}
      />
    </div>
  );
}

type SectionProps = {
  title: string;
  emptyMessage: string;
  platforms: PlatformBucket[];
  onToggle: (
    platform: string,
    capability: CapabilityStateEntry['capability'],
    nextEnabled: boolean,
  ) => void | Promise<void>;
  pendingKey: string | null;
};

function Section({ title, emptyMessage, platforms, onToggle, pendingKey }: SectionProps) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {platforms.length === 0 ? (
        <div className="px-4 pb-3 text-xs text-slate-400">{emptyMessage}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {platforms.map((p) => {
            const badge = stateBadge(p.state);
            const listenRow = p.capabilities.find((c) => c.capability === 'listen');
            const listenEnabled = !!listenRow?.enabled && listenRow?.status === 'active';
            const togglePending = pendingKey === `${p.platform}:listen`;
            const consentAge = listenRow?.consent_record_age_days ?? null;
            const blockers = p.monitoring_blockers ?? [];
            const monitoringReady = p.monitoring_ready ?? false;
            const healthSeverity = p.health?.severity;
            const healthCodes = p.health?.codes;
            return (
              <li key={p.platform} className="flex items-center justify-between px-4 py-2">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${healthDotTone(healthSeverity)}`}
                      title={healthLabel(healthSeverity, healthCodes)}
                    />
                    <div className="text-sm font-medium text-slate-900">{platformLabel(p.platform)}</div>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.tone}`}>
                      {badge.label}
                    </span>
                    {listenEnabled && monitoringReady && (
                      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700">
                        Ready
                      </span>
                    )}
                    {p.readiness_snapshot?.scope_sufficiency === 'insufficient' && (
                      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">
                        Scope review
                      </span>
                    )}
                    {consentAge != null && consentAge > 150 && (
                      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">
                        Consent {consentAge}d
                      </span>
                    )}
                    {blockers.slice(0, 2).map((b) => (
                      <span
                        key={b}
                        className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600"
                        title={b}
                      >
                        {blockerLabel(b)}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => onToggle(p.platform, 'listen', !listenEnabled)}
                  disabled={togglePending}
                >
                  {togglePending
                    ? 'Working…'
                    : listenEnabled
                      ? 'Disable listening'
                      : 'Enable listening'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
