/**
 * onboardingConversionService.ts
 *
 * READ-ONLY, deterministic onboarding-conversion intelligence: where prospects are lost
 * between signup start and successful onboarding. Evidence-backed only — no inference, no
 * AI, no writes, no recommendations.
 *
 * IMPORTANT (data reality, see 13F/13H): `signup_intents` and `companies` are TWO
 * unjoinable populations (`signup_intents.supabase_uid` is empty; `stage` is non-granular).
 * This engine therefore classifies two honest cohorts — the SIGNUP-INTENT cohort and the
 * COMPANY-ONBOARDING cohort — and never fabricates a cross-population conversion.
 */

import { supabase } from '../db/supabaseClient';

export type ProspectStatus = 'COMPLETED' | 'ABANDONED' | 'BLOCKED' | 'PENDING' | 'UNKNOWN';
export type LossReason =
  | 'CLAIMED_DOMAIN' | 'PUBLIC_EMAIL' | 'DOMAIN_BLOCKED' | 'NO_WEBSITE_FOUND' | 'DOMAIN_MISMATCH'
  | 'EMAIL_UNVERIFIED' | 'PROFILE_ABANDONED' | 'DOMAIN_UNVERIFIED' | 'ACTIVATION_ABANDONED' | 'UNKNOWN';
export type FunnelStage = 'VISITOR' | 'SIGNUP_STARTED' | 'EMAIL_VERIFIED' | 'IDENTITY_VALIDATED' | 'COMPANY_CREATED' | 'PROFILE_COMPLETED' | 'DOMAIN_VERIFIED' | 'ACTIVATED';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const STALE_DAYS = 14;

export interface ProspectIntent { id: string; email: string; domain: string; status: string; created_at: string | null; completed_at: string | null; expires_at: string | null; last_touch_at: string | null; }
export interface BlockSignal { reason: LossReason; source: string; at: string | null; }
export interface CompanyOnboarding { company_id: string; company_name: string; created_at: string | null; profile_completed: boolean; profile_at: string | null; domain_verified: boolean; domain_verified_at: string | null; }

export interface Classification { id: string; cohort: 'PROSPECT' | 'COMPANY'; label: ProspectStatus; reason: LossReason | null; evidence: string; confidence: Confidence; }

const domainOf = (email: string): string => (email.includes('@') ? email.split('@')[1] : email).trim().toLowerCase();
const olderThan = (iso: string | null, days: number, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 86_400_000 > days : false);

/** Map a negative eligibility reason / referral / event to a loss reason. */
export function blockReasonFor(reason: string): LossReason | null {
  if (/public_email|public_provider/i.test(reason)) return 'PUBLIC_EMAIL';
  if (/no_website|website_not_found/i.test(reason)) return 'NO_WEBSITE_FOUND';
  if (/not_canonical|mismatch/i.test(reason)) return 'DOMAIN_MISMATCH';
  if (/no_mx|blocked|forwarding|disposable/i.test(reason)) return 'DOMAIN_BLOCKED';
  return null;
}

/** Pure: classify one signup-intent prospect. */
export function classifyProspect(p: ProspectIntent, blocks: Map<string, BlockSignal>, nowMs: number): Classification {
  const base = { id: p.id, cohort: 'PROSPECT' as const };
  if (p.status === 'completed') return { ...base, label: 'COMPLETED', reason: null, evidence: 'signup_intents.status=completed', confidence: 'HIGH' };
  const block = blocks.get(p.domain);
  if (block) return { ...base, label: 'BLOCKED', reason: block.reason, evidence: `${block.source} (${p.domain})`, confidence: 'HIGH' };
  if (p.expires_at && olderThan(p.expires_at, 0, nowMs)) return { ...base, label: 'ABANDONED', reason: 'UNKNOWN', evidence: 'expired pending intent; stage not captured', confidence: 'MEDIUM' };
  if (olderThan(p.last_touch_at ?? p.created_at, STALE_DAYS, nowMs)) return { ...base, label: 'ABANDONED', reason: 'UNKNOWN', evidence: `no touch in > ${STALE_DAYS}d`, confidence: 'LOW' };
  return { ...base, label: 'PENDING', reason: null, evidence: 'pending signup_intent within window', confidence: 'MEDIUM' };
}

