/**
 * G-C304 — Cross-Entity Reasoning Engine (pure, deterministic).
 *
 * Reasons ACROSS canonical entities using the assembled context. Produces DERIVED reasoning as
 * canonical `ReasoningTrace`s (reusing the shared reasoning contract) — always grounded in canonical
 * evidence, ABSTAINING (conclusion null + unknown) when the required entities or evidence are absent.
 * It draws conclusions ABOUT the relationships between entities; it never re-owns or re-scores an
 * entity's semantics.
 *
 * Insight rules (deterministic, keyed on which entity types are present):
 *   lead + company            → qualification    (does the account context support the lead?)
 *   company + offering        → portfolio        (how the offering sits in the company's portfolio)
 *   lead + offering           → interest         (lead ↔ offering relevance)
 *   lead + company + offering → buying_context   (the unified buying picture)
 */

import type { CrossEntityContext, CrossEntityInsight, CrossEntityInsightKind, EvidenceRef } from './types';
import { reasoningTrace, validateReasoning, fuseEvidence, clamp01 } from '../intelligence/canonical';
import { evidenceOf } from './contextAssembler';

interface Rule { kind: CrossEntityInsightKind; requires: string[]; claim: string; conclusion: string; }
const RULES: Rule[] = [
  { kind: 'qualification', requires: ['lead', 'company'], claim: 'account context qualifies the lead', conclusion: 'qualified_context' },
  { kind: 'portfolio', requires: ['company', 'offering'], claim: 'offering sits within the company portfolio', conclusion: 'portfolio_positioned' },
  { kind: 'interest', requires: ['lead', 'offering'], claim: 'lead relevance to the offering', conclusion: 'interest_indicated' },
  { kind: 'buying_context', requires: ['lead', 'company', 'offering'], claim: 'unified buying context', conclusion: 'buying_context_formed' },
];

/** Evidence contributed by the participating entities of the given types (deduped by id, sorted). */
function evidenceForTypes(context: CrossEntityContext, types: string[]): EvidenceRef[] {
  const want = new Set(types);
  const byId = new Map<string, EvidenceRef>();
  for (const e of context.entities) if (want.has(e.type)) for (const ev of evidenceOf(e.understanding)) byId.set(ev.id, ev);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function reasonAcrossEntities(context: CrossEntityContext): CrossEntityInsight[] {
  const present = new Set(context.entities.map((e) => e.type));
  const insights: CrossEntityInsight[] = [];

  for (const rule of RULES) {
    if (!rule.requires.every((t) => present.has(t))) continue;    // rule not applicable — skip (no fabrication)
    const entityKeys = context.entities.filter((e) => rule.requires.includes(e.type)).map((e) => e.key).sort();
    const because = evidenceForTypes(context, rule.requires);

    if (because.length === 0) {
      // Applicable but no evidence → ABSTAIN with an explicit unknown (valid abstention).
      const trace = reasoningTrace({ claim: rule.claim, conclusion: null, because: [], confidence: 0, method: 'deterministic', unknowns: ['insufficient_cross_entity_evidence'] });
      insights.push({ kind: rule.kind, claim: rule.claim, entities: entityKeys, trace, confidence: 0, abstained: true });
      continue;
    }

    const fusion = fuseEvidence(because);
    const confidence = clamp01(fusion.confidence * (0.6 + 0.1 * rule.requires.length));
    const trace = reasoningTrace({
      claim: rule.claim, conclusion: rule.conclusion, because, confidence, method: 'deterministic',
      contradictions: fusion.contradictions,
      assumptions: [`derived across ${rule.requires.join(' + ')} via the canonical intelligence graph`],
    });
    const valid = validateReasoning(trace);
    insights.push({ kind: rule.kind, claim: rule.claim, entities: entityKeys, trace, confidence: valid.valid ? confidence : 0, abstained: false });
  }

  return insights.sort((a, b) => a.kind.localeCompare(b.kind));
}
