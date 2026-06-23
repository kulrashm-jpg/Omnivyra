/**
 * customerAcquisitionIntelligenceService.ts
 *
 * READ-ONLY, deterministic visibility into the signup → active-customer funnel and where
 * acquisition is lost. Evidence-backed only — no inference, no AI, no narrative. Stages
 * with no persisted source are reported UNKNOWN (null), never guessed. No mutations,
 * notifications, recommendations, automation, or customer-facing effects.
 */

import { supabase } from '../db/supabaseClient';

export type FunnelStage = 'VISITOR' | 'SIGNUP_STARTED' | 'EMAIL_VERIFIED' | 'IDENTITY_VALIDATED' | 'COMPANY_CREATED' | 'PROFILE_COMPLETED' | 'ACTIVE_CUSTOMER';
export type LossReason =
  | 'CLAIMED_DOMAIN' | 'PUBLIC_EMAIL' | 'NO_WEBSITE_FOUND' | 'DOMAIN_MISMATCH' | 'DOMAIN_BLOCKED'
  | 'EMAIL_UNVERIFIED' | 'PROFILE_ABANDONED' | 'COMPANY_SETUP_ABANDONED' | 'UNKNOWN';

const PROFILE_COMPLETE_CONFIDENCE = 60; // mirrors readiness COMPANY_PROFILE threshold (12C)

export interface AcquisitionInputs {
  signup_intents_total: number;
  signup_intents_completed: number;
  companies_total: number;
  profiles_total: number;
  profiles_completed: number; // overall_confidence >= 60
  active_total: number;
  claimed_domain: { count: number; last: string | null; domains: string[] };
  eligibility_failures: Record<string, number>; // negative reason -> count
  domain_event_types: Record<string, number>;
}

export interface StageCount { stage: FunnelStage; count: number | null; source: string; measurable: boolean; coverage: string; }
export interface Conversion { label: string; numerator: number; denominator: number; rate: number | null; note?: string; }
export interface LossEntry { reason: LossReason; count: number; evidence: string; }

export interface AcquisitionResult {
  funnel: StageCount[];
  conversions: Conversion[];
  loss_reasons: LossEntry[];
  total_losses: number;
  portfolio: {
    most_common_blockers: LossEntry[];
    signup_to_company: Conversion;   // signup-intent cohort
    company_to_active: Conversion;
  };
}

const rate = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Pure, deterministic funnel + classification from raw counts. */
export function buildAcquisitionIntelligence(i: AcquisitionInputs): AcquisitionResult {
  const funnel: StageCount[] = [
    { stage: 'VISITOR', count: null, source: '(none)', measurable: false, coverage: 'no analytics source' },
    { stage: 'SIGNUP_STARTED', count: i.signup_intents_total, source: 'signup_intents', measurable: true, coverage: 'partial — invite/other paths bypass signup_intents' },
    { stage: 'EMAIL_VERIFIED', count: null, source: 'auth.users (not in public schema)', measurable: false, coverage: 'not persisted distinctly' },
    { stage: 'IDENTITY_VALIDATED', count: null, source: 'validation verdict (not persisted)', measurable: false, coverage: 'only failures cached in domain_eligibility_cache' },
    { stage: 'COMPANY_CREATED', count: i.companies_total, source: 'companies', measurable: true, coverage: 'all companies (multi-path)' },
    { stage: 'PROFILE_COMPLETED', count: i.profiles_completed, source: `company_profiles (overall_confidence >= ${PROFILE_COMPLETE_CONFIDENCE})`, measurable: true, coverage: 'company-scoped' },
    { stage: 'ACTIVE_CUSTOMER', count: i.active_total, source: 'readiness tenant_status = ACTIVE', measurable: true, coverage: 'company-scoped' },
  ];

  // Conversions only between population-compatible stages.
  const conversions: Conversion[] = [
    { label: 'signup_intent completion (started → completed)', numerator: i.signup_intents_completed, denominator: i.signup_intents_total, rate: rate(i.signup_intents_completed, i.signup_intents_total), note: 'signup-intent cohort only' },
    { label: 'company → profile completed', numerator: i.profiles_completed, denominator: i.companies_total, rate: rate(i.profiles_completed, i.companies_total) },
    { label: 'company → active', numerator: i.active_total, denominator: i.companies_total, rate: rate(i.active_total, i.companies_total) },
    { label: 'signup_started → company_created', numerator: i.companies_total, denominator: i.signup_intents_total, rate: null, note: 'NOT COMPUTABLE — different coverage windows (companies exceed tracked intents)' },
  ];

  const elig = (k: RegExp) => Object.entries(i.eligibility_failures).filter(([r]) => k.test(r)).reduce((a, [, n]) => a + n, 0);
  const ev = (k: RegExp) => Object.entries(i.domain_event_types).filter(([t]) => k.test(t)).reduce((a, [, n]) => a + n, 0);
  const pendingIntents = Math.max(0, i.signup_intents_total - i.signup_intents_completed);
  const profileAbandoned = Math.max(0, i.companies_total - i.profiles_total);

  const raw: Array<{ reason: LossReason; count: number; evidence: string }> = [
    { reason: 'CLAIMED_DOMAIN', count: i.claimed_domain.count, evidence: `signup_referrals${i.claimed_domain.domains.length ? `: ${i.claimed_domain.domains.slice(0, 5).join(', ')}` : ''}` },
    { reason: 'PUBLIC_EMAIL', count: elig(/public_email|public_provider/i), evidence: 'domain_eligibility_cache reason' },
    { reason: 'NO_WEBSITE_FOUND', count: elig(/no_website|website_not_found/i), evidence: 'domain_eligibility_cache reason' },
    { reason: 'DOMAIN_MISMATCH', count: ev(/not_canonical|mismatch/i), evidence: 'domain_events' },
    { reason: 'DOMAIN_BLOCKED', count: elig(/no_mx|blocked|forwarding|disposable/i) + ev(/blocked|forwarding/i), evidence: 'domain_eligibility_cache (no_mx/blocked) + domain_events' },
    { reason: 'EMAIL_UNVERIFIED', count: 0, evidence: 'no persisted source (auth-layer)' },
    { reason: 'PROFILE_ABANDONED', count: profileAbandoned, evidence: 'company created with no company_profiles row' },
    { reason: 'COMPANY_SETUP_ABANDONED', count: 0, evidence: 'no measurable source (intents not linked to companies)' },
    { reason: 'UNKNOWN', count: pendingIntents, evidence: 'pending signup_intents — abandonment stage not captured (stage column not granular)' },
  ];
  const loss_reasons = raw.map((r) => ({ reason: r.reason, count: r.count, evidence: r.evidence }));
  const total_losses = loss_reasons.reduce((a, r) => a + r.count, 0);

  return {
    funnel, conversions, loss_reasons, total_losses,
    portfolio: {
      most_common_blockers: [...loss_reasons].filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      signup_to_company: conversions[0],
      company_to_active: conversions[2],
    },
  };
}

