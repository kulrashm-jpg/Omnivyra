/**
 * LC-301 (W3) — Audience Intelligence service.
 *
 * An Audience is a first-class, continuously-evaluated, explainable rule set. This
 * service is REUSE-FIRST end to end:
 *   • members come from the ONE unified read surface (`searchLeads` → CanonicalLeadView)
 *   • rules are evaluated by the ONE segmentation engine (`evaluateRules`) — no new scorer
 *   • buying-intent/scores come already-materialized on the view (W1.2) — not recomputed
 *   • the audience's OWN operational layer (owner/status/notes/tasks/timeline) is the W2
 *     operational core with entity_type='audience' — no new operational implementation
 *   • persistence uses `ownedDbTable` (same seam + observability as the rest of the spine)
 *
 * Membership is materialized WITH explainability (matched rules + evidence + confidence +
 * evaluated_at + source). Evaluation is on-demand + incremental (upsert current matches,
 * deactivate stale) — no scheduled exports, no manual sync.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { searchLeads } from '../leadIntelligence/leadIntelligenceReadService';
import { leadKeyFor, type CanonicalLeadView } from '../../../lib/leadIntelligence';
import { evaluateRules, isNonEmptyRules, type RuleGroup, type EvalContext } from '../../../lib/audience/segmentation';

const A = 'audiences', M = 'audience_memberships';
const now = () => new Date().toISOString();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface AudienceInput { name: string; description?: string; kind?: 'dynamic' | 'static'; rules?: RuleGroup; metadata?: Record<string, unknown> }
export interface AudienceRow { id: string; company_id: string; name: string; description: string | null; kind: string; rules: RuleGroup; member_count: number; last_evaluated_at: string | null }

export class AudienceError extends Error { constructor(public code: string, public httpStatus: number) { super(code); this.name = 'AudienceError'; } }

/* ── CRUD ───────────────────────────────────────────────────────────────────── */

export async function createAudience(companyId: string, actorId: string | null, input: AudienceInput): Promise<{ id: string }> {
  if (!input.name?.trim()) throw new AudienceError('name_required', 400);
  const { data, error } = await ownedDbTable(A).insert({
    company_id: companyId, name: input.name.trim(), description: input.description ?? null,
    kind: input.kind ?? 'dynamic', rules: input.rules ?? {}, metadata: input.metadata ?? {}, created_by: actorId,
  }).select('id').maybeSingle();
  if (error || !data) throw new AudienceError('create_failed', 500);
  return { id: String((data as any).id) };
}

export async function updateAudience(companyId: string, audienceId: string, patch: Partial<AudienceInput>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: now() };
  if (patch.name != null) row.name = patch.name;
  if (patch.description != null) row.description = patch.description;
  if (patch.kind != null) row.kind = patch.kind;
  if (patch.rules != null) row.rules = patch.rules;
  if (patch.metadata != null) row.metadata = patch.metadata;
  const { error } = await ownedDbTable(A).update(row).eq('company_id', companyId).eq('id', audienceId).select('id').maybeSingle();
  if (error) throw new AudienceError('update_failed', 500);
}

export async function listAudiences(companyId: string): Promise<AudienceRow[]> {
  const { data } = await ownedDbTable(A).select('*').eq('company_id', companyId).is('deleted_at', null).order('created_at', { ascending: false }).limit(500);
  return Array.isArray(data) ? (data as AudienceRow[]) : [];
}

export async function getAudience(companyId: string, audienceId: string): Promise<AudienceRow | null> {
  const { data } = await ownedDbTable(A).select('*').eq('company_id', companyId).eq('id', audienceId).maybeSingle();
  return data ? (data as AudienceRow) : null;
}

export async function deleteAudience(companyId: string, audienceId: string): Promise<void> {
  await ownedDbTable(A).update({ deleted_at: now(), updated_at: now() }).eq('company_id', companyId).eq('id', audienceId);
}

/* ── Evaluation (dynamic, explainable) ──────────────────────────────────────── */

interface EvaluatedMember { entityId: string; view: CanonicalLeadView; matchedRules: unknown[]; evidence: unknown[]; confidence: number }

/** Load operational status/assignee for canonical leads once (company-scoped) → Map by entity_id. */
async function loadOperationalMap(companyId: string): Promise<Map<string, { status: string | null; assignee: string | null }>> {
  const map = new Map<string, { status: string | null; assignee: string | null }>();
  try {
    const [{ data: states }, { data: assigns }] = await Promise.all([
      ownedDbTable('operational_states').select('entity_id, status').eq('company_id', companyId).eq('entity_type', 'canonical_lead').limit(5000),
      ownedDbTable('operational_assignments').select('entity_id, assignee_id').eq('company_id', companyId).eq('entity_type', 'canonical_lead').eq('active', true).limit(5000),
    ]);
    for (const s of (states as any[]) ?? []) map.set(String(s.entity_id), { status: s.status ?? null, assignee: map.get(String(s.entity_id))?.assignee ?? null });
    for (const a of (assigns as any[]) ?? []) { const cur = map.get(String(a.entity_id)) ?? { status: null, assignee: null }; cur.assignee = a.assignee_id ?? null; map.set(String(a.entity_id), cur); }
  } catch { /* operational overlay optional for rules */ }
  return map;
}

