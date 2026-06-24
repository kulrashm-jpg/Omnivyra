/**
 * profileCompletionIntelligenceService.ts
 *
 * READ-ONLY, deterministic intelligence on why companies stall between COMPANY_CREATED and
 * PROFILE_COMPLETED. Evidence-only, no inference, no causality, no writes/recommendations.
 *
 * Profile stages are not strictly sequential (field-completeness and confidence are
 * independent), so the funnel reports INDEPENDENT stage-reach and PROFILE_READY = the
 * combined bar (all core fields AND confidence ≥ 60). Associations are reported, not causal.
 */

import { supabase } from '../db/supabaseClient';

export type ProfileStatus = 'PROFILE_READY' | 'PROFILE_IN_PROGRESS' | 'PROFILE_ABANDONED' | 'PROFILE_BLOCKED' | 'PROFILE_UNKNOWN';
export type ProfileFailure =
  | 'NO_PROFILE_ROW' | 'MISSING_NAME' | 'MISSING_WEBSITE' | 'MISSING_INDUSTRY' | 'LOW_CONFIDENCE'
  | 'IDENTITY_UNVERIFIED' | 'DOMAIN_UNVERIFIED' | 'MULTIPLE_PROFILE_GAPS' | 'UNKNOWN';
export type ProfileStage = 'COMPANY_CREATED' | 'PROFILE_STARTED' | 'PROFILE_PARTIAL' | 'PROFILE_COMPLETE' | 'PROFILE_CONFIDENT' | 'PROFILE_READY';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const CONFIDENCE_THRESHOLD = 60;
const STALE_DAYS = 14;

export interface ProfileCompany {
  company_id: string; company_name: string; created_at: string | null; is_active: boolean;
  profile_exists: boolean; has_name: boolean; has_website: boolean; has_industry: boolean;
  confidence: number; domain_verified: boolean; identity_verified: boolean;
}

const olderThan = (iso: string | null, days: number, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 86_400_000 > days : false);

export const isComplete = (c: ProfileCompany) => c.profile_exists && c.has_name && c.has_website && c.has_industry;
export const isConfident = (c: ProfileCompany) => c.confidence >= CONFIDENCE_THRESHOLD;
export const isReady = (c: ProfileCompany) => isComplete(c) && isConfident(c);

/** All profile gaps for a company (ordered: row → fields → confidence → domain → identity). */
export function profileGaps(c: ProfileCompany): ProfileFailure[] {
  const g: ProfileFailure[] = [];
  if (!c.profile_exists) { g.push('NO_PROFILE_ROW'); }
  else {
    if (!c.has_name) g.push('MISSING_NAME');
    if (!c.has_website) g.push('MISSING_WEBSITE');
    if (!c.has_industry) g.push('MISSING_INDUSTRY');
  }
  if (!isConfident(c)) g.push('LOW_CONFIDENCE');
  if (!c.domain_verified) g.push('DOMAIN_UNVERIFIED');
  if (!c.identity_verified) g.push('IDENTITY_UNVERIFIED');
  return g;
}

export interface ProfileClassification {
  company_id: string; company_name: string;
  status: ProfileStatus; reason: ProfileFailure | null; all_gaps: ProfileFailure[];
  evidence: string; confidence: Confidence;
}

/** Pure: classify one company's profile-completion state. */
export function classifyProfile(c: ProfileCompany, nowMs: number): ProfileClassification {
  const base = { company_id: c.company_id, company_name: c.company_name };
  if (isReady(c)) return { ...base, status: 'PROFILE_READY', reason: null, all_gaps: [], evidence: `complete fields + confidence ${c.confidence}`, confidence: 'HIGH' };

  const all_gaps = profileGaps(c);
  // Field/row/confidence gaps drive the primary reason ahead of context (domain/identity).
  const coreGaps = all_gaps.filter((g) => g !== 'DOMAIN_UNVERIFIED' && g !== 'IDENTITY_UNVERIFIED');
  const reason: ProfileFailure = !c.profile_exists ? 'NO_PROFILE_ROW' : coreGaps.length >= 2 ? 'MULTIPLE_PROFILE_GAPS' : (coreGaps[0] ?? all_gaps[0] ?? 'UNKNOWN');
  const stale = olderThan(c.created_at, STALE_DAYS, nowMs);
  const status: ProfileStatus = !c.profile_exists ? (stale ? 'PROFILE_ABANDONED' : 'PROFILE_BLOCKED') : (stale ? 'PROFILE_ABANDONED' : 'PROFILE_IN_PROGRESS');
  return { ...base, status, reason, all_gaps, evidence: `gaps: ${all_gaps.join(', ')}; confidence ${c.confidence}`, confidence: 'HIGH' };
}

export interface StageReach { stage: ProfileStage; reached: number; lost: number; loss_pct: number | null; }
export interface GapStat { failure: ProfileFailure; count: number; pct: number | null; affected: string[]; }
export interface ProfileAssociation { pair: string; population: number; positive: number; rate: number | null; confidence: Confidence; }

