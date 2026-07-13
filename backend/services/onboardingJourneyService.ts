/**
 * onboardingJourneyService.ts — THE canonical onboarding authority (ONBOARD-001 §1).
 *
 * ONE orchestration layer over the EXISTING models — none of them is
 * replaced, and no parallel state is introduced beyond the per-stage
 * override store (company_setup_progress.journey_state, added by
 * 20260714_onboard001_journey_and_domains.sql):
 *
 *   composed authorities (read-only here unless noted):
 *     - AUTH-001R signup lifecycle    users.is_email_verified / onboarding_state
 *     - membership                    user_company_roles (status='active')
 *     - activation readiness          buildActivationReadiness (cms / analytics, latched)
 *     - integration status            social_accounts.connection_state (9-state model),
 *                                     analytics_integrations (GA4/GSC),
 *                                     company_integrations (CMS)
 *     - stage overrides               company_setup_progress.journey_state (written here)
 *
 * It produces ONE answer for: current step, per-stage status
 * (not_started | pending | in_progress | completed | skipped | dismissed |
 * blocked), and the single canonical Platform Ready decision (§11).
 *
 * Journey (ONBOARD-001 §5):
 *   Email Verified → Profile → Company → Company Review → Social Accounts
 *     → Website / CMS → Google Analytics → Google Search Console → Platform Ready
 *
 * Rules:
 *   - Real completion always wins: a skip/dismiss override can never
 *     downgrade a stage that the underlying authority says is completed.
 *   - Mandatory stages (email_verified, profile, company) cannot be skipped
 *     or dismissed. Platform Ready requires every mandatory stage completed
 *     AND every optional stage resolved (completed | skipped | dismissed).
 *   - Derivation is pure read → deterministic, retry/refresh/replay safe
 *     (journey recovery §12 is derivation, not session state).
 *   - Stage actions are idempotent (same action twice → same stored state).
 */

import { supabase } from '../db/supabaseClient';
import { buildActivationReadiness } from './activationReadinessService';
import type { ConnectionState } from './integrations/connectionState';
import { logger } from './logger';

// ── Model ─────────────────────────────────────────────────────────────────────

export type JourneyStageId =
  | 'email_verified'
  | 'profile'
  | 'company'
  | 'company_review'
  | 'social_accounts'
  | 'website_cms'
  | 'google_analytics'
  | 'google_search_console';

export type JourneyStageStatus =
  | 'not_started'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'dismissed'
  | 'blocked';

export type JourneyStageAction = 'complete' | 'skip' | 'dismiss' | 'reopen';

export interface JourneyStageDefinition {
  id: JourneyStageId;
  title: string;
  /** "Why it matters" copy (§5). */
  why: string;
  /** Mandatory stages gate Platform Ready and cannot be skipped/dismissed. */
  mandatory: boolean;
  skippable: boolean;
  dismissible: boolean;
  /** Stages that must be completed before this one is actionable. */
  dependsOn: JourneyStageId[];
  /** The EXISTING surface that fulfils this stage. */
  href: string;
}

export const JOURNEY_STAGES: ReadonlyArray<JourneyStageDefinition> = [
  {
    id: 'email_verified', title: 'Verify your email',
    why: 'Confirms you own this address — required before anything else can be set up.',
    mandatory: true, skippable: false, dismissible: false, dependsOn: [], href: '/login',
  },
  {
    id: 'profile', title: 'Complete your profile',
    why: 'Your name and role personalize the workspace and appear on team activity.',
    mandatory: true, skippable: false, dismissible: false, dependsOn: ['email_verified'], href: '/onboarding/profile',
  },
  {
    id: 'company', title: 'Set up your company',
    why: 'Creates your workspace, claims your domain, and grants your free credits.',
    mandatory: true, skippable: false, dismissible: false, dependsOn: ['profile'], href: '/onboarding/company',
  },
  {
    id: 'company_review', title: 'Review your company profile',
    why: 'We prefilled your profile from your website — reviewing it sharpens every AI output.',
    mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/company-profile?onboarding=company-profile',
  },
  {
    id: 'social_accounts', title: 'Connect social accounts',
    why: 'Publishing, campaigns, and engagement monitoring need at least one connected channel.',
    mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/social-platforms',
  },
  {
    id: 'website_cms', title: 'Connect your website / CMS',
    why: 'Lets Omnivyra publish blogs to your site and track visitor engagement.',
    mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/website-setup',
  },
  {
    id: 'google_analytics', title: 'Connect Google Analytics',
    why: 'Ties content performance to real traffic so reports show actual outcomes.',
    mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/integrations?focus=data',
  },
  {
    id: 'google_search_console', title: 'Connect Google Search Console',
    why: 'Surfaces the search queries you already rank for — fuel for content planning.',
    mandatory: false, skippable: true, dismissible: true, dependsOn: ['company'], href: '/integrations?focus=data',
  },
];

