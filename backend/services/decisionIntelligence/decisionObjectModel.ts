/**
 * decisionObjectModel.ts — the canonical Decision Object (PMF-007R §1).
 *
 * ONE machine-readable representation of a decision that every future platform
 * capability consumes instead of parsing recommendation text. Additive: Decision
 * Objects are DERIVED deterministically from recommendations; recommendations,
 * prompts, and quality are unchanged. Pure — no clock/randomness (createdAt is
 * injected), so a decision is fully reproducible and replayable.
 */

import type { DecisionStatus } from './decisionLifecycle';

export const DECISION_SCHEMA_VERSION = '1.0';

/** Canonical decision type — derived from the recommendation graph node. */
export type DecisionType = string;

export type ImpactBand = 'critical' | 'high' | 'medium' | 'low';
export type EffortBand = 'high' | 'medium' | 'low';
export type UrgencyBand = 'immediate' | 'high' | 'medium' | 'low';
export type RiskBand = 'high' | 'medium' | 'low';

export interface DecisionSource {
  node: string;
  capability: string;
  runtime: 'platform' | 'legacy';
}

/** THE canonical Decision Object (§1). */
export interface DecisionObject {
  decisionId: string;
  decisionType: DecisionType;
  priority: number;              // lower = higher priority
  confidence: number;            // 0–100
  status: DecisionStatus;
  title: string;
  summary: string;
  recommendedAction: string;
  expectedOutcome: string;
  businessImpact: ImpactBand;
  effort: EffortBand;
  urgency: UrgencyBand;
  risk: RiskBand;
  dependencies: string[];        // decisionIds / node ids this depends on
  prerequisites: string[];
  reasonCodes: string[];
  evidence: string[];
  knowledgeVersion: number | null;
  decisionSource: DecisionSource;
  createdAt: string;
  schemaVersion: string;
  metadata: Record<string, unknown>;
}

/** Stable non-crypto hash (djb2) → hex. Deterministic. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Deterministic decision id — identical logical decision yields the identical id. */
export function decisionId(parts: { companyId: string; decisionType: string; node: string; title: string }): string {
  return `dec_${hash(`${parts.companyId}:${parts.decisionType}:${parts.node}:${parts.title}`)}`;
}

/** Deterministic bands from priority/confidence. Pure. */
export function impactFor(priority: number): ImpactBand {
  if (priority <= 5) return 'critical';
  if (priority <= 20) return 'high';
  if (priority <= 35) return 'medium';
  return 'low';
}
export function urgencyFor(priority: number): UrgencyBand {
  if (priority <= 5) return 'immediate';
  if (priority <= 20) return 'high';
  if (priority <= 35) return 'medium';
  return 'low';
}

export interface BuildDecisionInput {
  companyId: string;
  node: string;
  capability: string;
  runtime?: 'platform' | 'legacy';
  decisionType: DecisionType;
  title: string;
  summary: string;
  recommendedAction: string;
  expectedOutcome: string;
  priority: number;
  confidence: number;
  knowledgeVersion: number | null;
  evidence: string[];
  reasonCodes: string[];
  dependencies: string[];
  prerequisites?: string[];
  businessImpact?: ImpactBand;
  effort?: EffortBand;
  urgency?: UrgencyBand;
  risk?: RiskBand;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/** Build a canonical Decision Object. Deterministic; status starts CREATED. */
export function buildDecisionObject(input: BuildDecisionInput): DecisionObject {
  const priority = Number.isFinite(input.priority) ? input.priority : 50;
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence)));
  return {
    decisionId: decisionId({ companyId: input.companyId, decisionType: input.decisionType, node: input.node, title: input.title }),
    decisionType: input.decisionType,
    priority,
    confidence,
    status: 'CREATED',
    title: input.title,
    summary: input.summary,
    recommendedAction: input.recommendedAction,
    expectedOutcome: input.expectedOutcome,
    businessImpact: input.businessImpact ?? impactFor(priority),
    effort: input.effort ?? 'medium',
    urgency: input.urgency ?? urgencyFor(priority),
    risk: input.risk ?? 'low',
    dependencies: [...input.dependencies].sort(),
    prerequisites: [...(input.prerequisites ?? [])].sort(),
    reasonCodes: Array.from(new Set(input.reasonCodes)).sort(),
    evidence: [...input.evidence],
    knowledgeVersion: input.knowledgeVersion,
    decisionSource: { node: input.node, capability: input.capability, runtime: input.runtime ?? 'platform' },
    createdAt: input.createdAt,
    schemaVersion: DECISION_SCHEMA_VERSION,
    metadata: input.metadata ?? {},
  };
}
