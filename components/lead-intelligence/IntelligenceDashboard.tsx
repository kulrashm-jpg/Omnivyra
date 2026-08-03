/**
 * INT-003 Wave 4 (+ INT-003A hardening) — Latest Lead Intelligence dashboard.
 *
 * PRESENTATION ONLY over the LATEST LEAD COHORT — this is deliberately NOT
 * company-wide analytics (see DASHBOARD_LIMITATIONS in dashboardDataAdapter
 * for what is missing and WHY). Data acquisition lives behind the
 * IntelligenceDashboardDataAdapter boundary (INT-003A Gap 2): today that is
 * the Wave 4 behaviour verbatim — the lead list API's latest cohort + ONE
 * bulk read of persisted intelligence list items — and a future server-side
 * Dashboard Aggregate API plugs in as another adapter with zero UI changes.
 * No SWR, no polling, no background refresh, no writes, no orchestration.
 * Every number shown is a count/mean of PERSISTED DTO values — the dashboard
 * derives no new intelligence. Filters select over persisted fields only and
 * never refetch. Charts are plain HTML bars (single hue, direct labels —
 * identity is never color-alone) plus the badge tones already established by
 * Waves 2/3, so no chart library is introduced.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { LeadIntelligenceListItemDTO } from '@/backend/services/leadIntelligenceReadApi/dto';
import {
  bulkReadDashboardAdapter,
  type IntelligenceDashboardDataAdapter,
  type DashboardCohortLead,
} from './dashboardDataAdapter';

const BAND_ORDER = ['hot', 'warm', 'cool', 'cold'] as const;
const FRESHNESS_ORDER = ['fresh', 'stale', 'pending_regeneration', 'never_generated'] as const;
const INTENT_ORDER = ['high', 'medium', 'low', 'none'] as const;

const BAND_STYLE: Record<string, string> = {
  hot: 'border-red-200 bg-red-50 text-red-700',
  warm: 'border-orange-200 bg-orange-50 text-orange-700',
  cool: 'border-sky-200 bg-sky-50 text-sky-700',
  cold: 'border-gray-200 bg-gray-50 text-gray-600',
};

const FRESHNESS_LABEL: Record<string, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  pending_regeneration: 'Pending regeneration',
  never_generated: 'Never generated',
};

const pct = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

const round1 = (n: number): number => Math.round(n * 10) / 10;

type Item = LeadIntelligenceListItemDTO;
type CohortLead = DashboardCohortLead;

interface DashboardFilters {
  band: string;
  freshness: string;
  persona: string;
  minScore: string;
  minConfidence: string;
  from: string; // YYYY-MM-DD on generatedAt
  to: string;
}

const emptyDashboardFilters = (): DashboardFilters => ({
  band: '', freshness: '', persona: '', minScore: '', minConfidence: '', from: '', to: '',
});

/** Count by key, deterministically ordered: count desc, then name asc. */
function countBy(values: Array<string | null>): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const mean = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  const testId = `kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div data-testid={testId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {hint ? <p className="text-[11px] text-gray-400">{hint}</p> : null}
    </div>
  );
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-gray-700">{children}</div>
    </section>
  );
}

/** Single-hue labeled bar row — identity comes from the label, never color. */
function BarRow({ label, count, max, chipClass }: { label: string; count: number; max: number; chipClass?: string }) {
  // Zero stays zero — a minimum-width bar would fake presence (audit LOW).
  const width = count === 0 || max <= 0 ? 0 : Math.max(2, Math.round((count / max) * 100));
  const testId = `bar-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div data-testid={testId} className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-xs text-gray-600">
        {chipClass ? <span className={`mr-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${chipClass}`}>{label}</span> : label}
      </span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-purple-500" style={{ width: `${width}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-semibold text-gray-900">{count}</span>
    </div>
  );
}

export interface IntelligenceDashboardProps {
  companyId: string;
  /** Injected clock for the timeline summary (tests pin it). */
  now?: () => number;
  /** INT-003A Gap 2: data-source boundary — defaults to today's bulk-read adapter. */
  adapter?: IntelligenceDashboardDataAdapter;
}