const STAGE_BY_ID = new Map(JOURNEY_STAGES.map((s) => [s.id, s]));

/** §8 — provider-level connection summary mapped from the 9-state model. */
export type ProviderJourneyState = 'connected' | 'pending' | 'expired' | 'reconnect_required' | 'failed';

export function providerJourneyState(state: ConnectionState | string | null | undefined): ProviderJourneyState {
  switch (state) {
    case 'CONNECTED':
    case 'LIVE_VERIFIED':            return 'connected';
    case 'TOKEN_EXPIRED':            return 'expired';
    case 'PROVIDER_REAUTH_REQUIRED': return 'reconnect_required';
    case 'DISCONNECTED':             return 'failed';
    case 'CONFIGURED':
    case 'TOKEN_REFRESH_REQUIRED':
    case 'RATE_LIMITED':
    case 'DEGRADED':
    default:                         return 'pending';
  }
}

export interface JourneyStageView {
  id: JourneyStageId;
  title: string;
  why: string;
  mandatory: boolean;
  skippable: boolean;
  dismissible: boolean;
  dependsOn: JourneyStageId[];
  href: string;
  status: JourneyStageStatus;
  /** Human-readable state detail (e.g. connected platforms, reconnect hints). */
  detail: string | null;
  /** Provider-level breakdown for integration stages (§8). */
  providers?: Array<{ platform: string; state: ProviderJourneyState }>;
  /** Set when status derives from a journey_state override. */
  overriddenAt?: string | null;
}

export interface OnboardingJourney {
  generatedAt: string;
  userId: string;
  companyId: string | null;
  stages: JourneyStageView[];
  /** First stage (flow order) not yet resolved — THE current step. */
  currentStep: JourneyStageId | 'platform_ready';
  /** §11 — the single canonical Platform Ready decision. */
  platformReady: boolean;
}

// ── journey_state overrides (company_setup_progress.journey_state) ───────────

type StageOverride = { status: 'skipped' | 'dismissed' | 'completed'; at: string; by: string | null };
type JourneyStateBlob = Partial<Record<JourneyStageId, StageOverride>>;

/** Run a query, returning `fallback` on any error (Supabase builders are thenables). */
async function safeQuery<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

async function readJourneyState(companyId: string): Promise<JourneyStateBlob> {
  try {
    const { data } = await supabase
      .from('company_setup_progress')
      .select('journey_state')
      .eq('company_id', companyId)
      .maybeSingle();
    const blob = (data as { journey_state?: unknown } | null)?.journey_state;
    return blob && typeof blob === 'object' ? (blob as JourneyStateBlob) : {};
  } catch {
    return {};
  }
}

// ── Stage-signal reads (compose the EXISTING authorities) ─────────────────────

interface JourneySignals {
  user: {
    emailVerified: boolean;
    hasName: boolean;
  };
  companyId: string | null;
  overrides: JourneyStateBlob;
  social: Array<{ platform: string; state: ProviderJourneyState }>;
  cms: { done: boolean; anyRow: boolean; anyFailed: boolean; detail: string };
  ga: { done: boolean; anyRow: boolean; detail: string };
  gsc: { done: boolean; anyRow: boolean; detail: string };
}

