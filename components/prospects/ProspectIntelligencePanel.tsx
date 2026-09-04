/**
 * WS-10 — the Prospect Intelligence panel.
 *
 * A presentation layer over `/api/prospects/:id`. It computes no score, derives
 * no state and fills no gap: every value shown is rendered exactly as the
 * canonical services produced it, and every absence is rendered AS an absence.
 *
 * ─── WHY EVERY SECTION RENDERS ITS STATE ──────────────────────────────────
 * The API distinguishes `available`, `empty`, `not_evaluated`, `not_implemented`
 * and `failed`, and each means something different to a person looking at the
 * screen: nothing to show, nothing yet knowable, nothing the platform can do,
 * and something broken. Rendering all five as a blank card would be the UI
 * quietly re-collapsing the distinction the whole stack works to preserve — so
 * the state and its reason are shown, never a zero and never an empty box.
 *
 * A dimension marked `not_implemented` shows "Not implemented" with the
 * service's own reason. It never shows 0%.
 */

import React from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';

type SectionState = 'available' | 'empty' | 'not_evaluated' | 'not_implemented' | 'failed';

interface Section<T = unknown> { state: SectionState; reason: string; data: T | null }

interface DimensionView {
  dimension: string;
  state: SectionState;
  value: number | null;
  confidence: number | null;
  contributors: string[];
  reason: string;
}

interface ProspectDetail {
  version: string;
  prospectId: string;
  personId: string | null;
  accountId: string | null;
  engagement: Section<{
    reason: string;
    engagement: { threadCount: number; messageCount: number; inbound: number; outbound: number; channels: string[]; lastActivityAt: string | null };
    timeline: Array<{ id: string; kind: string; channel: string | null; direction: string | null; observedAt: string | null; observedAtSource: string }>;
  }>;
  account: Section<{
    account: { name: string | null; domain: string | null };
    completeness: { known: number; total: number };
    contacts: Array<{ personId: string; attributes: Record<string, string | null> }>;
    consistency: { contested: string[]; unattested: string[] };
    freshness: { attributesUpdatedAt: string | null; ageDays: number | null };
  }>;
  enrichment: Section<{ counts: Record<string, number>; toEnrich: Array<{ attribute: string }> }>;
  scoring: Section<{ dimensions: DimensionView[]; overall: number | null; confidence: number; contextGaps: Array<{ kind: string; detail: string }> }>;
  recommendation: Section<{ action: string | null; channel: string | null; timing: string | null; confidence: number | null; unknowns: string[]; evidenceIds: string[] }>;
  readiness: Section<{
    readiness: string; reason: string; governanceChannel: string | null;
    requiredMissingFields: string[]; constraints: string[];
    suppression: { decision: string; governanceType: string | null } | null;
  }>;
  outcomes: Section<{ counts: Array<{ type: string; count: number; observable: boolean }>; completeness: { outcomes: number } }>;
}