/** Pure: classify one company's post-creation onboarding progression. */
export function classifyCompanyOnboarding(c: CompanyOnboarding, activeIds: Set<string>, nowMs: number): Classification {
  const base = { id: c.company_id, cohort: 'COMPANY' as const };
  if (activeIds.has(c.company_id)) return { ...base, label: 'COMPLETED', reason: null, evidence: 'tenant_status=ACTIVE', confidence: 'HIGH' };
  const stale = olderThan(c.created_at, STALE_DAYS, nowMs);
  const status: ProspectStatus = stale ? 'ABANDONED' : 'PENDING';
  if (!c.profile_completed) return { ...base, label: status, reason: 'PROFILE_ABANDONED', evidence: 'no completed company_profile (confidence < 60 or absent)', confidence: 'HIGH' };
  if (!c.domain_verified) return { ...base, label: status, reason: 'DOMAIN_UNVERIFIED', evidence: 'no verified company_domains row', confidence: 'HIGH' };
  return { ...base, label: status, reason: 'ACTIVATION_ABANDONED', evidence: 'profile + domain done, tenant not ACTIVE', confidence: 'MEDIUM' };
}

export interface StageCount { stage: FunnelStage; count: number | null; measurable: boolean; source: string; confidence: Confidence; }

export function buildFunnel(i: { signup_started: number; company_created: number; profile_completed: number; domain_verified: number; activated: number }): StageCount[] {
  return [
    { stage: 'VISITOR', count: null, measurable: false, source: '(none)', confidence: 'UNKNOWN' },
    { stage: 'SIGNUP_STARTED', count: i.signup_started, measurable: true, source: 'signup_intents', confidence: 'MEDIUM' },
    { stage: 'EMAIL_VERIFIED', count: null, measurable: false, source: 'auth.users (not in public schema)', confidence: 'UNKNOWN' },
    { stage: 'IDENTITY_VALIDATED', count: null, measurable: false, source: 'validation verdict (not persisted)', confidence: 'UNKNOWN' },
    { stage: 'COMPANY_CREATED', count: i.company_created, measurable: true, source: 'companies', confidence: 'HIGH' },
    { stage: 'PROFILE_COMPLETED', count: i.profile_completed, measurable: true, source: 'company_profiles ≥ 60', confidence: 'HIGH' },
    { stage: 'DOMAIN_VERIFIED', count: i.domain_verified, measurable: true, source: 'company_domains verified', confidence: 'HIGH' },
    { stage: 'ACTIVATED', count: i.activated, measurable: true, source: 'tenant_status ACTIVE', confidence: 'HIGH' },
  ];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}
const daysBetween = (a: string | null, b: string | null): number | null => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 86_400_000) * 10) / 10 : null);

export interface OnboardingConversionResult {
  funnel: StageCount[];
  prospects: { total: number; by_status: Record<ProspectStatus, number>; classifications: Classification[] };
  companies: { total: number; by_status: Record<ProspectStatus, number>; classifications: Classification[] };
  portfolio: {
    total_started: number; total_completed: number; completion_rate: number | null;
    company_completion_rate: number | null;
    dropoff_by_stage: Array<{ from: FunnelStage; to: FunnelStage; lost: number | null; note?: string }>;
    dropoff_by_reason: Array<{ reason: LossReason; count: number }>;
    top_blockers: Array<{ reason: LossReason; count: number }>;
    median_time_between_stages: { signup_to_completed_days: number | null; created_to_profile_days: number | null; created_to_domain_verified_days: number | null };
    unknown_visibility_gaps: string[];
  };
}