async function collectSignals(userId: string): Promise<JourneySignals> {
  const { data: userRow } = await supabase
    .from('users')
    .select('id, name, is_email_verified, active_company_id')
    .eq('id', userId)
    .maybeSingle();

  const u = (userRow ?? {}) as {
    name?: string | null; is_email_verified?: boolean; active_company_id?: string | null;
  };

  // Company: prefer active_company_id, fall back to first active membership.
  let companyId: string | null = u.active_company_id ?? null;
  if (!companyId) {
    const { data: role } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    companyId = (role as { company_id?: string } | null)?.company_id ?? null;
  }

  const base: JourneySignals = {
    user: {
      emailVerified: u.is_email_verified === true,
      hasName: !!String(u.name ?? '').trim(),
    },
    companyId,
    overrides: {},
    social: [],
    cms: { done: false, anyRow: false, anyFailed: false, detail: 'Not connected yet' },
    ga: { done: false, anyRow: false, detail: 'Not connected yet' },
    gsc: { done: false, anyRow: false, detail: 'Not connected yet' },
  };

  if (!companyId) return base;

  const [overrides, socialRows, analyticsRows, activation] = await Promise.all([
    readJourneyState(companyId),
    safeQuery<Array<{ platform: string; is_active: boolean; connection_state: string | null }>>(
      async () => {
        const r = await supabase.from('social_accounts').select('platform, is_active, connection_state').eq('company_id', companyId);
        return (r.data ?? []) as Array<{ platform: string; is_active: boolean; connection_state: string | null }>;
      },
      [],
    ),
    safeQuery<Array<{ provider: string; status: string | null; connection_state: string | null }>>(
      async () => {
        const r = await supabase.from('analytics_integrations').select('provider, status, connection_state').eq('company_id', companyId);
        return (r.data ?? []) as Array<{ provider: string; status: string | null; connection_state: string | null }>;
      },
      [],
    ),
    buildActivationReadiness(companyId).then((v) => v, () => null),
  ]);

  base.overrides = overrides;

  // §8 — social platforms via the canonical connection-state model.
  base.social = socialRows.map((row) => ({
    platform: row.platform,
    state: row.is_active === false
      ? 'failed'
      : providerJourneyState(row.connection_state ?? (row.is_active ? 'CONNECTED' : 'DISCONNECTED')),
  }));

  // §9 — CMS via activation readiness (latched, reuses listCmsProviders counts).
  const cmsCheck = activation?.checks.find((c) => c.id === 'cms');
  base.cms = {
    done: cmsCheck?.done === true,
    anyRow: false,
    anyFailed: false,
    detail: cmsCheck?.detail ?? 'Not connected yet',
  };

  // §10 — GA via activation readiness's analytics check + integration rows.
  const gaCheck = activation?.checks.find((c) => c.id === 'analytics');
  const gaRow = analyticsRows.find((r) => String(r.provider).toUpperCase() === 'GA4');
  base.ga = {
    done: gaCheck?.done === true || gaRow?.status === 'connected',
    anyRow: !!gaRow,
    detail: gaCheck?.detail ?? (gaRow ? `GA4 ${gaRow.status ?? 'configured'}` : 'Not connected yet'),
  };

  // §10 — GSC directly from analytics_integrations (provider='GSC').
  const gscRow = analyticsRows.find((r) => String(r.provider).toUpperCase() === 'GSC');
  base.gsc = {
    done: gscRow?.status === 'connected',
    anyRow: !!gscRow,
    detail: gscRow ? `Search Console ${gscRow.status ?? 'configured'}` : 'Not connected yet',
  };

  return base;
}

// ── Derivation ────────────────────────────────────────────────────────────────

const RESOLVED: ReadonlySet<JourneyStageStatus> = new Set(['completed', 'skipped', 'dismissed']);

function applyOverride(
  derived: JourneyStageStatus,
  override: StageOverride | undefined,
): { status: JourneyStageStatus; overriddenAt: string | null } {
  // Real completion always wins; overrides only lift non-completed stages.
  if (derived === 'completed' || !override) return { status: derived, overriddenAt: null };
  return { status: override.status, overriddenAt: override.at };
}

/**
 * Build the canonical journey for a user. Pure read — deterministic and
 * safe to call on every request (journey recovery §12).
 */
