/**
 * customerActivationWorkbenchService.ts
 *
 * OPERATIONAL TOOLING (Phase 17) — not an intelligence/scoring/audit layer. It mechanically
 * maps each CUSTOMER company's raw milestone state to one of COMPLETE / READY_NOW / BLOCKED,
 * emits executable Action Cards for outstanding milestones, computes a plain
 * completed/required activation %, and assembles the Customer Success Queue + First Customer
 * Success Tracker.
 *
 * Determinism: pure function over injected inputs (no AI, no time, no randomness). The loader
 * is injected so the compute is hermetically testable.
 */

export type MilestoneKey = 'PROFILE' | 'DOMAIN' | 'GA' | 'GSC' | 'TEAM';
export type MilestoneStatus = 'COMPLETE' | 'READY_NOW' | 'BLOCKED';
export type ActionOwner = 'CUSTOMER' | 'PRODUCT';

export const REQUIRED_MILESTONES: MilestoneKey[] = ['PROFILE', 'DOMAIN', 'GA', 'GSC', 'TEAM'];
export const PROFILE_CONFIDENCE_THRESHOLD = 60;
export const DEFAULT_TRACKER_TARGET = 'Unfinished Innovations LLP';

/** Raw, already-loaded milestone state for one CUSTOMER company. */
export interface CustomerActivationInput {
  company_id: string;
  company_name: string;
  profile_confidence: number | null;
  domain_verified: boolean;
  ga_status: string | null;   // analytics_integrations.status for GA4 (null = no integration row)
  gsc_status: string | null;  // analytics_integrations.status for GSC
  active_team_members: number; // user_company_roles with status active
  /** Optional explicit product blockers keyed by milestone (none expected post-16H/16I). */
  product_blockers?: Partial<Record<MilestoneKey, string>>;
}

export interface ActionCard {
  milestone: MilestoneKey;
  action: string;
  owner: ActionOwner;
  execution_url: string;
  completion_criteria: string;
}

export interface CustomerActivationRow {
  company_id: string;
  company_name: string;
  milestones: Record<MilestoneKey, MilestoneStatus>;
  action_cards: ActionCard[];
  completed_count: number;
  required_count: number;
  activation_pct: number;
  remaining: MilestoneKey[];
}

export interface WorkbenchResult {
  workbench: CustomerActivationRow[];
  queue: CustomerActivationRow[];
  tracker: CustomerActivationRow | null;
  generated_for: string; // tracker target name
}

// ── Action-card templates (executable tasks, not recommendations) ────────────
const ACTION_TEMPLATES: Record<MilestoneKey, Omit<ActionCard, 'milestone'>> = {
  PROFILE: {
    action: 'Complete the company profile (set the website) so it scores',
    owner: 'CUSTOMER',
    execution_url: '/company-profile',
    completion_criteria: `company_profiles.overall_confidence >= ${PROFILE_CONFIDENCE_THRESHOLD}`,
  },
  DOMAIN: {
    action: 'Publish the domain verification token and verify ownership',
    owner: 'CUSTOMER',
    execution_url: '/onboarding/domain-verification',
    completion_criteria: "company_domains.verification_status = 'verified'",
  },
  GA: {
    action: 'Connect Google Analytics (complete Google OAuth consent)',
    owner: 'CUSTOMER',
    execution_url: '/integrations',
    completion_criteria: "analytics_integrations(GA4).status = 'connected'",
  },
  GSC: {
    action: 'Connect Google Search Console (complete Google OAuth consent)',
    owner: 'CUSTOMER',
    execution_url: '/integrations',
    completion_criteria: "analytics_integrations(GSC).status = 'connected'",
  },
  TEAM: {
    action: 'Invite a team member; the invitee accepts the emailed link',
    owner: 'CUSTOMER',
    execution_url: '/team-management',
    completion_criteria: 'a second member becomes active (active_team_members > 1)',
  },
};

/** Pure: mechanical status for one milestone. */
export function milestoneStatus(input: CustomerActivationInput, key: MilestoneKey): MilestoneStatus {
  if (input.product_blockers?.[key]) return 'BLOCKED';
  switch (key) {
    case 'PROFILE': return (input.profile_confidence ?? 0) >= PROFILE_CONFIDENCE_THRESHOLD ? 'COMPLETE' : 'READY_NOW';
    case 'DOMAIN': return input.domain_verified ? 'COMPLETE' : 'READY_NOW';
    case 'GA': return input.ga_status === 'connected' ? 'COMPLETE' : 'READY_NOW';
    case 'GSC': return input.gsc_status === 'connected' ? 'COMPLETE' : 'READY_NOW';
    case 'TEAM': return input.active_team_members > 1 ? 'COMPLETE' : 'READY_NOW';
  }
}

