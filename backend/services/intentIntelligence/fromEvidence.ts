/**
 * I-B202..B206 — Intent ingestion (pure, deterministic). INTERPRETS observed evidence signals (each
 * carrying an objective + `observedAt`) into a canonical interpretation: primary intent + competing
 * intents + confidence/uncertainty/abstention + evidence summary, plus references-only graph edges.
 * DESCRIPTIVE only — it interprets OBSERVED evidence, it does NOT predict. Chronology derives from
 * evidence (`observedAt`, freshness-weighted via the shared `decayFactor`). Absent evidence ⇒ abstain
 * (primary intent null + an explicit unknown), never a fabricated objective.
 */

import type { IntentFacets, IntentObjective, IntentActorType, CompetingIntentEntry, EvidenceRef } from './types';
import type { GraphEdge, ReasoningTrace } from '../intelligence/canonical';
import { facet, evidenceRef, facetConfidenceFromEvidence, decayFactor, clamp01, reasoningTrace } from '../intelligence/canonical';
import { intentEdge } from './graph';

export interface IntentSignal { objective: IntentObjective; label?: string; observedAt: string; weight?: number; source?: string; }
export interface IntentEvidenceInput {
  companyId: string;
  asOf: string;
  source?: string;
  intentId: string;
  actorRef?: string | null;
  actorType?: IntentActorType;
  objectRef?: string | null;
  objectType?: string;             // 'offering' | 'company'
  signals?: IntentSignal[];
  halfLifeDays?: number;
  competingThreshold?: number;     // fraction of the primary aggregate a candidate must reach to be "competing"
}

/** Deterministic canonical id: slug of intentId (exact — same id ⇒ same intent). */
export function resolveIntentId(intentId: string): string {
  return String(intentId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'intent';
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedIntent { key: { companyId: string; intentId: string }; facets: Partial<IntentFacets>; evidence: EvidenceRef[]; edges: GraphEdge[]; reasoning: ReasoningTrace[]; }

export function intentFromEvidence(input: IntentEvidenceInput): AdoptedIntent {
  const src = input.source ?? 'intent_capture';
  const id = resolveIntentId(input.intentId);
  const halfLife = input.halfLifeDays ?? 45;
  const threshold = input.competingThreshold ?? 0.5;
  const evidence: EvidenceRef[] = [];
  const edges: GraphEdge[] = [];
  const reasoning: ReasoningTrace[] = [];
  const facets: Partial<IntentFacets> = {};
  const one = <T>(cond: boolean, name: keyof IntentFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };
  const mk = (label: string, value: string | number, at: string, idx: number, srcSys: string): EvidenceRef => {
    const e = evidenceRef({ id: `intent:${label}:${idx}:${srcSys}:${at}`, kind: 'observed', label, value, source: { system: srcSys }, observedAt: at, recordedAt: at });
    evidence.push(e); return e;
  };

  // Identity (always) — actor + object are REFERENCES (never re-owned).
  one(true, 'identity', { canonical_id: id, actorRef: input.actorRef ?? null, actorType: input.actorType, objectRef: input.objectRef ?? null, objectType: input.objectType },
    [mk('intent', id, input.asOf, 0, src)]);
  if (has(input.actorRef)) edges.push(intentEdge(id, 'intent_of', input.actorType === 'lead' ? 'lead' : 'visitor', input.actorRef!, [mk('actor', input.actorRef!, input.asOf, 0, src)], 0.7));
  if (has(input.objectRef)) edges.push(intentEdge(id, 'intent_toward', (input.objectType === 'company' ? 'company' : 'offering') as any, input.objectRef!, [mk('object', input.objectRef!, input.asOf, 0, src)], 0.6));

  const signals = input.signals ?? [];
  if (!signals.length) {
    // ABSTAIN — no observed evidence ⇒ null primary intent with an explicit unknown (honest empty-state).
    one(true, 'confidence', { confidence: 0, uncertainty: 1, abstained: true }, [mk('abstain', 'no_evidence', input.asOf, 0, src)]);
    reasoning.push(reasoningTrace({ claim: 'primary_intent', conclusion: null, because: [], confidence: 0, method: 'deterministic', unknowns: ['insufficient_intent_evidence'] }));
    return { key: { companyId: input.companyId, intentId: id }, facets, evidence, edges, reasoning };
  }

  // Aggregate per objective: freshness-weighted evidence (deterministic; chronology via observedAt).
  interface Agg { objective: string; aggregate: number; count: number; freshestAt: string; ev: EvidenceRef[]; }
  const byObjective = new Map<string, Agg>();
  signals.forEach((s, i) => {
    const sSrc = s.source ?? src;
    const e = mk(`signal:${s.objective}`, s.label ?? s.objective, s.observedAt, i + 1, sSrc);
    const w = clamp01((s.weight ?? 0.6) * decayFactor(s.observedAt, input.asOf, halfLife));
    const a = byObjective.get(s.objective) ?? { objective: s.objective, aggregate: 0, count: 0, freshestAt: s.observedAt, ev: [] };
    a.aggregate = clamp01(a.aggregate + w); a.count += 1; a.ev.push(e);
    if (s.observedAt > a.freshestAt) a.freshestAt = s.observedAt;
    byObjective.set(s.objective, a);
  });

  // Deterministic ranking: aggregate desc, then count desc, then freshest desc, then name asc.
  const ranked = [...byObjective.values()].sort((a, b) =>
    b.aggregate - a.aggregate || b.count - a.count || b.freshestAt.localeCompare(a.freshestAt) || a.objective.localeCompare(b.objective));
  const primary = ranked[0];
  const candidates: CompetingIntentEntry[] = ranked.map((a) => ({ objective: a.objective, confidence: facetConfidenceFromEvidence(a.ev), evidenceCount: a.count }));
  const competing = candidates.filter((c) => c.objective !== primary.objective && byObjective.get(c.objective)!.aggregate >= threshold * primary.aggregate);

  const primaryConfidence = facetConfidenceFromEvidence(primary.ev);
  const uncertainty = clamp01(1 - primaryConfidence);

  one(true, 'primaryIntent', { objective: primary.objective, rationale: `strongest observed evidence (${primary.count} signals)` }, primary.ev);
  one(true, 'competingIntents', { candidates }, evidence.filter((e) => e.label.startsWith('signal:')));
  one(true, 'confidence', { confidence: primaryConfidence, uncertainty, abstained: false }, primary.ev);

  reasoning.push(reasoningTrace({
    claim: 'primary_intent', conclusion: primary.objective, because: primary.ev, confidence: primaryConfidence, method: 'deterministic',
    assumptions: [`ranked by freshness-weighted evidence; competing=${competing.map((c) => c.objective).join(', ') || 'none'}`],
    unknowns: competing.length ? [] : [],
  }));

  return { key: { companyId: input.companyId, intentId: id }, facets, evidence, edges, reasoning };
}
