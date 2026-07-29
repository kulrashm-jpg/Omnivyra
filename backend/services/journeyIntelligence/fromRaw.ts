/**
 * J-B202..B206 — Journey ingestion (pure, deterministic). Projects raw touchpoints into canonical
 * evidence + progression facets + references-only graph edges on the SHARED spine. ORDERING is
 * DETERMINISTIC and derives from EVIDENCE CHRONOLOGY (`observedAt`, id tie-break) — never from the
 * graph. Stages / milestones / transitions / continuity / state are DESCRIPTIVE (no prediction, no
 * intent). Absent fields abstain (never fabricate).
 */

import type { JourneyFacets, JourneyActorType, JourneyStatus, TouchpointEntry, MilestoneEntry, TransitionEntry, EvidenceRef } from './types';
import type { GraphEdge } from '../intelligence/canonical';
import { facet, evidenceRef } from '../intelligence/canonical';
import { journeyEdge } from './graph';

export interface JourneyRawTouchpoint { entityType?: string; entityId?: string; label?: string; observedAt: string; stage?: string; milestone?: string; }
export interface JourneyRawInput {
  companyId: string;
  asOf: string;
  source?: string;
  journeyId: string;
  actorRef?: string | null;
  actorType?: JourneyActorType;
  companyRef?: string | null;
  touchpoints?: JourneyRawTouchpoint[];
  pendingStages?: string[];
  status?: JourneyStatus;
  gapThresholdDays?: number;
}

