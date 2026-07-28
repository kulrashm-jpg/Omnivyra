/**
 * V-B203 — Session Intelligence Enrichment (deterministic contributor). Enhances session understanding:
 * average session duration, average pages, visit intervals, return cadence, recent activity, historical
 * summaries. Descriptive only — does NOT infer journeys. Abstains without session data.
 */

import type { VisitorEngineOutput, VisitorIntelligenceContext } from './engineTypes';
import { emptyOutput, ord } from './engineTypes';
import { facet, mkEvidence, clamp01, decayFactor, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runSession(ctx: VisitorIntelligenceContext): VisitorEngineOutput {
  const r = ctx.raw; if (!r) return emptyOutput('session');
  const hist = ctx.history?.sessions ?? [];
  const hasSession = r.sessionCount != null || r.pageCount != null || r.durationSeconds != null || !!r.lastSeenAt || hist.length > 0;
  if (!hasSession) return emptyOutput('session');
  const src = r.source ?? 'visitor_capture', at = r.asOf ?? ctx.asOf;

  // Historical summaries (deterministic averages over prior sessions).
  const durations = hist.map((s) => s.durationSeconds ?? 0).filter((n) => n > 0);
  const pages = hist.map((s) => s.pages ?? 0).filter((n) => n > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : (r.durationSeconds ?? null);
  const avgPages = pages.length ? Number((pages.reduce((a, b) => a + b, 0) / pages.length).toFixed(2)) : (r.pageCount ?? null);

  const ev: EvidenceRef[] = [];
  const add = (l: string, v: string | number | boolean | undefined | null) => { if (v != null && v !== '') ev.push(mkEvidence('session', { label: l, value: v, source: src, observedAt: at, kind: 'observed' })); };
  add('count', r.sessionCount); add('avg_duration_s', avgDuration); add('avg_pages', avgPages);
  add('frequency', r.frequency); add('last_seen', r.lastSeenAt); add('first_seen', r.firstSeenAt); add('bounce', r.bounce);
  if (!ev.length) return emptyOutput('session');

  const o: VisitorEngineOutput = { ...emptyOutput('session'), abstained: false, evidence: ev };
  o.facets.session = facet({
    sessionCount: r.sessionCount, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, entryPage: r.entryPage,
    exitPage: r.exitPage, durationSeconds: avgDuration ?? undefined, pageCount: avgPages ?? undefined, frequency: r.frequency, bounce: r.bounce,
  }, ev);

  // recency = decay of last-seen toward asOf (fresher ⇒ higher). loyalty = session count + cadence.
  const recency = r.lastSeenAt ? decayFactor(r.lastSeenAt, ctx.asOf, 30) : 0.5;
  o.contributions.push({ dimension: 'recency', contributor: 'session', method: 'deterministic', value: clamp01(recency), confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  const loyalty = clamp01(0.5 * clamp01((r.sessionCount ?? 1) / 6) + 0.5 * ord(r.frequency));
  o.contributions.push({ dimension: 'loyalty', contributor: 'session', method: 'deterministic', value: loyalty, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });

  o.reasoning.push(reasoningTrace({ claim: 'session_summary', conclusion: `sessions=${r.sessionCount ?? hist.length}`, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`avg_duration=${avgDuration ?? 'n/a'}s, avg_pages=${avgPages ?? 'n/a'}, recency=${clamp01(recency)}`], unknowns: r.lastSeenAt ? [] : ['last-seen unknown ⇒ neutral recency'] }));
  return o;
}
