'use client';

/**
 * CustomerSuccessWorkspace — the ONE canonical Customer Success surface (CSA-007).
 *
 * Presentational only. It renders the composed workspace view (Health, Lifecycle,
 * Platform Ready, Usage, Next Best Action, Recommended Actions, Playbooks) from
 * the workspace authority and computes NOTHING. Every action/playbook links to
 * an EXISTING platform surface (§6) — it never executes anything. Section views
 * and playbook opens fire an optional telemetry callback (§8).
 */

import Link from 'next/link';
import type { CustomerSuccessWorkspace, WorkspaceAction, WorkspacePlaybook } from '../../lib/customerSuccess/workspace';

const TIER_CLS: Record<string, string> = {
  CRITICAL: 'bg-red-50 text-red-600 border-red-200',
  HIGH: 'bg-amber-50 text-amber-700 border-amber-200',
  MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
  LOW: 'bg-gray-50 text-gray-600 border-gray-200',
};
const STATE_CLS: Record<string, string> = {
  EXCELLENT: 'text-emerald-700', HEALTHY: 'text-emerald-700', STABLE: 'text-sky-700',
  NEEDS_ATTENTION: 'text-amber-700', AT_RISK: 'text-red-600', INACTIVE: 'text-gray-500',
};

export interface CustomerSuccessWorkspaceProps {
  workspace: CustomerSuccessWorkspace;
  /** §8 — fired on section view / playbook open (telemetry only; no execution). */
  onTelemetry?: (event: 'section_view' | 'playbook_open', label: string) => void;
}