/** Deterministic canonical id: slug of journeyId (exact — same id ⇒ same journey). */
export function resolveJourneyId(journeyId: string): string {
  return String(journeyId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'journey';
}

const DAY = 86_400_000;
const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedJourney { key: { companyId: string; journeyId: string }; facets: Partial<JourneyFacets>; evidence: EvidenceRef[]; edges: GraphEdge[]; }

/** PROJECT raw touchpoints into canonical evidence + progression facets + references-only edges. */
export function journeyFromRaw(raw: JourneyRawInput): AdoptedJourney {
  const src = raw.source ?? 'journey_capture';
  const id = resolveJourneyId(raw.journeyId);
  const evidence: EvidenceRef[] = [];
  const edges: GraphEdge[] = [];
  const facets: Partial<JourneyFacets> = {};
  const one = <T>(cond: boolean, name: keyof JourneyFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };
  const mk = (label: string, value: string | number, at: string, kind: 'structured' | 'observed' | 'inferred' = 'observed'): EvidenceRef => {
    const e = evidenceRef({ id: `journey:${label}:${src}:${at}`, kind, label, value, source: { system: src }, observedAt: at, recordedAt: at });
    evidence.push(e); return e;
  };

  // Identity (always) — actor is a REFERENCE (visitor/lead), never re-owned.
  one(true, 'identity', { canonical_id: id, actorRef: raw.actorRef ?? null, actorType: raw.actorType, companyRef: raw.companyRef ?? null }, [mk('journey', id, raw.asOf, 'structured')]);
  if (has(raw.actorRef)) edges.push(journeyEdge(id, 'journey_of', raw.actorType === 'lead' ? 'lead' : 'visitor', raw.actorRef!, [mk('actor', raw.actorRef!, raw.asOf, 'structured')], 0.7));
  if (has(raw.companyRef)) edges.push(journeyEdge(id, 'belongs_to', 'company', raw.companyRef!, [mk('company', raw.companyRef!, raw.asOf, 'structured')], 0.6));

  // DETERMINISTIC chronological order (observedAt, then stable id) — the ONE source of ordering.
  const tps = [...(raw.touchpoints ?? [])]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.observedAt === b.t.observedAt ? a.i - b.i : a.t.observedAt.localeCompare(b.t.observedAt)));

  if (tps.length) {
    const ordered: TouchpointEntry[] = [];
    const tpEv: EvidenceRef[] = [];
    tps.forEach(({ t }, idx) => {
      const tpId = `${id}:tp:${idx}`;
      const e = mk(`touchpoint:${idx}`, t.label ?? t.entityId ?? t.entityType ?? 'touchpoint', t.observedAt, 'observed');
      tpEv.push(e);
      ordered.push({ id: tpId, entityType: t.entityType, entityId: t.entityId, label: t.label, at: t.observedAt });
      edges.push(journeyEdge(id, 'has_touchpoint', 'touchpoint', tpId, [e], 0.55));
      // reference the touched entity (offering/content/campaign) — that entity owns its own semantics
      if (has(t.entityType) && has(t.entityId) && ['offering', 'content', 'campaign'].includes(t.entityType!)) {
        edges.push(journeyEdge(id, 'engaged_with', t.entityType as any, t.entityId!, [e], 0.5));
      }
    });
    one(true, 'touchpoints', { ordered, count: ordered.length }, tpEv);

    // Stages — chronological, distinct-consecutive.
    const stageSeq = tps.map(({ t }) => t.stage).filter((s): s is string => has(s));
    const distinctInOrder: string[] = [];
    for (const s of stageSeq) if (distinctInOrder[distinctInOrder.length - 1] !== s) distinctInOrder.push(s);
    if (distinctInOrder.length) {
      const current = distinctInOrder[distinctInOrder.length - 1];
      const previous = distinctInOrder.length > 1 ? distinctInOrder[distinctInOrder.length - 2] : null;
      const completed = distinctInOrder.slice(0, -1);
      const stageEv = tps.filter(({ t }) => has(t.stage)).map(({ t }) => mk(`stage:${t.stage}`, t.stage!, t.observedAt, 'inferred'));
      one(true, 'stages', { current, previous, completed, pending: raw.pendingStages ?? [] }, stageEv);
      for (const s of [...new Set(distinctInOrder)]) edges.push(journeyEdge(id, 'reached_stage', 'stage', `${id}:stage:${s}`, [mk(`reached:${s}`, s, raw.asOf, 'inferred')], 0.55));

      // Transitions — consecutive distinct stage changes with the chronology of the change.
      const transitions: TransitionEntry[] = [];
      let prev: string | null = null; let prevAt: string | null = null;
      for (const { t } of tps) {
        if (!has(t.stage)) continue;
        if (prev !== null && prev !== t.stage) transitions.push({ from: prev, to: t.stage!, at: t.observedAt });
        prev = t.stage!; prevAt = t.observedAt; void prevAt;
      }
      one(transitions.length > 0, 'transitions', { transitions }, transitions.map((tr) => mk(`transition:${tr.from}->${tr.to}`, `${tr.from}->${tr.to}`, tr.at, 'inferred')));
    }

    // Milestones — achievements with timestamps + evidence.
    const milestones: MilestoneEntry[] = tps.filter(({ t }) => has(t.milestone)).map(({ t }) => ({ name: t.milestone!, at: t.observedAt }));
    if (milestones.length) {
      one(true, 'milestones', { achieved: milestones }, milestones.map((m) => mk(`milestone:${m.name}`, m.name, m.at, 'observed')));
      for (const m of milestones) edges.push(journeyEdge(id, 'achieved_milestone', 'milestone', `${id}:ms:${m.name}`, [mk(`achieved:${m.name}`, m.name, m.at, 'observed')], 0.6));
    }

    // Continuity — span + gaps (descriptive; NOT prediction).
    const firstAt = tps[0].t.observedAt, lastAt = tps[tps.length - 1].t.observedAt;
    const gapThreshold = (raw.gapThresholdDays ?? 30) * DAY;
    let gaps = 0;
    for (let i = 1; i < tps.length; i++) if (Date.parse(tps[i].t.observedAt) - Date.parse(tps[i - 1].t.observedAt) > gapThreshold) gaps++;
    const spanDays = Math.round((Date.parse(lastAt) - Date.parse(firstAt)) / DAY);
    one(true, 'continuity', { continuous: gaps === 0, spanDays, gaps, firstAt, lastAt }, [mk('continuity', spanDays, lastAt, 'inferred')]);
  }

  // State — descriptive summary (provided or default active).
  const status: JourneyStatus = raw.status ?? 'active';
  one(true, 'state', { status }, [mk('state', status, raw.asOf, 'inferred')]);

  return { key: { companyId: raw.companyId, journeyId: id }, facets, evidence, edges };
}
