'use client';

/**
 * IntegrationCard — the ONE reusable Integration Card (ONBOARD-006 §1).
 *
 * Presentational only. It renders a single integration resolved by the
 * canonical Integration Experience read-model (which reads the onboarding
 * authority). It computes nothing. Each card shows name, category, status,
 * required/optional, why it matters, dependencies (depends-on / unlocks /
 * blocked-by), estimated setup time, and the connect / reconnect / disconnect /
 * learn-more actions — all routing to EXISTING setup surfaces (no new OAuth).
 */

import Link from 'next/link';
import type { IntegrationView, IntegrationStatus } from '../../lib/integrations/integrationExperience';

const STATUS_META: Record<IntegrationStatus, { label: string; cls: string }> = {
  connected:    { label: 'Connected',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  detected:     { label: 'Detected',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  available:    { label: 'Available',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pending:      { label: 'Pending',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  blocked:      { label: 'Blocked',      cls: 'bg-gray-100 text-gray-400 border-gray-200' },
  skipped:      { label: 'Skipped',      cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  disconnected: { label: 'Disconnected', cls: 'bg-red-50 text-red-600 border-red-200' },
  error:        { label: 'Error',        cls: 'bg-red-50 text-red-600 border-red-200' },
  expired:      { label: 'Reconnect',    cls: 'bg-orange-50 text-orange-700 border-orange-200' },
};

function humanizeMinutes(mins: number): string | null {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

export interface IntegrationCardProps {
  integration: IntegrationView;
  /** Highlight styling when shown as a recommended next step. */
  highlighted?: boolean;
}

export default function IntegrationCard({ integration: it, highlighted }: IntegrationCardProps) {
  const meta = STATUS_META[it.status];
  const est = humanizeMinutes(it.estimatedMinutes);
  const isConnected = it.status === 'connected';
  const isBlocked = it.status === 'blocked';
  const needsReconnect = it.status === 'expired' || it.status === 'error' || it.status === 'disconnected';

  return (
    <div
      data-testid={`integration-card-${it.id}`}
      data-status={it.status}
      className={`rounded-2xl border bg-white p-5 transition ${
        highlighted ? 'border-[#0A66C2] shadow-[0_4px_16px_rgba(10,102,194,0.12)]' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[#0B1F33]">{it.name}</h3>
            <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] text-[#6B7C93]" data-testid="category">{it.category}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`} data-testid="status-badge">{meta.label}</span>
            {it.required
              ? <span className="text-[11px] font-medium text-[#6B7C93]">Required</span>
              : <span className="text-[11px] font-medium text-[#9AA7B8]">Optional</span>}
            {est && !isConnected && <span className="text-[11px] text-[#9AA7B8]">· {est}</span>}
          </div>

          <p className="mt-1 text-xs leading-relaxed text-[#6B7C93]">{it.why}</p>
          {it.detail && <p className="mt-1.5 text-xs text-[#0B1F33]/70">{it.detail}</p>}
          {it.connectedProvider && !it.detail && (
            <p className="mt-1.5 text-xs text-emerald-700">{it.connectedProvider} connected</p>
          )}

          {it.unlocks && !isConnected && (
            <p className="mt-2 text-[11px] text-emerald-700"><span aria-hidden>✦ </span>Unlocks: {it.unlocks}</p>
          )}
          {it.dependsOn.length > 0 && (
            <p className="mt-1.5 text-[11px] text-[#9AA7B8]" data-testid="depends-on">Depends on: {it.dependsOn.join(', ')}</p>
          )}
          {it.blockedBy.length > 0 && (
            <p className="mt-0.5 text-[11px] text-gray-400" data-testid="blocked-by">Blocked by: {it.blockedBy.join(', ')}</p>
          )}
          {it.supportedProviders && it.supportedProviders.length > 0 && (
            <p className="mt-1.5 text-[11px] text-[#9AA7B8]">Supports: {it.supportedProviders.join(', ')}</p>
          )}
        </div>

        {isConnected && (
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!isConnected && !isBlocked && (
          <Link
            href={it.connectHref}
            data-testid="connect"
            className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95"
          >
            {needsReconnect ? 'Reconnect' : 'Connect'}
          </Link>
        )}
        {isConnected && (
          <>
            <Link href={it.connectHref} data-testid="reconnect" className="text-xs text-[#6B7C93] hover:text-[#0A66C2]">Reconnect</Link>
            <Link href={it.connectHref} data-testid="disconnect" className="text-xs text-[#6B7C93]/70 hover:text-red-600">Disconnect</Link>
          </>
        )}
        <Link href={it.learnMoreHref} data-testid="learn-more" className="text-xs text-[#6B7C93] hover:text-[#0A66C2]">Learn more</Link>
      </div>

      {isBlocked && (
        <p className="mt-3 text-xs text-gray-400">Complete the required steps above first.</p>
      )}
    </div>
  );
}
