/**
 * INT-003 Wave 2 — Generated Intelligence section for the Lead Detail page.
 *
 * PRESENTATION ONLY. Renders the persisted INT-002 envelope exactly as served
 * by GET /api/leads/:id/intelligence (Wave 1). One read on mount per
 * (companyId, leadId) — no polling, no background refresh, no writes, no
 * regeneration, no orchestration. Absent intelligence renders the
 * never_generated empty state; malformed/missing sections are simply omitted
 * (the DTO is already tolerant — null sections mean "not available").
 *
 * This is distinct from the deterministic profile panels above it
 * (/api/lead-intelligence/profile): this section is version-stamped persisted
 * engine output (engine/schema/generation/fingerprint/freshness).
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { LeadIntelligenceViewDTO, RecommendationItemDTO } from '@/backend/services/leadIntelligenceReadApi/dto';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'loaded'; view: LeadIntelligenceViewDTO };

const FRESHNESS_BADGE: Record<string, { label: string; className: string }> = {
  fresh: { label: 'Up to date', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  stale: { label: 'Out of date', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  pending_regeneration: { label: 'Refresh queued', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  never_generated: { label: 'Not generated', className: 'border-gray-200 bg-gray-50 text-gray-600' },
};

const BAND_STYLE: Record<string, string> = {
  hot: 'border-red-200 bg-red-50 text-red-700',
  warm: 'border-orange-200 bg-orange-50 text-orange-700',
  cool: 'border-sky-200 bg-sky-50 text-sky-700',
  cold: 'border-gray-200 bg-gray-50 text-gray-600',
};

const pct = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

const fmtValue = (value: RecommendationItemDTO['value']): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return pct(value);
  return value;
};

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-gray-700">{children}</div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-1.5 last:border-0">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-gray-900">{value ?? '—'}</span>
    </div>
  );
}

export interface LeadIntelligenceSectionProps {
  companyId: string;
  leadId: string | null;
}

export default function LeadIntelligenceSection({ companyId, leadId }: LeadIntelligenceSectionProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    if (!companyId || !leadId) return undefined;
    let cancelled = false;
    setState({ phase: 'loading' });
    (async () => {
      try {
        const res = await apiFetch(
          `/api/leads/${encodeURIComponent(leadId)}/intelligence?company_id=${encodeURIComponent(companyId)}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: 'error' });
          return;
        }
        const view = (await res.json()) as LeadIntelligenceViewDTO;
        if (!cancelled) setState({ phase: 'loaded', view });
      } catch {
        if (!cancelled) setState({ phase: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, leadId]);

  if (!companyId || !leadId) return null;

  const freshness = state.phase === 'loaded' ? state.view.freshness : null;
  const badge = freshness ? FRESHNESS_BADGE[freshness] ?? FRESHNESS_BADGE.never_generated : null;

  return (
    <section data-testid="lead-generated-intelligence" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-600">Generated Intelligence</p>
          <p className="text-xs text-gray-500">Persisted engine output — read-only</p>
        </div>
        {badge ? (
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
        ) : null}
      </div>

      {state.phase === 'loading' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Loading intelligence…</div>
      ) : state.phase === 'error' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Intelligence unavailable.</div>
      ) : state.view.status === 'never_generated' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No intelligence has been generated yet.
        </div>
      ) : (
        <IntelligenceBody view={state.view} />
      )}
    </section>
  );
}

const asArray = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

function IntelligenceBody({ view }: { view: LeadIntelligenceViewDTO }) {
  // Defense-in-depth (audit LOW): the DTO contract guarantees arrays, but a
  // non-conforming 200 body must degrade to omitted sections, never a throw.
  const { intent, persona, qualification, version } = view;
  const recommendations = asArray(view.recommendations);
  const timeline = asArray(view.timeline);
  const behavior = qualification ? asArray(qualification.sections).find((s) => s.key === 'behavior') ?? null : null;
  const bestChannel = recommendations.find((r) => r.key === 'bestChannel') ?? null;
  const nextBestAction = recommendations.find((r) => r.key === 'nextBestAction') ?? null;
  const channels = asArray(view.qualificationPlanning?.channels);
  const planning = view.qualificationPlanning;
  const automation = view.automationPlanning;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="Overall Intelligence" className="border-purple-200 bg-purple-50/40">
        <KV label="Overall score" value={qualification ? `${qualification.totalScore}/100` : '—'} />
        <KV
          label="Qualification band"
          value={
            qualification ? (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BAND_STYLE[qualification.band] ?? BAND_STYLE.cold}`}>
                {qualification.band}
              </span>
            ) : '—'
          }
        />
        <KV label="Confidence" value={pct(view.overallConfidence)} />
      </Card>

      {intent ? (
        <Card title="Intent">
          <KV label="Score" value={`${intent.score}/100 (${intent.band})`} />
          <ul className="mt-2 space-y-1.5">
            {asArray(intent.contributions).map((c) => (
              <li key={c.signal} className="flex justify-between gap-3">
                <span className="min-w-0 text-gray-600">
                  <span className="font-medium text-gray-900">{c.label}</span>
                  <span className="block text-xs text-gray-500">{c.evidence}</span>
                </span>
                <span className="shrink-0 font-semibold text-purple-700">+{c.points}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {persona ? (
        <Card title="Persona">
          <KV label="Persona" value={persona.persona} />
          <KV label="Confidence" value={pct(persona.confidence)} />
          {asArray(persona.reasons).length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-600">
              {asArray(persona.reasons).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {qualification ? (
        <Card title="Qualification" className="lg:col-span-2">
          {asArray(qualification.sections).map((s) => (
            <div key={s.key} className="border-b border-gray-50 py-1.5 last:border-0">
              <div className="flex justify-between gap-3">
                <span className="font-medium capitalize text-gray-900">{s.key}</span>
                <span className="shrink-0 text-gray-700">
                  {s.score}/100 · w {s.weight} · {s.weightedScore}
                </span>
              </div>
              <p className="text-xs text-gray-500">{s.reason}</p>
            </div>
          ))}
        </Card>
      ) : null}

      {behavior ? (
        <Card title="Behavior">
          <KV label="Score" value={`${behavior.score}/100`} />
          <p className="text-xs text-gray-600">{behavior.reason}</p>
        </Card>
      ) : null}

      {timeline.length > 0 ? (
        <Card title="Journey Timeline" className="lg:col-span-2">
          <ol className="space-y-1.5">
            {timeline.map((t, i) => (
              <li key={`${t.type}-${t.occurredAt}-${i}`} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{t.label}</span>
                  {t.category ? <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">{t.category}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-gray-500">{t.occurredAt}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {recommendations.length > 0 ? (
        <Card title="Recommendations" className="border-indigo-200 bg-indigo-50/40 lg:col-span-2">
          {bestChannel ? <KV label="Best channel" value={`${fmtValue(bestChannel.value)} (${pct(bestChannel.confidence)})`} /> : null}
          {nextBestAction ? <KV label="Next best action" value={`${fmtValue(nextBestAction.value)} (${pct(nextBestAction.confidence)})`} /> : null}
          <ul className="mt-2 space-y-2">
            {recommendations.map((r) => (
              <li key={r.key}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-gray-900">{r.label}</span>
                  <span className="shrink-0 text-xs text-gray-500">{pct(r.confidence)}</span>
                </div>
                <p className="text-xs text-gray-700">{fmtValue(r.value)}</p>
                {r.explanation ? <p className="text-xs text-gray-500">{r.explanation}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {channels.length > 0 ? (
        <Card title="Channels">
          <ol className="space-y-1.5">
            {channels.map((c, i) => (
              <li key={c.channel} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">#{i + 1} {c.channel}</span>
                  {c.reasoning ? <span className="block text-xs text-gray-500">{c.reasoning}</span> : null}
                </span>
                <span className="shrink-0 text-xs font-semibold text-purple-700">{pct(c.confidence)}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {planning ? (
        <Card title="Qualification Planning" className="lg:col-span-2">
          <KV label="Score" value={`${planning.totalScore}/100 (${planning.band})`} />
          <KV label="Confidence" value={pct(planning.confidence)} />
          {asArray(planning.dimensions).length > 0 ? (
            <div className="mt-1">
              {asArray(planning.dimensions).map((d) => (
                <KV key={d.key} label={d.key} value={`${d.score}/100 · ${pct(d.confidence)}`} />
              ))}
            </div>
          ) : null}
          {planning.plan ? (
            <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Playbook — {planning.plan.playbook}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-gray-700">
                {asArray(planning.plan.steps).map((s) => (
                  <li key={s.order}>
                    <span className="font-medium">{s.step}</span> — {s.detail} <span className="text-gray-400">({s.channel})</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {asArray(planning.actions).length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {asArray(planning.actions).map((a) => (
                <li key={`${a.rank}-${a.action}`} className="flex justify-between gap-3">
                  <span className="min-w-0 text-gray-700">
                    <span className="font-medium text-gray-900">{a.action}</span> — {a.explanation}
                  </span>
                  <span className="shrink-0 uppercase text-gray-400">{a.priority}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {automation ? (
        <Card title="Automation Planning">
          <KV label="Status" value={automation.status} />
          <KV label="Confidence" value={pct(automation.confidence)} />
          {automation.review ? <KV label="Human review" value={automation.review.reviewRequired ? 'Required' : 'Not required'} /> : null}
          {asArray(automation.tasks).length > 0 ? (
            <ol className="mt-1 space-y-0.5 text-xs text-gray-700">
              {asArray(automation.tasks).map((t) => (
                <li key={t.id}>
                  <span className="font-medium text-gray-900">{t.order}. {t.action}</span>
                  <span className="text-gray-400"> · {t.kind}{t.channel ? ` · ${t.channel}` : ''} · +{t.estimatedDelayHours}h</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
      ) : null}

      {version ? (
        <Card title="Version">
          <KV label="Engine version" value={version.engineVersion} />
          <KV label="Schema version" value={String(version.schemaVersion)} />
          <KV label="Generation" value={String(version.generation)} />
          <KV label="Generated at" value={version.generatedAt} />
          <KV
            label="Fingerprint"
            value={
              <span className="font-mono text-xs" title={version.fingerprint}>
                {version.fingerprint ? `${version.fingerprint.slice(0, 12)}…` : '—'}
              </span>
            }
          />
        </Card>
      ) : null}
    </div>
  );
}
