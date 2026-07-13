'use client';

/**
 * ActivationDashboard — the ONE reusable Platform Activation dashboard
 * (ONBOARD-007 §3). Presentational only; it renders the Platform Activation
 * read-model (which reads the existing authorities) and computes nothing.
 *
 * Shows: Platform Ready, capability availability, recently unlocked, next
 * recommended improvements, and optional enhancements. Every unavailable
 * capability explains why, the missing prerequisite, and what it unlocks (§4).
 */

import Link from 'next/link';
import type { CapabilityView, CapabilityStatus, PlatformActivation } from '../../lib/activation/platformActivation';

const STATUS_META: Record<CapabilityStatus, { label: string; cls: string }> = {
  available:      { label: 'Available',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  limited:        { label: 'Limited',        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  recommended:    { label: 'Recommended',    cls: 'bg-[#EAF3FF] text-[#0A66C2] border-[#BEDCFF]' },
  requires_setup: { label: 'Requires setup', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unavailable:    { label: 'Unavailable',    cls: 'bg-gray-100 text-gray-400 border-gray-200' },
};

function CapabilityCard({ capability: c }: { capability: CapabilityView }) {
  const meta = STATUS_META[c.status];
  const operational = c.status === 'available' || c.status === 'limited';
  return (
    <div
      data-testid={`capability-${c.id}`}
      data-status={c.status}
      className="rounded-2xl border border-gray-100 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#0B1F33]">{c.name}</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`} data-testid="capability-status">{meta.label}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[#6B7C93]">{c.why}</p>

      {!operational && c.missingPrerequisites.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-400" data-testid="missing-prereq">
          Needs: {c.missingPrerequisites.join(', ')}
        </p>
      )}
      {c.status === 'limited' && c.missingPrerequisites.length > 0 && (
        <p className="mt-2 text-[11px] text-sky-700" data-testid="limited-note">
          Works now — add {c.missingPrerequisites.join(', ')} for full value.
        </p>
      )}
      {!operational && (
        <p className="mt-1 text-[11px] text-emerald-700"><span aria-hidden>✦ </span>Unlocks: {c.unlocks}</p>
      )}
      {!operational && c.actionHref && (
        <Link href={c.actionHref} data-testid="capability-action" className="mt-2 inline-block text-xs font-semibold text-[#0A66C2] hover:underline">
          {c.status === 'recommended' ? 'Set up (recommended)' : 'Set up'} →
        </Link>
      )}
    </div>
  );
}

export interface ActivationDashboardProps {
  activation: PlatformActivation;
}

export default function ActivationDashboard({ activation: a }: ActivationDashboardProps) {
  return (
    <div className="space-y-9">
      {/* §3 Platform Ready — read from the authority, never computed here. */}
      <section
        data-testid="platform-ready"
        data-ready={a.platformReady}
        className={`rounded-2xl border px-5 py-4 ${a.platformReady ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-white'}`}
      >
        {a.platformReady ? (
          <>
            <p className="text-sm font-semibold text-emerald-800">🎉 Your platform is ready.</p>
            <p className="mt-1 text-sm text-emerald-700">Your core capabilities are active. Connect more below to unlock additional value.</p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs font-medium text-[#6B7C93]">
              <span>Platform activation in progress</span>
              <span>{a.completionPercentage}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5]" style={{ width: `${a.completionPercentage}%` }} />
            </div>
          </>
        )}
      </section>

      {/* §2 Capability availability */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">What your platform can do</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {a.capabilities.map((c) => <CapabilityCard key={c.id} capability={c} />)}
        </div>
      </section>

      {/* §3 Recently unlocked (operational capabilities) */}
      {a.recentlyUnlocked.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Active now</h2>
          <p className="text-xs text-[#6B7C93]">{a.recentlyUnlocked.map((c) => c.name).join(' · ')}</p>
        </section>
      )}

      {/* §3 Next recommended improvements (authority-ordered) */}
      {a.nextRecommended.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0A66C2]">Next recommended</h2>
          <div className="space-y-2">
            {a.nextRecommended.map((n) => (
              <div key={n.integrationId} data-testid={`next-${n.integrationId}`} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#0B1F33]">Connect {n.name}</span>
                  <Link href={n.href} className="text-xs font-semibold text-[#0A66C2] hover:underline">Connect →</Link>
                </div>
                {n.unlocks.length > 0 && (
                  <p className="mt-1 text-[11px] text-[#6B7C93]">Unlocks: {n.unlocks.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* §5 Optional enhancements (never blocking) */}
      {a.optionalImprovements.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9AA7B8]">Optional enhancements</h2>
          <ul className="space-y-1.5">
            {a.optionalImprovements.map((o) => (
              <li key={o.id} data-testid={`optional-${o.id}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[#0B1F33]/80">{o.label} <span className="text-[#9AA7B8]">— {o.why}</span></span>
                <Link href={o.href} className="shrink-0 font-semibold text-[#0A66C2] hover:underline">Open →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
