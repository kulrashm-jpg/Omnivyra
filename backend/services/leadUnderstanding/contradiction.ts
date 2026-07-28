/**
 * LI-B107 — Contradiction engine (pure, deterministic). First-class contradiction handling:
 * conflicting sources, stale-vs-fresh, confidence divergence, stated-vs-observed, AI conflict.
 * Contradictions become explicit objects that LOWER confidence — evidence is NEVER silently
 * overwritten or deleted; the loser is retained and the resolution recorded.
 */

import type { EvidenceRef, ScoreContribution, ContradictionRef, ContradictionResolution } from './types';

const STALE_MS = 30 * 86_400_000; // 30d gap ⇒ stale-vs-fresh
const CONF_DIVERGENCE = 0.25;     // score disagreement among confident contributors

function id(kind: string, a: string, b: string): string { const [x, y] = [a, b].sort(); return `${kind}:${x}:${y}`; }

/** Detect contradictions among evidence items that describe the same labelled fact. */
export function detectEvidenceContradictions(evidence: EvidenceRef[]): ContradictionRef[] {
  const out: ContradictionRef[] = [];
  const active = evidence.filter((e) => e.lifecycle !== 'superseded' && e.lifecycle !== 'expired');
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (a.label !== b.label) continue;
      if (a.value == null || b.value == null || a.value === b.value) continue;
      const sameSystem = a.source.system === b.source.system;
      const gap = Math.abs(Date.parse(a.observedAt) - Date.parse(b.observedAt));
      let kind: ContradictionRef['kind'];
      let resolution: ContradictionResolution;
      if (gap >= STALE_MS) { kind = 'stale_vs_fresh'; resolution = 'prefer_fresh'; }
      else if (a.kind === 'ai_generated' || b.kind === 'ai_generated') { kind = 'ai_conflict'; resolution = 'prefer_structured'; }
      else if (!sameSystem) { kind = 'source_conflict'; resolution = 'prefer_higher_confidence'; }
      else { kind = 'stated_vs_observed'; resolution = 'flag_unresolved'; }
      out.push({ id: id(kind, a.id, b.id), kind, a: a.id, b: b.id, resolution, resolved: resolution !== 'flag_unresolved' });
    }
  }
  return dedupe(out);
}

/** Detect divergence among score contributors for the same dimension (both confident, values differ). */
export function detectScoreContradictions(contributions: ScoreContribution[]): ContradictionRef[] {
  const out: ContradictionRef[] = [];
  const byDim = new Map<string, ScoreContribution[]>();
  for (const c of contributions) { if (c.value == null) continue; const k = c.dimension; byDim.set(k, [...(byDim.get(k) ?? []), c]); }
  for (const [, list] of byDim) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.confidence >= 0.6 && b.confidence >= 0.6 && Math.abs((a.value as number) - (b.value as number)) >= CONF_DIVERGENCE) {
          const ea = a.evidence[0]?.id ?? `${a.contributor}:${a.dimension}`;
          const eb = b.evidence[0]?.id ?? `${b.contributor}:${b.dimension}`;
          out.push({ id: id('confidence_divergence', ea, eb), kind: 'confidence_divergence', a: ea, b: eb, resolution: 'prefer_higher_confidence', resolved: a.confidence !== b.confidence, note: `${a.contributor} vs ${b.contributor} on ${a.dimension}` });
        }
      }
    }
  }
  return dedupe(out);
}

function dedupe(c: ContradictionRef[]): ContradictionRef[] {
  const seen = new Set<string>(); const out: ContradictionRef[] = [];
  for (const x of c) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve a contradiction → the winning evidence id. NEVER deletes the loser (audit-safe). */
export function resolveContradiction(c: ContradictionRef, evidenceById: Map<string, EvidenceRef>): { winner: string | null; resolved: boolean } {
  const a = evidenceById.get(c.a), b = evidenceById.get(c.b);
  if (c.resolution === 'flag_unresolved' || !a || !b) return { winner: null, resolved: false };
  if (c.resolution === 'prefer_fresh') return { winner: (a.observedAt >= b.observedAt ? a.id : b.id), resolved: true };
  if (c.resolution === 'prefer_structured') return { winner: (a.kind === 'structured' ? a.id : b.kind === 'structured' ? b.id : null), resolved: b.kind === 'structured' || a.kind === 'structured' };
  const wa = a.weight ?? 0.5, wb = b.weight ?? 0.5; // prefer_higher_confidence proxy = weight
  return { winner: wa >= wb ? a.id : b.id, resolved: wa !== wb };
}