/** Pure: build one customer's workbench row. */
export function buildRow(input: CustomerActivationInput): CustomerActivationRow {
  const milestones = Object.fromEntries(
    REQUIRED_MILESTONES.map((k) => [k, milestoneStatus(input, k)]),
  ) as Record<MilestoneKey, MilestoneStatus>;

  const remaining = REQUIRED_MILESTONES.filter((k) => milestones[k] !== 'COMPLETE');
  const completed_count = REQUIRED_MILESTONES.length - remaining.length;
  const action_cards = remaining.map((k) => ({
    milestone: k,
    ...(milestones[k] === 'BLOCKED'
      ? { ...ACTION_TEMPLATES[k], owner: 'PRODUCT' as ActionOwner, action: input.product_blockers?.[k] || ACTION_TEMPLATES[k].action }
      : ACTION_TEMPLATES[k]),
  }));

  return {
    company_id: input.company_id,
    company_name: input.company_name,
    milestones,
    action_cards,
    completed_count,
    required_count: REQUIRED_MILESTONES.length,
    activation_pct: Math.round((completed_count / REQUIRED_MILESTONES.length) * 100),
    remaining,
  };
}

/** Pure: full workbench, queue (sorted), and tracker. */
export function buildWorkbench(
  inputs: CustomerActivationInput[],
  trackerTarget: string = DEFAULT_TRACKER_TARGET,
): WorkbenchResult {
  const workbench = inputs.map(buildRow);

  // Queue sort: highest activation % → fewest remaining → name (deterministic tiebreak).
  const queue = [...workbench].sort(
    (a, b) =>
      b.activation_pct - a.activation_pct ||
      a.remaining.length - b.remaining.length ||
      a.company_name.localeCompare(b.company_name),
  );

  const tracker =
    workbench.find((r) => r.company_name === trackerTarget) ?? null;

  return { workbench, queue, tracker, generated_for: trackerTarget };
}

// ── Loader (injected supabase) — operational read, no writes ─────────────────
export interface WorkbenchLoaderDeps {
  // minimal supabase-like client
  from: (table: string) => any;
}

/** Reads the raw milestone state for all CUSTOMER-class companies. No writes. */
export async function loadCustomerActivationInputs(db: WorkbenchLoaderDeps): Promise<CustomerActivationInput[]> {
  const { data: cls } = await db.from('customer_population_classification').select('company_id').eq('classification', 'CUSTOMER');
  const ids: string[] = (cls ?? []).map((r: any) => r.company_id);
  if (ids.length === 0) return [];

  const [companies, profiles, domains, integrations, roles] = await Promise.all([
    db.from('companies').select('id, name').in('id', ids),
    db.from('company_profiles').select('company_id, overall_confidence').in('company_id', ids),
    db.from('company_domains').select('company_id, verified, verification_status').in('company_id', ids),
    db.from('analytics_integrations').select('company_id, provider, status').in('company_id', ids),
    db.from('user_company_roles').select('company_id, status').in('company_id', ids),
  ]);

  const nameOf = (id: string) => (companies.data ?? []).find((c: any) => c.id === id)?.name ?? id;
  const confOf = (id: string) => (profiles.data ?? []).find((p: any) => p.company_id === id)?.overall_confidence ?? null;
  const domVerified = (id: string) => {
    const rows = (domains.data ?? []).filter((d: any) => d.company_id === id);
    return rows.some((d: any) => d.verified === true || d.verification_status === 'verified' || d.verification_status === 'admin_override');
  };
  const integStatus = (id: string, provider: string) =>
    (integrations.data ?? []).find((a: any) => a.company_id === id && a.provider === provider)?.status ?? null;
  const activeMembers = (id: string) =>
    (roles.data ?? []).filter((r: any) => r.company_id === id && r.status === 'active').length;

  return ids.map((id) => ({
    company_id: id,
    company_name: nameOf(id),
    profile_confidence: confOf(id),
    domain_verified: domVerified(id),
    ga_status: integStatus(id, 'GA4'),
    gsc_status: integStatus(id, 'GSC'),
    active_team_members: activeMembers(id),
  }));
}