const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: assemble the full conversion result from classified cohorts + raw timing inputs. */
export function buildOnboardingConversion(input: {
  prospects: ProspectIntent[];
  blocks: Map<string, BlockSignal>;
  companies: CompanyOnboarding[];
  activeIds: Set<string>;
  nowMs: number;
}): OnboardingConversionResult {
  const emptyStatus = (): Record<ProspectStatus, number> => ({ COMPLETED: 0, ABANDONED: 0, BLOCKED: 0, PENDING: 0, UNKNOWN: 0 });

  const pClass = input.prospects.map((p) => classifyProspect(p, input.blocks, input.nowMs));
  const cClass = input.companies.map((c) => classifyCompanyOnboarding(c, input.activeIds, input.nowMs));
  const pBy = emptyStatus(); for (const c of pClass) pBy[c.label] += 1;
  const cBy = emptyStatus(); for (const c of cClass) cBy[c.label] += 1;

  const company_created = input.companies.length;
  const profile_completed = input.companies.filter((c) => c.profile_completed).length;
  const domain_verified = input.companies.filter((c) => c.domain_verified).length;
  const activated = input.companies.filter((c) => input.activeIds.has(c.company_id)).length;
  const funnel = buildFunnel({ signup_started: input.prospects.length, company_created, profile_completed, domain_verified, activated });

  // Drop-off only within the company population (joinable); cross-boundary marked UNKNOWN.
  const dropoff_by_stage: OnboardingConversionResult['portfolio']['dropoff_by_stage'] = [
    { from: 'SIGNUP_STARTED', to: 'COMPANY_CREATED', lost: null, note: 'NOT COMPUTABLE — unjoinable populations' },
    { from: 'COMPANY_CREATED', to: 'PROFILE_COMPLETED', lost: company_created - profile_completed },
    { from: 'PROFILE_COMPLETED', to: 'DOMAIN_VERIFIED', lost: Math.max(0, profile_completed - domain_verified) },
    { from: 'DOMAIN_VERIFIED', to: 'ACTIVATED', lost: Math.max(0, domain_verified - activated) },
  ];

  const reasonCounts = new Map<LossReason, number>();
  for (const c of [...pClass, ...cClass]) if (c.reason && c.reason !== 'UNKNOWN') reasonCounts.set(c.reason, (reasonCounts.get(c.reason) ?? 0) + 1);
  const unknownReasonCount = [...pClass, ...cClass].filter((c) => c.reason === 'UNKNOWN').length;
  if (unknownReasonCount > 0) reasonCounts.set('UNKNOWN', unknownReasonCount);
  const dropoff_by_reason = Array.from(reasonCounts.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const completedIntents = input.prospects.filter((p) => p.status === 'completed');
  const median_time_between_stages = {
    signup_to_completed_days: median(completedIntents.map((p) => daysBetween(p.created_at, p.completed_at)).filter((n): n is number => n != null)),
    created_to_profile_days: median(input.companies.map((c) => daysBetween(c.created_at, c.profile_at)).filter((n): n is number => n != null)),
    created_to_domain_verified_days: median(input.companies.map((c) => daysBetween(c.created_at, c.domain_verified_at)).filter((n): n is number => n != null)),
  };

  return {
    funnel,
    prospects: { total: input.prospects.length, by_status: pBy, classifications: pClass },
    companies: { total: input.companies.length, by_status: cBy, classifications: cClass },
    portfolio: {
      total_started: input.prospects.length,
      total_completed: pBy.COMPLETED,
      completion_rate: rate(pBy.COMPLETED, input.prospects.length),
      company_completion_rate: rate(activated, company_created),
      dropoff_by_stage,
      dropoff_by_reason,
      top_blockers: dropoff_by_reason.filter((r) => r.reason !== 'UNKNOWN').slice(0, 5),
      median_time_between_stages,
      unknown_visibility_gaps: [
        'VISITOR (no analytics source)',
        'EMAIL_VERIFIED (auth.users not in public schema)',
        'IDENTITY_VALIDATED (verdict not persisted)',
        'signup_intent → company linkage (supabase_uid empty)',
        'pending-intent abandonment reason (stage column non-granular)',
      ],
    },
  };
}

// ── Read-only loader + orchestrator ──────────────────────────────────────────
const safe = async <T>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };
const PROFILE_COMPLETE_CONFIDENCE = 60;