export default function IntelligenceDashboard({
  companyId,
  now = () => Date.now(),
  adapter = bulkReadDashboardAdapter,
}: IntelligenceDashboardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [portfolioTotal, setPortfolioTotal] = useState(0);
  const [cohort, setCohort] = useState<Map<string, CohortLead>>(new Map());
  const [items, setItems] = useState<Item[]>([]);
  const [filters, setFilters] = useState<DashboardFilters>(emptyDashboardFilters());

  useEffect(() => {
    if (!companyId) return undefined;
    let active = true;
    setPending(true);
    setFailed(false);
    // INT-003A Gap 2: acquisition happens behind the adapter boundary; the
    // component only consumes the snapshot. Same requests, same tolerance —
    // the Wave 4 logic moved verbatim into bulkReadDashboardAdapter.
    adapter
      .load(companyId)
      .then((snapshot) => {
        if (!active) return;
        setPortfolioTotal(snapshot.portfolioTotal);
        setCohort(snapshot.cohort);
        setItems(snapshot.items);
        setFailed(snapshot.failed);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setItems([]);
        }
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [companyId, adapter]);

  const personaOptions = useMemo(
    () => [...new Set(items.map((i) => i.primaryPersona).filter((p): p is string => Boolean(p)))].sort(),
    [items],
  );

  // Filtering = pure selection over persisted fields. Never refetches.
  const filtered = useMemo(() => {
    const minScore = filters.minScore.trim() !== '' && !Number.isNaN(Number(filters.minScore)) ? Number(filters.minScore) : null;
    const minConf = filters.minConfidence.trim() !== '' && !Number.isNaN(Number(filters.minConfidence)) ? Number(filters.minConfidence) : null;
    return items.filter((i) => {
      if (filters.band && i.qualificationBand !== filters.band) return false;
      if (filters.freshness && i.freshness !== filters.freshness) return false;
      if (filters.persona && i.primaryPersona !== filters.persona) return false;
      if (minScore !== null && (i.overallScore === null || i.overallScore < minScore)) return false;
      if (minConf !== null && (i.confidence === null || i.confidence < minConf)) return false;
      if (filters.from && (!i.generatedAt || i.generatedAt.slice(0, 10) < filters.from)) return false;
      if (filters.to && (!i.generatedAt || i.generatedAt.slice(0, 10) > filters.to)) return false;
      return true;
    });
  }, [items, filters]);

  const agg = useMemo(() => {
    const available = filtered.filter((i) => i.status === 'available');
    const nowMs = now();
    const withinDays = (iso: string | null, days: number): boolean => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return Number.isFinite(t) && nowMs - t <= days * 86_400_000 && t <= nowMs;
    };
    return {
      analyzed: filtered.length,
      generated: available.length,
      neverGenerated: filtered.filter((i) => i.freshness === 'never_generated').length,
      fresh: filtered.filter((i) => i.freshness === 'fresh').length,
      stale: filtered.filter((i) => i.freshness === 'stale').length,
      pendingRegen: filtered.filter((i) => i.freshness === 'pending_regeneration').length,
      avgScore: mean(available.map((i) => i.overallScore).filter((s): s is number => typeof s === 'number')),
      avgConfidence: mean(available.map((i) => i.confidence).filter((c): c is number => typeof c === 'number')),
      bands: BAND_ORDER.map((band) => ({ key: band, count: filtered.filter((i) => i.qualificationBand === band).length })),
      freshnessDist: FRESHNESS_ORDER.map((f) => ({ key: f, count: filtered.filter((i) => i.freshness === f).length })),
      personas: countBy(filtered.map((i) => i.primaryPersona)),
      intents: INTENT_ORDER.map((band) => ({ key: band, count: filtered.filter((i) => i.intentBand === band).length })),
      topActions: countBy(filtered.map((i) => i.topAction)).slice(0, 5),
      engineVersions: countBy(filtered.map((i) => i.engineVersion)),
      generatedToday: available.filter((i) => withinDays(i.generatedAt, 1)).length,
      generated7d: available.filter((i) => withinDays(i.generatedAt, 7)).length,
      generated30d: available.filter((i) => withinDays(i.generatedAt, 30)).length,
    };
  }, [filtered, now]);

  const intentTotal = agg.intents.reduce((a, b) => a + b.count, 0);
  const topPersona = agg.personas[0] ?? null;
  const topBand = countBy(filtered.map((i) => i.qualificationBand))[0] ?? null;
  const maxBand = Math.max(1, ...agg.bands.map((b) => b.count));
  const maxFresh = Math.max(1, ...agg.freshnessDist.map((b) => b.count));
  const maxPersona = Math.max(1, ...agg.personas.map((b) => b.count));
  const maxAction = Math.max(1, ...agg.topActions.map((b) => b.count));

  const openLead = (leadId: string) => {
    const lead = cohort.get(leadId);
    if (lead) void router.push(`/lead-intelligence/${encodeURIComponent(lead.leadKey)}`);
  };

  const input = 'rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700';

  if (!companyId) return null;

  return (
    <div data-testid="intelligence-dashboard" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* INT-003A Gap 1: cohort-scoped wording — never imply company-wide analytics. */}
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-600">Latest Lead Intelligence</p>
          <p data-testid="dashboard-cohort-subtitle" className="text-xs text-gray-500">
            Analytics below represent the currently loaded lead cohort — the latest {items.length} of {portfolioTotal} leads, not
            company-wide analytics. Persisted engine output only — read-only.
          </p>
        </div>
      </div>

      {/* Filter row — selection over persisted values; never refetches. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <select aria-label="Qualification band" className={input} value={filters.band} onChange={(e) => setFilters((f) => ({ ...f, band: e.target.value }))}>
          <option value="">All bands</option>
          {BAND_ORDER.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select aria-label="Freshness" className={input} value={filters.freshness} onChange={(e) => setFilters((f) => ({ ...f, freshness: e.target.value }))}>
          <option value="">All freshness</option>
          {FRESHNESS_ORDER.map((f) => <option key={f} value={f}>{FRESHNESS_LABEL[f]}</option>)}
        </select>
        <select aria-label="Persona" className={input} value={filters.persona} onChange={(e) => setFilters((f) => ({ ...f, persona: e.target.value }))}>
          <option value="">All personas</option>
          {personaOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input aria-label="Minimum score" className={`${input} w-24`} placeholder="Min score" inputMode="numeric" value={filters.minScore} onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))} />
        <input aria-label="Minimum confidence" className={`${input} w-28`} placeholder="Min conf (0-1)" inputMode="decimal" value={filters.minConfidence} onChange={(e) => setFilters((f) => ({ ...f, minConfidence: e.target.value }))} />
        <input aria-label="Generated from" type="date" className={input} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input aria-label="Generated to" type="date" className={input} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        <button type="button" className="text-xs font-medium text-purple-600 hover:text-purple-700" onClick={() => setFilters(emptyDashboardFilters())}>
          Reset
        </button>
      </div>

      {pending ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading latest lead intelligence…</div>
      ) : failed ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Intelligence unavailable.</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No leads to analyze yet.</div>
      ) : (
        <>
          {/* Top KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <Tile label="Total Leads" value={portfolioTotal} hint={`analyzing ${agg.analyzed}`} />
            <Tile label="Intelligence Generated" value={agg.generated} />
            <Tile label="Never Generated" value={agg.neverGenerated} />
            <Tile label="Fresh" value={agg.fresh} />
            <Tile label="Stale" value={agg.stale} />
            <Tile label="Pending Regeneration" value={agg.pendingRegen} />
            <Tile label="Average Score" value={agg.avgScore !== null ? round1(agg.avgScore) : '—'} />
            <Tile label="Average Confidence" value={pct(agg.avgConfidence)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card title="Qualification Distribution">
              {agg.bands.map((b) => (
                <BarRow key={b.key} label={b.key} count={b.count} max={maxBand} chipClass={BAND_STYLE[b.key]} />
              ))}
            </Card>

            <Card title="Freshness Distribution">
              {agg.freshnessDist.map((f) => (
                <BarRow key={f.key} label={FRESHNESS_LABEL[f.key]} count={f.count} max={maxFresh} />
              ))}
            </Card>

            <Card title="Persona Distribution">
              {agg.personas.length === 0 ? <p className="text-xs text-gray-500">No personas classified.</p> : null}
              {agg.personas.slice(0, 6).map((p) => (
                <BarRow key={p.key} label={p.key} count={p.count} max={maxPersona} />
              ))}
            </Card>

            <Card title="Intent Distribution">
              {agg.intents.map((i) => (
                <div key={i.key} className="flex justify-between gap-4 border-b border-gray-50 py-1.5 last:border-0">
                  <span className="capitalize text-gray-500">{i.key}</span>
                  <span className="font-medium text-gray-900">
                    {i.count} ({intentTotal > 0 ? Math.round((i.count / intentTotal) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </Card>

            <Card title="Recommendation Summary">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top next best actions</p>
              {agg.topActions.length === 0 ? <p className="text-xs text-gray-500">No recommendations persisted.</p> : null}
              {agg.topActions.map((a) => (
                <BarRow key={a.key} label={a.key} count={a.count} max={maxAction} />
              ))}
              <div className="mt-2 border-t border-gray-100 pt-2">
                <div className="flex justify-between gap-4 py-1">
                  <span className="text-gray-500">Most common persona</span>
                  <span className="font-medium text-gray-900">{topPersona ? `${topPersona.key} (${topPersona.count})` : '—'}</span>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <span className="text-gray-500">Most common band</span>
                  <span className="font-medium text-gray-900">{topBand ? `${topBand.key} (${topBand.count})` : '—'}</span>
                </div>
              </div>
            </Card>

            <Card title="Version & Timeline">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Engine versions</p>
              {agg.engineVersions.length === 0 ? <p className="text-xs text-gray-500">No versions persisted.</p> : null}
              {agg.engineVersions.map((v) => (
                <div key={v.key} className="flex justify-between gap-4 py-1">
                  <span className="font-mono text-xs text-gray-600">{v.key}</span>
                  <span className="font-medium text-gray-900">{v.count}</span>
                </div>
              ))}
              <div className="mt-2 border-t border-gray-100 pt-2">
                <div className="flex justify-between gap-4 py-1"><span className="text-gray-500">Generated today</span><span className="font-medium text-gray-900">{agg.generatedToday}</span></div>
                <div className="flex justify-between gap-4 py-1"><span className="text-gray-500">Last 7 days</span><span className="font-medium text-gray-900">{agg.generated7d}</span></div>
                <div className="flex justify-between gap-4 py-1"><span className="text-gray-500">Last 30 days</span><span className="font-medium text-gray-900">{agg.generated30d}</span></div>
              </div>
            </Card>
          </div>

          {/* Intelligence table — server-sorted (score desc); rows open Lead Detail. */}
          <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Qualification</th>
                  <th className="px-4 py-3">Persona</th>
                  <th className="px-4 py-3">Intent</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Freshness</th>
                  <th className="px-4 py-3">Generated</th>
                  <th className="px-4 py-3">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((item) => (
                  <tr
                    key={item.leadId}
                    data-testid={`intel-row-${item.leadId}`}
                    onClick={() => openLead(item.leadId)}
                    className="cursor-pointer hover:bg-purple-50/40"
                  >
                    <td className="px-4 py-2 font-medium text-gray-900">{cohort.get(item.leadId)?.label ?? item.leadId}</td>
                    <td className="px-4 py-2">{item.overallScore ?? '—'}</td>
                    <td className="px-4 py-2">
                      {item.qualificationBand ? (
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_STYLE[item.qualificationBand] ?? BAND_STYLE.cold}`}>
                          {item.qualificationBand}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2">{item.primaryPersona ?? '—'}</td>
                    <td className="px-4 py-2 capitalize">{item.intentBand ?? '—'}</td>
                    <td className="px-4 py-2">{pct(item.confidence)}</td>
                    <td className="px-4 py-2">{FRESHNESS_LABEL[item.freshness] ?? item.freshness}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{item.generatedAt ? item.generatedAt.slice(0, 10) : '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{item.engineVersion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No leads match the current filters.</p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