const STATE_STYLE: Record<SectionState, string> = {
  available: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  empty: 'bg-gray-50 text-gray-600 ring-gray-200',
  not_evaluated: 'bg-amber-50 text-amber-700 ring-amber-200',
  not_implemented: 'bg-slate-100 text-slate-600 ring-slate-300',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const STATE_LABEL: Record<SectionState, string> = {
  available: 'Available',
  empty: 'Nothing recorded',
  not_evaluated: 'Not evaluated',
  not_implemented: 'Not implemented',
  failed: 'Unavailable',
};

const StateBadge: React.FC<{ state: SectionState }> = ({ state }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATE_STYLE[state]}`}>
    {STATE_LABEL[state]}
  </span>
);

/**
 * A card that ALWAYS shows its state and reason. When a section has no data the
 * reason is the content — that is the useful thing to show, not a blank space.
 */
const Card: React.FC<{ title: string; section: Section<unknown>; children?: React.ReactNode }> = ({ title, section, children }) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <header className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <StateBadge state={section.state} />
    </header>
    <p className="mb-3 text-xs leading-relaxed text-gray-500">{section.reason}</p>
    {section.state === 'available' ? children : null}
  </section>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="text-xs font-medium text-gray-900">{value}</span>
  </div>
);

/** `null` renders as an em dash, never as 0 — an unknown is not a zero. */
const show = (v: string | number | null | undefined): React.ReactNode =>
  v === null || v === undefined || v === '' ? <span className="text-gray-400">—</span> : String(v);

const pct = (v: number | null): React.ReactNode =>
  v === null ? <span className="text-gray-400">—</span> : `${Math.round(v * 100)}%`;

export interface ProspectIntelligencePanelProps {
  companyId: string;
  prospectId: string;
}

const ProspectIntelligencePanel: React.FC<ProspectIntelligencePanelProps> = ({ companyId, prospectId }) => {
  const key = companyId && prospectId
    ? `/api/prospects/${encodeURIComponent(prospectId)}?companyId=${encodeURIComponent(companyId)}`
    : null;
  const { data, error, isLoading } = useSWR<ProspectDetail>(key, (u: string) => apiFetch(u).then((r) => r.json()));

  if (!companyId) return <p className="text-sm text-gray-500">Select a company to view prospect intelligence.</p>;
  if (isLoading) return <p className="text-sm text-gray-500">Loading prospect intelligence…</p>;
  if (error) return <p className="text-sm text-rose-600">Prospect intelligence is unavailable. It has not been altered — only unread.</p>;
  if (!data) return <p className="text-sm text-gray-500">No prospect found in this company.</p>;

  const eng = data.engagement.data;
  const acct = data.account.data;
  const score = data.scoring.data;
  const nba = data.recommendation.data;
  const ready = data.readiness.data;
  const out = data.outcomes.data;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600">Prospect</p>
        <h2 className="mt-1 text-lg font-bold text-gray-900">{data.prospectId}</h2>
        <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <Row label="Person" value={show(data.personId)} />
          <Row label="Account" value={show(data.accountId)} />
          <Row label="Contract version" value={show(data.version)} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Outreach readiness" section={data.readiness}>
          <div className="space-y-1">
            <Row label="Readiness" value={show(ready?.readiness)} />
            <Row label="Governance channel" value={show(ready?.governanceChannel)} />
            <Row label="Suppression" value={show(ready?.suppression?.decision)} />
            {ready?.suppression?.governanceType
              ? <Row label="Suppressed by" value={show(ready.suppression.governanceType)} /> : null}
            {(ready?.requiredMissingFields ?? []).length > 0
              ? <Row label="Blocking" value={(ready?.requiredMissingFields ?? []).join(', ')} /> : null}
            {(ready?.constraints ?? []).length > 0
              ? <Row label="Constraints" value={(ready?.constraints ?? []).join(', ')} /> : null}
          </div>
        </Card>

        <Card title="Next best action" section={data.recommendation}>
          <div className="space-y-1">
            <Row label="Action" value={show(nba?.action)} />
            <Row label="Channel" value={show(nba?.channel)} />
            <Row label="Timing" value={show(nba?.timing)} />
            <Row label="Confidence" value={pct(nba?.confidence ?? null)} />
            <Row label="Evidence" value={`${nba?.evidenceIds?.length ?? 0} reference(s)`} />
          </div>
          {(nba?.unknowns ?? []).length > 0 ? (
            <p className="mt-3 text-[11px] italic text-amber-700">
              The engine could not know: {(nba?.unknowns ?? []).join('; ')}
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="Scoring and ICP fit" section={data.scoring}>
        <div className="space-y-1">
          <Row label="Overall" value={pct(score?.overall ?? null)} />
          <Row label="Score confidence" value={pct(score?.confidence ?? null)} />
        </div>
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5 font-medium">Dimension</th>
              <th className="py-1.5 font-medium">Value</th>
              <th className="py-1.5 font-medium">Confidence</th>
              <th className="py-1.5 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {(score?.dimensions ?? []).map((d) => (
              <tr key={d.dimension} className="border-b border-gray-100 last:border-0">
                <td className="py-1.5 text-gray-700">{d.dimension.replace(/_/g, ' ')}</td>
                {/* A not-evaluated or not-implemented dimension shows a dash. Never 0%. */}
                <td className="py-1.5 font-medium text-gray-900">{pct(d.value)}</td>
                <td className="py-1.5 text-gray-600">{pct(d.confidence)}</td>
                <td className="py-1.5"><StateBadge state={d.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {(score?.contextGaps ?? []).length > 0 ? (
          <div className="mt-3 rounded-lg bg-amber-50 p-3">
            <p className="text-[11px] font-semibold text-amber-800">Evidence gaps</p>
            <ul className="mt-1 space-y-0.5">
              {(score?.contextGaps ?? []).map((g) => (
                <li key={g.kind} className="text-[11px] text-amber-700">{g.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Account intelligence" section={data.account}>
          <div className="space-y-1">
            <Row label="Name" value={show(acct?.account?.name)} />
            <Row label="Domain" value={show(acct?.account?.domain)} />
            <Row label="Known facts" value={`${acct?.completeness?.known ?? 0} of ${acct?.completeness?.total ?? 0}`} />
            <Row label="Attributes updated" value={show(acct?.freshness?.attributesUpdatedAt)} />
            {(acct?.consistency?.contested ?? []).length > 0
              ? <Row label="Sources disagree on" value={(acct?.consistency?.contested ?? []).join(', ')} /> : null}
          </div>
          {(acct?.contacts ?? []).length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Buying committee (observed)</p>
              <ul className="space-y-1">
                {(acct?.contacts ?? []).map((c) => (
                  <li key={c.personId} className="flex justify-between gap-3 text-xs">
                    <span className="text-gray-700">{show(c.attributes.job_title)}</span>
                    {/* Buying role as an OBSERVED ATTRIBUTE — distinct from the
                        unimplemented Buying Role score dimension above. */}
                    <span className="font-medium text-gray-900">{show(c.attributes.buying_role)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card title="Engagement and timeline" section={data.engagement}>
          <div className="space-y-1">
            <Row label="Threads" value={eng?.engagement?.threadCount ?? 0} />
            <Row label="Messages" value={eng?.engagement?.messageCount ?? 0} />
            <Row label="Inbound / outbound" value={`${eng?.engagement?.inbound ?? 0} / ${eng?.engagement?.outbound ?? 0}`} />
            <Row label="Channels" value={(eng?.engagement?.channels ?? []).join(', ') || '—'} />
            <Row label="Last activity" value={show(eng?.engagement?.lastActivityAt)} />
          </div>
          {(eng?.timeline ?? []).length > 0 ? (
            <ul className="mt-3 space-y-1">
              {(eng?.timeline ?? []).slice(-6).reverse().map((t) => (
                <li key={t.id} className="flex justify-between gap-3 text-[11px]">
                  <span className="text-gray-600">{t.kind} · {show(t.channel)} · {show(t.direction)}</span>
                  <span className="text-gray-500">
                    {show(t.observedAt)}
                    {/* An event dated only by our ingest time says so, rather
                        than passing as an observation the source made. */}
                    {t.observedAtSource === 'ingest' ? ' (ingest time)' : ''}
                    {t.observedAtSource === 'none' ? ' (undated)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Enrichment plan" section={data.enrichment}>
          <Row label="Fields planned" value={data.enrichment.data?.toEnrich?.length ?? 0} />
          <div className="mt-2 space-y-1">
            {Object.entries(data.enrichment.data?.counts ?? {}).map(([state, n]) => (
              <Row key={state} label={state} value={n as number} />
            ))}
          </div>
        </Card>

        <Card title="Outreach outcomes" section={data.outcomes}>
          <Row label="Recorded" value={out?.completeness?.outcomes ?? 0} />
          <div className="mt-2 space-y-1">
            {(out?.counts ?? []).map((c) => (
              <Row
                key={c.type}
                label={c.type.replace(/_/g, ' ')}
                value={c.observable
                  ? c.count
                  // A zero for an unobservable type is not "it did not happen".
                  : <span className="text-gray-400" title="No transport reports this outcome">not observable</span>}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ProspectIntelligencePanel;