export interface OnboardingLoaderInput { prospects: ProspectIntent[]; blocks: Map<string, BlockSignal>; companies: CompanyOnboarding[]; }

/** Read-only gather of both cohorts from existing sources. */
export async function loadOnboardingData(): Promise<OnboardingLoaderInput> {
  const intents = await safe(async () => ((await supabase.from('signup_intents').select('id, email, status, created_at, completed_at, expires_at, last_touch_at')).data ?? []) as any[], []);
  const prospects: ProspectIntent[] = intents.map((r) => ({ id: String(r.id), email: String(r.email ?? ''), domain: domainOf(String(r.email ?? '')), status: String(r.status ?? ''), created_at: r.created_at ?? null, completed_at: r.completed_at ?? null, expires_at: r.expires_at ?? null, last_touch_at: r.last_touch_at ?? null }));

  const blocks = new Map<string, BlockSignal>();
  const referrals = await safe(async () => ((await supabase.from('signup_referrals').select('domain, last_attempt_at')).data ?? []) as any[], []);
  for (const r of referrals) { const d = String(r.domain ?? '').toLowerCase(); if (d) blocks.set(d, { reason: 'CLAIMED_DOMAIN', source: 'signup_referrals', at: r.last_attempt_at ?? null }); }
  const elig = await safe(async () => ((await supabase.from('domain_eligibility_cache').select('domain, reason, checked_at')).data ?? []) as any[], []);
  for (const r of elig) { const d = String(r.domain ?? '').toLowerCase(); const reason = blockReasonFor(String(r.reason ?? '')); if (d && reason && !blocks.has(d)) blocks.set(d, { reason, source: `domain_eligibility_cache:${r.reason}`, at: r.checked_at ?? null }); }

  const companiesRows = await safe(async () => ((await supabase.from('companies').select('id, name, created_at')).data ?? []) as any[], []);
  const ids = companiesRows.map((c) => String(c.id));
  const profiles = await safe(async () => (ids.length ? ((await supabase.from('company_profiles').select('company_id, overall_confidence, last_refined_at, updated_at').in('company_id', ids)).data ?? []) : []) as any[], []);
  const profileBy = new Map(profiles.map((p) => [String(p.company_id), p]));
  const domains = await safe(async () => (ids.length ? ((await supabase.from('company_domains').select('company_id, verification_status, verified_at').in('company_id', ids)).data ?? []) : []) as any[], []);
  const domainBy = new Map<string, any>();
  for (const d of domains) if (/verified|admin_override/i.test(String(d.verification_status ?? ''))) domainBy.set(String(d.company_id), d);

  const companies: CompanyOnboarding[] = companiesRows.map((c) => {
    const prof = profileBy.get(String(c.id));
    const dom = domainBy.get(String(c.id));
    return {
      company_id: String(c.id), company_name: String(c.name ?? ''), created_at: c.created_at ?? null,
      profile_completed: !!prof && Number(prof.overall_confidence ?? 0) >= PROFILE_COMPLETE_CONFIDENCE,
      profile_at: prof?.last_refined_at ?? prof?.updated_at ?? null,
      domain_verified: !!dom, domain_verified_at: dom?.verified_at ?? null,
    };
  });

  return { prospects, blocks, companies };
}

/** Orchestrator. `ctx.activeCompanyIds` from readiness (tenant_status=ACTIVE). Read-only. */
export async function getOnboardingConversion(
  ctx: { activeCompanyIds: string[]; now?: () => number },
  deps: { load?: () => Promise<OnboardingLoaderInput> } = {},
): Promise<OnboardingConversionResult> {
  const data = await (deps.load ?? loadOnboardingData)();
  return buildOnboardingConversion({ ...data, activeIds: new Set(ctx.activeCompanyIds), nowMs: (ctx.now ?? (() => Date.now()))() });
}
