/**
 * LC-301 (W3) — Segmentation Rule Engine (pure, composable, explainable).
 *
 * A reusable boolean rule engine over the canonical lead view + operational overlay.
 * Rules are DATA (a nested RuleGroup), never hardcoded segments. It reuses the same
 * field model the existing `query.ts` filter engine exposes (source/campaign/status/
 * intent/interest/utm/company/…) plus the W2 operational fields (status/assignee) — it
 * does NOT introduce a second scoring engine; intent comes from the already-materialized
 * `scores`. Every evaluation returns WHY (matched conditions + evidence + confidence).
 */

import type { CanonicalLeadView } from '../leadIntelligence/types';

export type Operator =
  | 'eq' | 'neq' | 'contains' | 'not_contains'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in' | 'exists' | 'not_exists';

export interface Condition { field: string; operator: Operator; value?: unknown }
export interface RuleGroup { op: 'and' | 'or'; conditions?: Condition[]; groups?: RuleGroup[] }

export interface OperationalContext { status?: string | null; assignee?: string | null; tags?: string[] }
export interface EvalContext { view: CanonicalLeadView; operational?: OperationalContext }

export interface EvidenceItem { field: string; operator: Operator; expected: unknown; actual: unknown }
export interface EvalResult { matched: boolean; matchedRules: Condition[]; evidence: EvidenceItem[]; confidence: number }

const lc = (v: unknown): string => String(v ?? '').toLowerCase();
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && !Number.isNaN(Number(v)) ? Number(v) : null));
/**
 * Normalize a canonical score to 0..1. The canonical view model carries MIXED score
 * scales (website/materialized = 0..1; legacy crm/canonical_leads `lead_score` = 0..100),
 * so intent-based rules must normalize before comparing. Values >1 are treated as 0..100.
 */
const normScore = (v: unknown): number | null => { const n = num(v); return n == null ? null : (n > 1 ? Math.min(1, n / 100) : Math.max(0, n)); };

/** Field accessors — the ONE place lead/operational fields map to comparable values. */
function fieldValue(ctx: EvalContext, field: string): unknown {
  const v = ctx.view;
  const m = (v.attribution.sourceMetadata ?? {}) as Record<string, unknown>;
  switch (field) {
    case 'source': return v.source;
    case 'status': return v.status;
    case 'campaign': return v.campaign ?? v.utm.campaign;
    case 'content':
    case 'interest': return v.content ?? m.primary_interest ?? m.intent;
    case 'intent': return normScore(v.scores.intent ?? v.scores.total ?? 0);
    case 'icp': return normScore(v.scores.icp);
    case 'total': return normScore(v.scores.total ?? v.scores.intent ?? 0);
    case 'confidence': return normScore(v.scores.confidence);
    case 'referrer': return v.referrer;
    case 'utm_source': return v.utm.source;
    case 'utm_medium': return v.utm.medium;
    case 'utm_campaign': return v.utm.campaign;
    case 'email': return v.identity.email;
    case 'phone': return v.identity.phone;
    case 'company': return m.company_name ?? null;
    case 'industry': return m.industry ?? null;
    case 'country': return m.country ?? null;
    case 'unified_person_id': return v.unifiedPersonId;
    case 'occurred_at': return v.occurredAt;
    case 'op_status': return ctx.operational?.status ?? null;
    case 'op_assignee': return ctx.operational?.assignee ?? null;
    case 'op_tags': return ctx.operational?.tags ?? [];
    default: return m[field] ?? null; // any custom captured property
  }
}

function evalCondition(ctx: EvalContext, c: Condition): { ok: boolean; actual: unknown } {
  const actual = fieldValue(ctx, c.field);
  const val = c.value;
  switch (c.operator) {
    case 'exists': return { ok: actual != null && actual !== '', actual };
    case 'not_exists': return { ok: actual == null || actual === '', actual };
    case 'eq': return { ok: lc(actual) === lc(val), actual };
    case 'neq': return { ok: lc(actual) !== lc(val), actual };
    case 'contains': return { ok: Array.isArray(actual) ? actual.map(lc).includes(lc(val)) : lc(actual).includes(lc(val)), actual };
    case 'not_contains': return { ok: !(Array.isArray(actual) ? actual.map(lc).includes(lc(val)) : lc(actual).includes(lc(val))), actual };
    case 'in': return { ok: Array.isArray(val) && val.map(lc).includes(lc(actual)), actual };
    case 'not_in': return { ok: !(Array.isArray(val) && val.map(lc).includes(lc(actual))), actual };
    case 'gt': { const a = num(actual), b = num(val); return { ok: a != null && b != null && a > b, actual }; }
    case 'gte': { const a = num(actual), b = num(val); return { ok: a != null && b != null && a >= b, actual }; }
    case 'lt': { const a = num(actual), b = num(val); return { ok: a != null && b != null && a < b, actual }; }
    case 'lte': { const a = num(actual), b = num(val); return { ok: a != null && b != null && a <= b, actual }; }
    default: return { ok: false, actual };
  }
}

interface GroupOutcome { matched: boolean; matchedRules: Condition[]; evidence: EvidenceItem[]; leaves: number; hits: number }

function evalGroup(ctx: EvalContext, group: RuleGroup): GroupOutcome {
  const conditions = group.conditions ?? [];
  const groups = group.groups ?? [];
  const matchedRules: Condition[] = [];
  const evidence: EvidenceItem[] = [];
  let leaves = 0, hits = 0;
  const results: boolean[] = [];

  for (const c of conditions) {
    leaves++;
    const { ok, actual } = evalCondition(ctx, c);
    results.push(ok);
    if (ok) { hits++; matchedRules.push(c); evidence.push({ field: c.field, operator: c.operator, expected: c.value, actual }); }
  }
  for (const g of groups) {
    const sub = evalGroup(ctx, g);
    results.push(sub.matched);
    leaves += sub.leaves; hits += sub.hits;
    matchedRules.push(...sub.matchedRules); evidence.push(...sub.evidence);
  }

  const matched = results.length === 0 ? true : (group.op === 'or' ? results.some(Boolean) : results.every(Boolean));
  return { matched, matchedRules, evidence, leaves, hits };
}

/** Evaluate an entity against an audience rule tree. Returns match + full explainability. */
export function evaluateRules(ctx: EvalContext, rules: RuleGroup | null | undefined): EvalResult {
  if (!rules || (!(rules.conditions?.length) && !(rules.groups?.length))) {
    return { matched: false, matchedRules: [], evidence: [], confidence: 0 };
  }
  const out = evalGroup(ctx, rules);
  // Confidence blends rule-coverage (hits/leaves) with the lead's own materialized
  // score confidence when present — explainable, deterministic, no new scorer.
  const coverage = out.leaves > 0 ? out.hits / out.leaves : (out.matched ? 1 : 0);
  const scoreConf = typeof ctx.view.scores.confidence === 'number' ? ctx.view.scores.confidence : coverage;
  const confidence = out.matched ? Math.max(0, Math.min(1, (coverage + scoreConf) / 2)) : 0;
  return { matched: out.matched, matchedRules: out.matchedRules, evidence: out.evidence, confidence: Number(confidence.toFixed(3)) };
}

/** True when the rule tree has at least one condition. */
export function isNonEmptyRules(rules: RuleGroup | null | undefined): boolean {
  return !!rules && ((rules.conditions?.length ?? 0) > 0 || (rules.groups?.length ?? 0) > 0);
}