/** Evaluate an audience's rules over the unified lead views. Pure of persistence. */
async function evaluateMembers(companyId: string, rules: RuleGroup): Promise<EvaluatedMember[]> {
  if (!isNonEmptyRules(rules)) return [];
  const [{ rows }, opMap] = await Promise.all([
    searchLeads({ companyId, page: { limit: 5000, offset: 0 } }),
    loadOperationalMap(companyId),
  ]);
  const out: EvaluatedMember[] = [];
  for (const view of rows) {
    const entityId = leadKeyFor(view);
    const ctx: EvalContext = { view, operational: opMap.get(entityId) };
    const r = evaluateRules(ctx, rules);
    if (r.matched) out.push({ entityId, view, matchedRules: r.matchedRules, evidence: r.evidence, confidence: r.confidence });
  }
  return out;
}

/** PREVIEW — evaluate without persisting (rule authoring). */
export async function previewAudience(companyId: string, rules: RuleGroup, limit = 50): Promise<{ total: number; sample: Array<{ entityId: string; confidence: number; matchedRules: unknown[]; label: string }>; intelligence: AudienceIntelligence }> {
  const members = await evaluateMembers(companyId, rules);
  return {
    total: members.length,
    sample: members.slice(0, limit).map((m) => ({ entityId: m.entityId, confidence: m.confidence, matchedRules: m.matchedRules, label: m.view.identity.email ?? m.view.sourceLabel })),
    intelligence: buildAudienceIntelligence(members),
  };
}

/** EVALUATE — materialize membership with explainability; incremental (deactivate stale). */
export async function evaluateAudience(companyId: string, audienceId: string): Promise<{ member_count: number; evaluated_at: string }> {
  const audience = await getAudience(companyId, audienceId);
  if (!audience) throw new AudienceError('not_found', 404);
  const runAt = now();
  const members = await evaluateMembers(companyId, audience.rules as RuleGroup);

  for (const m of members) {
    await ownedDbTable(M).upsert({
      audience_id: audienceId, company_id: companyId, entity_type: 'canonical_lead', entity_id: m.entityId,
      matched_rules: m.matchedRules, evidence: m.evidence, confidence: m.confidence,
      evaluation_source: 'rule_engine', evaluated_at: runAt, active: true,
    }, { onConflict: 'audience_id,entity_type,entity_id' }).select('id').maybeSingle();
  }
  // Deactivate members that no longer match (stale from a prior run).
  await ownedDbTable(M).update({ active: false }).eq('audience_id', audienceId).eq('active', true).lt('evaluated_at', runAt);
  await ownedDbTable(A).update({ member_count: members.length, last_evaluated_at: runAt, updated_at: runAt }).eq('company_id', companyId).eq('id', audienceId).select('id').maybeSingle();
  return { member_count: members.length, evaluated_at: runAt };
}

export async function listMembers(companyId: string, audienceId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
  const { data } = await ownedDbTable(M).select('*').eq('company_id', companyId).eq('audience_id', audienceId).eq('active', true).order('confidence', { ascending: false }).limit(limit);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/** EXPLAIN — why a specific entity belongs to an audience (stored explainability). */
export async function explainMembership(companyId: string, audienceId: string, entityId: string): Promise<Record<string, unknown> | null> {
  const { data } = await ownedDbTable(M).select('matched_rules, evidence, confidence, evaluation_source, evaluated_at, active')
    .eq('company_id', companyId).eq('audience_id', audienceId).eq('entity_id', entityId).maybeSingle();
  return data ? (data as Record<string, unknown>) : null;
}

/* ── Audience intelligence (aggregate existing intelligence; no new scorer) ──── */

export interface AudienceIntelligence { members: number; avgIntent: number; intentBands: { high: number; medium: number; low: number }; bySource: Record<string, number> }

function buildAudienceIntelligence(members: EvaluatedMember[]): AudienceIntelligence {
  const bands = { high: 0, medium: 0, low: 0 };
  const bySource: Record<string, number> = {};
  let intentSum = 0;
  const norm = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(v); return !Number.isFinite(n) ? 0 : (n > 1 ? Math.min(1, n / 100) : Math.max(0, n)); };
  for (const m of members) {
    const intent = norm(m.view.scores.intent ?? m.view.scores.total ?? 0);
    intentSum += intent;
    if (intent >= 0.7) bands.high++; else if (intent >= 0.4) bands.medium++; else bands.low++;
    bySource[m.view.source] = (bySource[m.view.source] ?? 0) + 1;
  }
  return { members: members.length, avgIntent: members.length ? Number((intentSum / members.length).toFixed(3)) : 0, intentBands: bands, bySource };
}

export async function getAudienceIntelligence(companyId: string, audienceId: string): Promise<AudienceIntelligence> {
  const audience = await getAudience(companyId, audienceId);
  if (!audience) throw new AudienceError('not_found', 404);
  const members = await evaluateMembers(companyId, audience.rules as RuleGroup);
  return buildAudienceIntelligence(members);
}
