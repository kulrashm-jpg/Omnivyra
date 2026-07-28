/**
 * I-B201 (shadow runtime) — Intent shadow runtime (pure). Builds the canonical Understanding from
 * observed evidence and measures FIELD parity vs a deterministic re-interpretation of that input —
 * ZERO production behaviour change, authoritative OFF, consumed by nothing.
 * `computeIntentUnderstandingShadow` returns null when the flag is OFF (default).
 */

import type { IntentUnderstanding, IntentProjection } from './types';
import type { IntentEvidenceInput } from './fromEvidence';
import { intentFromEvidence } from './fromEvidence';
import { buildIntentUnderstanding } from './builder';
import { projectIntent } from './projection';
import { isIntentUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface IntentFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface IntentShadowComparison { intentId: string; divergences: IntentFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

export function compareToInput(u: IntentUnderstanding, input: IntentEvidenceInput): IntentShadowComparison {
  const c = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['actor_ref', c.actor_ref, input.actorRef ?? null],
    ['actor_type', c.actor_type, input.actorType ?? null],
    ['object_ref', c.object_ref, input.objectRef ?? null],
    ['abstained', c.abstained, (input.signals ?? []).length === 0],
  ];
  const divergences: IntentFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { intentId: u.key.intentId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface IntentShadowBundle { understanding: IntentUnderstanding; projection: IntentProjection; comparison: IntentShadowComparison; }

export function computeIntentUnderstandingShadow(input: IntentEvidenceInput): IntentShadowBundle | null {
  if (!isIntentUnderstandingEnabled()) return null;
  const a = intentFromEvidence(input);
  const understanding = buildIntentUnderstanding({ key: a.key, builtAt: input.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges, reasoning: a.reasoning });
  const projection = projectIntent(understanding, input.asOf);
  const comparison = compareToInput(understanding, input);
  return { understanding, projection, comparison };
}