function Chip({ tier }: { tier: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_CLS[tier] ?? TIER_CLS.LOW}`}>{tier}</span>;
}

function ActionRow({ a }: { a: WorkspaceAction }) {
  return (
    <div data-testid={`action-${a.id}`} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#0B1F33]">{a.title}</span>
          <Chip tier={a.priorityTier} />
        </div>
        <p className="mt-0.5 text-xs text-[#6B7C93]">{a.reason}</p>
        <p className="mt-0.5 text-[11px] text-emerald-700">Impact: {a.expectedImpact}</p>
      </div>
      {a.href && <Link href={a.href} className="shrink-0 text-xs font-semibold text-[#0A66C2] hover:underline">Open →</Link>}
    </div>
  );
}

function PlaybookCard({ pb, onOpen }: { pb: WorkspacePlaybook; onOpen?: () => void }) {
  return (
    <div data-testid={`playbook-${pb.id}`} className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-[#0B1F33]">{pb.title}</h4>
        <span className="text-[11px] text-[#9AA7B8]">{pb.progress.completed}/{pb.progress.total} steps</span>
      </div>
      <p className="mt-1 text-xs text-[#6B7C93]">{pb.objective}</p>
      <ol className="mt-2 space-y-1">
        {pb.steps.map((s) => (
          <li key={s.title} className="text-[11px] text-[#0B1F33]/75">
            <span className={s.required ? 'text-[#0A66C2]' : 'text-[#9AA7B8]'}>{s.required ? '●' : '○'} </span>
            {s.title}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-emerald-700">Outcome: {pb.expectedOutcome}</p>
      {pb.href && (
        <Link href={pb.href} onClick={onOpen} data-testid={`playbook-open-${pb.id}`} className="mt-2 inline-block text-xs font-semibold text-[#0A66C2] hover:underline">
          Open playbook →
        </Link>
      )}
    </div>
  );
}

function Section({ id, title, onView, children }: { id: string; title: string; onView?: () => void; children: React.ReactNode }) {
  return (
    <section data-testid={`section-${id}`} onMouseEnter={onView}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">{title}</h2>
      {children}
    </section>
  );
}

export default function CustomerSuccessWorkspace({ workspace: w, onTelemetry }: CustomerSuccessWorkspaceProps) {
  const view = (s: string) => () => onTelemetry?.('section_view', s);

  return (
    <div className="space-y-8" data-testid="cs-workspace">
      {/* Overview */}
      <Section id="overview" title="Customer overview" onView={view('overview')}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
          <span className="text-sm font-semibold text-[#0B1F33]">{w.overview.companyId}</span>
          <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] text-[#6B7C93]">{w.overview.lifecycleStage}</span>
          <span className={`text-[11px] font-medium ${STATE_CLS[w.overview.healthState] ?? 'text-[#6B7C93]'}`}>{w.overview.healthState} · {w.overview.healthScore}/100</span>
          <span className="text-[11px] text-[#9AA7B8]">{w.overview.platformReady ? 'Platform Ready' : 'Setup in progress'}</span>
        </div>
      </Section>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Health */}
        <Section id="health" title="Health" onView={view('health')}>
          <div data-testid="health-card" className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className={`text-sm font-semibold ${STATE_CLS[w.health.state] ?? 'text-[#0B1F33]'}`}>{w.health.state} · {w.health.score}/100</p>
            <p className="mt-0.5 text-[11px] text-[#9AA7B8]">Risk: {w.health.riskLevel}</p>
            {w.health.majorContributors.length > 0 && <p className="mt-1 text-[11px] text-emerald-700">+ {w.health.majorContributors.join(', ')}</p>}
            {w.health.recommendedImprovements.length > 0 && <p className="mt-1 text-[11px] text-[#6B7C93]">Improve: {w.health.recommendedImprovements.join(', ')}</p>}
          </div>
        </Section>

        {/* Lifecycle */}
        <Section id="lifecycle" title="Lifecycle" onView={view('lifecycle')}>
          <div data-testid="lifecycle-card" className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-sm font-semibold text-[#0B1F33]">{w.lifecycle.stage}</p>
            <p className="mt-0.5 text-[11px] text-[#6B7C93]">{w.lifecycle.transitionReason}</p>
            <p className="mt-0.5 text-[11px] text-[#9AA7B8]">Trajectory: {w.lifecycle.trajectory} · Next: {w.lifecycle.nextMilestone}</p>
          </div>
        </Section>

        {/* Platform Ready */}
        <Section id="platform_ready" title="Platform Ready" onView={view('platform_ready')}>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-sm font-semibold text-[#0B1F33]">{w.platformReady.ready ? 'Ready' : 'In progress'}</p>
            <p className="mt-0.5 text-[11px] text-[#9AA7B8]">Readiness score: {w.platformReady.readinessScore}/100</p>
          </div>
        </Section>

        {/* Usage */}
        <Section id="usage" title="Usage summary" onView={view('usage')}>
          <div data-testid="usage-card" className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-sm font-semibold text-[#0B1F33]">{w.usage.activeDays} active day(s) · {w.usage.totalEvents} events</p>
            <p className="mt-0.5 text-[11px] text-[#9AA7B8]">{w.usage.activeUsers} active user(s){w.usage.capabilitiesUsed.length ? ` · ${w.usage.capabilitiesUsed.join(', ')}` : ''}</p>
          </div>
        </Section>
      </div>

      {/* Next best action */}
      <Section id="next_best_action" title="Next best action" onView={view('next_best_action')}>
        {w.nextBestAction ? <ActionRow a={w.nextBestAction} /> : <p className="text-xs text-[#9AA7B8]">Nothing recommended right now.</p>}
      </Section>

      {/* Recommended actions */}
      {w.recommendedActions.length > 0 && (
        <Section id="recommended_actions" title="Recommended actions" onView={view('recommended_actions')}>
          <div className="space-y-2">{w.recommendedActions.map((a) => <ActionRow key={a.id} a={a} />)}</div>
        </Section>
      )}

      {/* Playbooks */}
      <Section id="playbooks" title="Playbooks" onView={view('playbooks')}>
        <div className="space-y-3">
          {w.playbooks.recommended && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#0A66C2]">Recommended</p>
              <PlaybookCard pb={w.playbooks.recommended} onOpen={() => onTelemetry?.('playbook_open', w.playbooks.recommended!.id)} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {w.playbooks.all.map((pb) => (
              <PlaybookCard key={pb.id} pb={pb} onOpen={() => onTelemetry?.('playbook_open', pb.id)} />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