export interface ProfileCompletionResult {
  total: number;
  funnel: StageReach[];
  completion_rate: number | null;   // PROFILE_READY / total
  confident_rate: number | null;    // PROFILE_CONFIDENT / total
  by_status: Record<ProfileStatus, number>;
  gap_analysis: GapStat[];
  top_blockers: GapStat[];
  associations: ProfileAssociation[];
  classifications: ProfileClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const lowConfNote = (n: number): Confidence => (n >= 10 ? 'HIGH' : n >= 4 ? 'MEDIUM' : 'LOW');

/** Pure: full profile-completion analysis over the company population. */
export function analyzeProfileCompletion(companies: ProfileCompany[], nowMs: number): ProfileCompletionResult {
  const total = companies.length;
  const reach = (pred: (c: ProfileCompany) => boolean) => companies.filter(pred).length;

  const started = reach((c) => c.profile_exists);
  const partial = reach((c) => c.profile_exists && (c.has_name || c.has_website || c.has_industry));
  const complete = reach(isComplete);
  const confident = reach(isConfident);
  const ready = reach(isReady);
  const funnel: StageReach[] = [
    { stage: 'COMPANY_CREATED', reached: total, lost: 0, loss_pct: 0 },
    { stage: 'PROFILE_STARTED', reached: started, lost: total - started, loss_pct: pct(total - started, total) },
    { stage: 'PROFILE_PARTIAL', reached: partial, lost: total - partial, loss_pct: pct(total - partial, total) },
    { stage: 'PROFILE_COMPLETE', reached: complete, lost: total - complete, loss_pct: pct(total - complete, total) },
    { stage: 'PROFILE_CONFIDENT', reached: confident, lost: total - confident, loss_pct: pct(total - confident, total) },
    { stage: 'PROFILE_READY', reached: ready, lost: total - ready, loss_pct: pct(total - ready, total) },
  ];

  const classifications = companies.map((c) => classifyProfile(c, nowMs));
  const by_status: Record<ProfileStatus, number> = { PROFILE_READY: 0, PROFILE_IN_PROGRESS: 0, PROFILE_ABANDONED: 0, PROFILE_BLOCKED: 0, PROFILE_UNKNOWN: 0 };
  for (const c of classifications) by_status[c.status] += 1;

  const FAILURES: ProfileFailure[] = ['NO_PROFILE_ROW', 'MISSING_NAME', 'MISSING_WEBSITE', 'MISSING_INDUSTRY', 'LOW_CONFIDENCE', 'DOMAIN_UNVERIFIED', 'IDENTITY_UNVERIFIED'];
  const gap_analysis: GapStat[] = FAILURES.map((failure) => {
    const affected = companies.filter((c) => profileGaps(c).includes(failure)).map((c) => c.company_id);
    return { failure, count: affected.length, pct: pct(affected.length, total), affected: affected.slice(0, 25) };
  }).sort((a, b) => b.count - a.count || a.failure.localeCompare(b.failure));

  const assoc = (pair: string, popPred: (c: ProfileCompany) => boolean, posPred: (c: ProfileCompany) => boolean): ProfileAssociation => {
    const pop = companies.filter(popPred);
    const positive = pop.filter(posPred).length;
    return { pair, population: pop.length, positive, rate: pct(positive, pop.length), confidence: lowConfNote(pop.length) };
  };
  const associations: ProfileAssociation[] = [
    assoc('PROFILE_READY ↔ ACTIVATED', isReady, (c) => c.is_active),
    assoc('PROFILE_CONFIDENT ↔ ACTIVATED', isConfident, (c) => c.is_active),
    assoc('DOMAIN_VERIFIED ↔ PROFILE_READY', (c) => c.domain_verified, isReady),
    assoc('IDENTITY_VERIFIED ↔ PROFILE_READY', (c) => c.identity_verified, isReady),
  ];

  return {
    total, funnel,
    completion_rate: pct(ready, total), confident_rate: pct(confident, total),
    by_status, gap_analysis,
    top_blockers: gap_analysis.filter((g) => g.count > 0).slice(0, 5),
    associations, classifications,
    unknown_gaps: [
      'profile version/refinement history (company_profile_versions / _refinement tables absent)',
      'company_context / company_context_snapshots (absent / empty) — no enrichment lineage',
      'confidence scoring cadence (26/29 profiles at confidence 0 — unscored, not necessarily incomplete)',
    ],
  };
}

// ── Read-only loader + orchestrator ──────────────────────────────────────────
const safe = async <T>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export async function loadProfileCompanies(activeCompanyIds: string[]): Promise<ProfileCompany[]> {
  const companies = await safe(async () => ((await supabase.from('companies').select('id, name, created_at, website_domain')).data ?? []) as any[], []);
  const ids = companies.map((c) => String(c.id));
  const profiles = await safe(async () => (ids.length ? ((await supabase.from('company_profiles').select('company_id, name, industry, website_url, overall_confidence').in('company_id', ids)).data ?? []) : []) as any[], []);
  const profileBy = new Map(profiles.map((p) => [String(p.company_id), p]));
  const domains = await safe(async () => (ids.length ? ((await supabase.from('company_domains').select('company_id, verification_status').in('company_id', ids)).data ?? []) : []) as any[], []);
  const verified = new Set(domains.filter((d) => /verified|admin_override/i.test(String(d.verification_status ?? ''))).map((d) => String(d.company_id)));
  const active = new Set(activeCompanyIds);

  return companies.map((c) => {
    const p = profileBy.get(String(c.id));
    return {
      company_id: String(c.id), company_name: String(c.name ?? ''), created_at: c.created_at ?? null, is_active: active.has(String(c.id)),
      profile_exists: !!p, has_name: !!p && nonEmpty(p.name), has_website: !!p && nonEmpty(p.website_url), has_industry: !!p && nonEmpty(p.industry),
      confidence: Number(p?.overall_confidence ?? 0), domain_verified: verified.has(String(c.id)), identity_verified: nonEmpty(c.website_domain),
    };
  });
}

export async function getProfileCompletion(
  ctx: { activeCompanyIds: string[]; now?: () => number },
  deps: { load?: (ids: string[]) => Promise<ProfileCompany[]> } = {},
): Promise<ProfileCompletionResult> {
  const companies = await (deps.load ?? loadProfileCompanies)(ctx.activeCompanyIds);
  return analyzeProfileCompletion(companies, (ctx.now ?? (() => Date.now()))());
}
