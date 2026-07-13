/**
 * companyLifecycleService.ts — THE canonical company lifecycle (ONBOARD-001R §1).
 *
 * DERIVED, never persisted as a new model. The authority is a pure read over
 * the EXISTING stores — companies.status, company_profiles (enrichment),
 * company_domains (registry), user_company_roles (membership), and the
 * ONBOARD-001 journey authority (readiness/onboarding). The Platform Ready
 * decision is REUSED from buildOnboardingJourney (not recomputed).
 *
 * Lifecycle:
 *   DISCOVERED → CREATED → PROFILE_ENRICHING → PROFILE_READY
 *     → ONBOARDING_ACTIVE → PLATFORM_READY → ACTIVE
 *   failure states: SUSPENDED, ARCHIVED (from companies.status)
 *
 * Determinism: same inputs → same state. Resumable + retry-safe (pure read).
 * Illegal transitions are impossible via canTransition/assertTransition. The
 * derivation itself only ever REPORTS a state — it never writes one — so
 * backward compatibility is total (no column, no migration).
 */

import { supabase } from '../db/supabaseClient';
import { buildOnboardingJourney, type OnboardingJourney } from './onboardingJourneyService';

export type CompanyLifecycleState =
  | 'DISCOVERED'
  | 'CREATED'
  | 'PROFILE_ENRICHING'
  | 'PROFILE_READY'
  | 'ONBOARDING_ACTIVE'
  | 'PLATFORM_READY'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'ARCHIVED';

export const COMPANY_LIFECYCLE_ORDER: ReadonlyArray<CompanyLifecycleState> = [
  'DISCOVERED', 'CREATED', 'PROFILE_ENRICHING', 'PROFILE_READY',
  'ONBOARDING_ACTIVE', 'PLATFORM_READY', 'ACTIVE',
];

/** Legal transitions (self-transitions always legal — idempotent re-derivation). */
const TRANSITIONS: Readonly<Record<CompanyLifecycleState, ReadonlyArray<CompanyLifecycleState>>> = {
  DISCOVERED:        ['CREATED', 'ARCHIVED'],
  CREATED:           ['PROFILE_ENRICHING', 'PROFILE_READY', 'SUSPENDED', 'ARCHIVED'],
  PROFILE_ENRICHING: ['PROFILE_READY', 'ONBOARDING_ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  PROFILE_READY:     ['ONBOARDING_ACTIVE', 'PLATFORM_READY', 'SUSPENDED', 'ARCHIVED'],
  ONBOARDING_ACTIVE: ['PLATFORM_READY', 'PROFILE_READY', 'SUSPENDED', 'ARCHIVED'],
  PLATFORM_READY:    ['ACTIVE', 'ONBOARDING_ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  ACTIVE:            ['SUSPENDED', 'ARCHIVED', 'PLATFORM_READY'],
  SUSPENDED:         ['ACTIVE', 'ARCHIVED'],   // reactivation
  ARCHIVED:          [],                        // terminal
};

export function canTransition(from: CompanyLifecycleState, to: CompanyLifecycleState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: CompanyLifecycleState, to: CompanyLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`ILLEGAL_COMPANY_LIFECYCLE_TRANSITION:${from}->${to}`);
  }
}

export interface CompanyLifecycle {
  companyId: string;
  state: CompanyLifecycleState;
  /** The authority that decided the state (diagnostics). */
  authority: 'companies.status' | 'company_profiles' | 'onboarding_journey' | 'membership' | 'none';
  detail: string;
}

interface LifecycleInputs {
  status: string | null;
  profileExists: boolean;
  profileEnriched: boolean;     // last_refined_at set OR overall_confidence > 0
  hasActiveMembership: boolean;
  journey: OnboardingJourney | null;
}

/**
 * Pure state resolution from the collected signals. Exposed for testing —
 * deterministic, no I/O.
 */