const safe = async <T>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };
const countOf = async (table: string, filter?: (q: any) => any): Promise<number> => safe(async () => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  return (await q).count ?? 0;
}, 0);

/** Load acquisition inputs from existing sources. Read-only. `ctx` carries derived counts. */
export async function loadAcquisitionInputs(ctx: { companies_total: number; active_total: number }): Promise<AcquisitionInputs> {
  const signup_intents_total = await countOf('signup_intents');
  const signup_intents_completed = await countOf('signup_intents', (q) => q.eq('status', 'completed'));
  const profiles_total = await countOf('company_profiles');
  const profiles_completed = await countOf('company_profiles', (q) => q.gte('overall_confidence', PROFILE_COMPLETE_CONFIDENCE));

  const referrals = await safe(async () => ((await supabase.from('signup_referrals').select('domain, last_attempt_at')).data ?? []) as any[], []);
  const claimed_domain = {
    count: referrals.length,
    last: referrals.reduce<string | null>((m, r) => (!m || (r.last_attempt_at && r.last_attempt_at > m) ? r.last_attempt_at ?? m : m), null),
    domains: Array.from(new Set(referrals.map((r) => String(r.domain ?? '').toLowerCase()).filter(Boolean))),
  };

  const eligRows = await safe(async () => ((await supabase.from('domain_eligibility_cache').select('reason')).data ?? []) as any[], []);
  const eligibility_failures: Record<string, number> = {};
  for (const r of eligRows) { const reason = String(r.reason ?? ''); if (!/valid_company|eligible/i.test(reason)) eligibility_failures[reason] = (eligibility_failures[reason] ?? 0) + 1; }

  const evRows = await safe(async () => ((await supabase.from('domain_events').select('event_type')).data ?? []) as any[], []);
  const domain_event_types: Record<string, number> = {};
  for (const r of evRows) { const t = String(r.event_type ?? ''); domain_event_types[t] = (domain_event_types[t] ?? 0) + 1; }

  return {
    signup_intents_total, signup_intents_completed,
    companies_total: ctx.companies_total, profiles_total, profiles_completed, active_total: ctx.active_total,
    claimed_domain, eligibility_failures, domain_event_types,
  };
}

export async function getCustomerAcquisitionIntelligence(
  ctx: { companies_total: number; active_total: number },
  deps: { load?: (ctx: { companies_total: number; active_total: number }) => Promise<AcquisitionInputs> } = {},
): Promise<AcquisitionResult> {
  const inputs = await (deps.load ?? loadAcquisitionInputs)(ctx);
  return buildAcquisitionIntelligence(inputs);
}