export async function buildOnboardingJourney(userId: string): Promise<OnboardingJourney> {
  const signals = await collectSignals(userId);
  const statuses = new Map<JourneyStageId, JourneyStageView>();

  const derive = (def: JourneyStageDefinition): JourneyStageView => {
    // Dependency gate: any unmet dependency → blocked.
    const depsMet = def.dependsOn.every((dep) => {
      const depView = statuses.get(dep);
      return depView ? RESOLVED.has(depView.status) : false;
    });

    let derived: JourneyStageStatus = 'pending';
    let detail: string | null = null;
    let providers: JourneyStageView['providers'];

    switch (def.id) {
      case 'email_verified':
        derived = signals.user.emailVerified ? 'completed' : 'pending';
        break;
      case 'profile':
        derived = signals.user.hasName ? 'completed' : 'pending';
        break;
      case 'company':
        derived = signals.companyId ? 'completed' : 'pending';
        break;
      case 'company_review':
        derived = 'pending';
        detail = 'We prefilled this from your website — confirm or adjust it.';
        break;
      case 'social_accounts': {
        providers = signals.social;
        const connected = signals.social.filter((s) => s.state === 'connected');
        const needsAttention = signals.social.filter(
          (s) => s.state === 'expired' || s.state === 'reconnect_required',
        );
        if (connected.length > 0) {
          derived = 'completed';
          detail = `${connected.map((s) => s.platform).join(', ')} connected${
            needsAttention.length ? ` — ${needsAttention.map((s) => `${s.platform} needs reconnect`).join(', ')}` : ''
          }`;
        } else if (signals.social.length > 0) {
          derived = 'in_progress';
          detail = signals.social.map((s) => `${s.platform}: ${s.state.replace('_', ' ')}`).join(', ');
        } else {
          derived = 'pending';
          detail = 'No channels connected yet';
        }
        break;
      }
      case 'website_cms':
        derived = signals.cms.done ? 'completed' : 'pending';
        detail = signals.cms.detail;
        break;
      case 'google_analytics':
        derived = signals.ga.done ? 'completed' : signals.ga.anyRow ? 'in_progress' : 'pending';
        detail = signals.ga.detail;
        break;
      case 'google_search_console':
        derived = signals.gsc.done ? 'completed' : signals.gsc.anyRow ? 'in_progress' : 'pending';
        detail = signals.gsc.detail;
        break;
    }

    const { status: withOverride, overriddenAt } = applyOverride(derived, signals.overrides[def.id]);
    // Blocked evaluation happens AFTER overrides: a stage whose dependencies
    // are unmet and that isn't resolved is blocked, never actionable.
    const status: JourneyStageStatus =
      !depsMet && !RESOLVED.has(withOverride) ? 'blocked' : withOverride;

    return { ...def, status, detail, providers, overriddenAt };
  };

  for (const def of JOURNEY_STAGES) {
    statuses.set(def.id, derive(def));
  }

  const stages = JOURNEY_STAGES.map((def) => statuses.get(def.id)!);

  const mandatoryComplete = stages
    .filter((s) => s.mandatory)
    .every((s) => s.status === 'completed');
  const optionalResolved = stages
    .filter((s) => !s.mandatory)
    .every((s) => RESOLVED.has(s.status));

  // §11 — THE Platform Ready decision.
  const platformReady = mandatoryComplete && optionalResolved;

  const firstUnresolved = stages.find((s) => !RESOLVED.has(s.status));

  return {
    generatedAt: new Date().toISOString(),
    userId,
    companyId: signals.companyId,
    stages,
    currentStep: firstUnresolved ? firstUnresolved.id : 'platform_ready',
    platformReady,
  };
}

// ── Stage actions (§5 skippable / dismissible; §6 canonical writes) ──────────

export interface JourneyActionResult {
  ok: boolean;
  error?: string;
  code?: 'UNKNOWN_STAGE' | 'ACTION_NOT_ALLOWED' | 'NO_COMPANY' | 'WRITE_FAILED';
}

/**
 * Apply a user action to a stage override. Idempotent: repeating an action
 * converges on the same stored state. `reopen` clears the override so the
 * stage returns to its derived status.
 */
export async function applyJourneyStageAction(input: {
  companyId: string;
  userId: string;
  stage: string;
  action: JourneyStageAction;
}): Promise<JourneyActionResult> {
  const def = STAGE_BY_ID.get(input.stage as JourneyStageId);
  if (!def) return { ok: false, code: 'UNKNOWN_STAGE', error: `Unknown journey stage: ${input.stage}` };
  if (!input.companyId) return { ok: false, code: 'NO_COMPANY', error: 'Company required before journey actions.' };

  if (input.action === 'skip' && !def.skippable) {
    return { ok: false, code: 'ACTION_NOT_ALLOWED', error: `${def.id} is mandatory and cannot be skipped.` };
  }
  if (input.action === 'dismiss' && !def.dismissible) {
    return { ok: false, code: 'ACTION_NOT_ALLOWED', error: `${def.id} cannot be dismissed.` };
  }
  if (input.action === 'complete' && def.mandatory) {
    // Mandatory stages complete only through their real flows.
    return { ok: false, code: 'ACTION_NOT_ALLOWED', error: `${def.id} completes automatically via its own flow.` };
  }

  const current = await readJourneyState(input.companyId);
  const next: JourneyStateBlob = { ...current };
  if (input.action === 'reopen') {
    delete next[def.id];
  } else {
    const status = input.action === 'skip' ? 'skipped' : input.action === 'dismiss' ? 'dismissed' : 'completed';
    next[def.id] = { status, at: new Date().toISOString(), by: input.userId };
  }

  const { error } = await supabase
    .from('company_setup_progress')
    .upsert(
      { company_id: input.companyId, journey_state: next, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' },
    );

  if (error) {
    logger.warn('onboarding_journey_action_write_failed', {
      companyId: input.companyId, stage: def.id, action: input.action, message: error.message,
    });
    return { ok: false, code: 'WRITE_FAILED', error: 'Could not save your preference. Please try again.' };
  }
  return { ok: true };
}