export function resolveCompanyLifecycleState(inputs: LifecycleInputs): { state: CompanyLifecycleState; authority: CompanyLifecycle['authority']; detail: string } {
  // Failure states win (companies.status).
  const status = String(inputs.status ?? '').toLowerCase();
  if (status === 'archived') return { state: 'ARCHIVED', authority: 'companies.status', detail: 'Company is archived.' };
  if (status === 'suspended') return { state: 'SUSPENDED', authority: 'companies.status', detail: 'Company is suspended.' };

  if (!inputs.hasActiveMembership && !inputs.profileExists) {
    // Company row exists but no admin membership and no profile — freshly created shell.
    return { state: 'CREATED', authority: 'membership', detail: 'Company created; no active membership yet.' };
  }

  const journey = inputs.journey;
  if (journey?.platformReady) {
    // ACTIVE when platform-ready with at least one REAL integration/review
    // completed (operational); PLATFORM_READY when ready only via skips.
    const realCompletions = journey.stages.filter((s) => !s.mandatory && s.status === 'completed').length;
    return realCompletions > 0
      ? { state: 'ACTIVE', authority: 'onboarding_journey', detail: `Platform ready with ${realCompletions} integration(s) live.` }
      : { state: 'PLATFORM_READY', authority: 'onboarding_journey', detail: 'Platform ready (optional steps resolved without live integrations).' };
  }

  // Pre-ready progression.
  if (journey) {
    const optionalTouched = journey.stages.some(
      (s) => !s.mandatory && (s.status === 'completed' || s.status === 'skipped' || s.status === 'dismissed' || s.status === 'in_progress'),
    );
    if (optionalTouched) {
      return { state: 'ONBOARDING_ACTIVE', authority: 'onboarding_journey', detail: `Onboarding in progress (current: ${journey.currentStep}).` };
    }
  }

  if (inputs.profileEnriched) {
    return { state: 'PROFILE_READY', authority: 'company_profiles', detail: 'Profile enriched; onboarding not yet engaged.' };
  }
  if (inputs.profileExists) {
    return { state: 'PROFILE_ENRICHING', authority: 'company_profiles', detail: 'Profile created; enrichment in progress.' };
  }
  return { state: 'CREATED', authority: 'membership', detail: 'Company created.' };
}

async function findCompanyAdminUserId(companyId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('role', 'COMPANY_ADMIN')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { user_id?: string } | null)?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Derive the canonical lifecycle for a company. Reuses buildOnboardingJourney
 * for the Platform Ready decision (no duplicate readiness). Never throws;
 * returns null when the company does not exist.
 *
 * @param opts.journey pass a pre-built journey to avoid a second derivation.
 */
export async function deriveCompanyLifecycle(
  companyId: string,
  opts: { journey?: OnboardingJourney } = {},
): Promise<CompanyLifecycle | null> {
  if (!companyId) return null;
  try {
    const { data: company } = await supabase
      .from('companies')
      .select('id, status')
      .eq('id', companyId)
      .maybeSingle();
    if (!company) return null;

    const [{ data: profile }, adminUserId] = await Promise.all([
      supabase
        .from('company_profiles')
        .select('last_refined_at, overall_confidence')
        .eq('company_id', companyId)
        .maybeSingle(),
      findCompanyAdminUserId(companyId),
    ]);

    let journey = opts.journey ?? null;
    if (!journey && adminUserId) {
      journey = await buildOnboardingJourney(adminUserId);
    }

    const prof = profile as { last_refined_at?: string | null; overall_confidence?: number | null } | null;
    const resolved = resolveCompanyLifecycleState({
      status: (company as { status?: string | null }).status ?? null,
      profileExists: !!prof,
      profileEnriched: !!prof && (!!prof.last_refined_at || (prof.overall_confidence ?? 0) > 0),
      hasActiveMembership: !!adminUserId,
      journey,
    });

    return { companyId, ...resolved };
  } catch {
    return null;
  }
}
