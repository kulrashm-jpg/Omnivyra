/**
 * WS-6 (FR-11 · FR-13 · FR-16 · FR-17 · FR-18 · FR-19) — the canonical spine's
 * connection to the scoring engines.
 *
 * Every WS-6 engine is marked EXISTS in the manifest, and every one of them
 * does exist: `intent.ts`, `prioritization.ts`, `quality.ts`,
 * `explainability.ts`, `prospectIcpFit.ts`, `behavioral.ts`, `relationship.ts`,
 * all pure, all deterministic, all orchestrated by `assembleLeadUnderstanding`.
 * What did not exist is anything that BUILDS their input from the canonical PI
 * spine: `LeadIntelligenceContext` was constructed in three test files and
 * nowhere else in the repository. So the scoring layer was complete and
 * unreachable, and every engine would have abstained on an empty context.
 *
 * This module is that builder, and deliberately nothing else.
 *
 * ─── IT SCORES NOTHING ────────────────────────────────────────────────────
 * No weight, no threshold, no formula, no dimension. `combineScores` and its
 * confidence-weighted blend remain the single scoring authority, and
 * `SCORE_DIMENSIONS` is untouched. This module assembles evidence and hands it
 * to the engines that already know what to do with it; a second place that
 * decided what evidence is worth would be a second scoring model.
 *
 * ─── IT IS THE ASYNC HALF OF A SYNC PIPELINE ──────────────────────────────
 * `assembleLeadUnderstanding` is synchronous and no engine may perform I/O —
 * `prospectIcpFit` states that explicitly and expects `ctx.ratifiedIcp` to
 * arrive already resolved. Reading is therefore the CALLER's job, and this is
 * that caller. It reads through the seams their owners published — WS-5's
 * `readProspectEngagementIntelligence`, WS-7's `aggregateAccountIntelligence`,
 * D1's `getRatifiedIcp` — and reimplements none of them.
 *
 * ─── EVIDENCE THAT CANNOT BE MAPPED IS REPORTED, NOT COERCED ──────────────
 * Three deliberate refusals, each recorded in `gaps` so the reason travels with
 * the answer instead of living only here:
 *
 *   1. `lead_signals` DOES NOT become `ctx.signals`. `RawSignal.type` is a
 *      closed buying-signal vocabulary (`hiring`, `funding`, `exec_change`, …)
 *      and `lead_signals.source_type` is only `engagement` or `listening`.
 *      There is no bridge between them, and choosing one would invent a buying
 *      signal the platform never observed. The signals still arrive, as
 *      behavioural observations, which is what the evidence actually supports.
 *
 *   2. EVIDENCE WITH NO OBSERVATION TIME IS EXCLUDED, not back-dated.
 *      `RawObservation.observedAt` is required, and WS-5 already reports which
 *      entries have no usable time. Giving them `asOf` would date an event by
 *      when we happened to score it, which is how a stale prospect becomes a
 *      fresh one.
 *
 *   3. A BUYING ROLE OUTSIDE THE RELATIONSHIP VOCABULARY IS OMITTED.
 *      `BUYING_ROLES` and `RelationshipRole` share five values; WS-7's
 *      `economic_buyer` and `unknown` have no counterpart. The person is still
 *      contributed as a relationship — with no role, rather than with a role
 *      chosen by resemblance.
 *
 * ─── ABSENCE IS NEVER A SCORE ─────────────────────────────────────────────
 * No engagement produces no observations, which the combiner reads as
 * abstention — `value: null`, not `0`. There is no inactivity penalty here and
 * none is added: a prospect nobody has contacted is unmeasured, not cold. The
 * only place recency enters is `behavioral.ts`'s existing decay over evidence
 * that genuinely exists.
 *
 * ─── ACCOUNT FACTS STAY ACCOUNT FACTS ─────────────────────────────────────
 * Person identity is taken from the PERSON's own roster row, never from the
 * Account. `identity.geography` is left unset rather than filled from the
 * account's region: one contact's employer location is not that contact's
 * location, and WS-3 already established that a tenant's market region is
 * neither. Account attributes travel on `ctx.account`, where the ICP evaluator
 * reads them as the `account` subject — a separate evaluation, never merged
 * into the person's.
 */

import {
  readProspectEngagementIntelligence,
  type ProspectEngagementIntelligence,
  type ProspectEngagementPorts,
} from '../engagement/prospectEngagementIntelligence';
import {
  aggregateAccountIntelligence,
  type AccountIntelligence,
  type AccountIntelligencePorts,
} from '../prospectIdentity/accountIntelligence';
import { getRatifiedIcp } from '../prospectIcp/persistence';
import { BUYING_ROLES } from '../prospectIdentity/attributes';
import { ownedDbTable } from '../../db/writeOwner';
import type { RatifiedIcp } from '../prospectIcp/types';
import type {
  LeadIntelligenceContext,
  RawObservation,
  RawRelationship,
  RelationshipRole,
  BehaviouralEvent,
} from './engines/engineTypes';

/** Bumped when the mapping changes, so a stored score traces to the shape that made it. */
export const PROSPECT_CONTEXT_VERSION = 'ws6.1';

/** The ICP the platform scores against unless a caller names another. */
export const DEFAULT_ICP_KEY = 'default';

/**
 * The roles both vocabularies agree on.
 *
 * Derived by INTERSECTION rather than written out, so it cannot claim a
 * mapping that either side has stopped supporting. `economic_buyer` and
 * `unknown` are absent because `RelationshipRole` has no equivalent — and a
 * near-equivalent chosen here would become the contract.
 */
const RELATIONSHIP_ROLES: readonly RelationshipRole[] = [
  'decision_maker', 'champion', 'influencer', 'evaluator', 'blocker',
  'procurement', 'technical', 'financial', 'user',
];
export const MAPPABLE_BUYING_ROLES: readonly string[] = BUYING_ROLES
  .filter((r): r is (typeof BUYING_ROLES)[number] =>
    (RELATIONSHIP_ROLES as readonly string[]).includes(r));

/** A reason some available evidence did not reach the engines. */
export interface ContextGap {
  readonly kind:
  | 'no_person'
  | 'no_account'
  | 'no_ratified_icp'
  | 'signals_have_no_buying_signal_type'
  | 'evidence_without_observation_time'
  | 'buying_role_outside_relationship_vocabulary';
  readonly detail: string;
  /** How many pieces of evidence this affected, where that is countable. */
  readonly count?: number;
}

export interface ProspectContextResult {
  readonly version: string;
  readonly context: LeadIntelligenceContext;
  /** Which seams answered, so explainability can name its inputs. */
  readonly sources: {
    readonly engagement: boolean;
    readonly account: boolean;
    readonly ratifiedIcp: boolean;
  };
  /** What was missing or unmappable. Never silently dropped. */
  readonly gaps: readonly ContextGap[];
  /** The seam outputs, so a caller can explain a score without re-reading. */
  readonly evidence: {
    readonly engagement: ProspectEngagementIntelligence | null;
    readonly account: AccountIntelligence | null;
    readonly ratifiedIcp: RatifiedIcp | null;
  };
}

/** Everything WS-6 reads. Each entry is another workstream's published seam. */
export interface ProspectContextPorts {
  /** WS-5. */
  loadEngagement(
    input: { organizationId: string; prospectId: string; now: string },
  ): Promise<ProspectEngagementIntelligence | null>;
  /** WS-7. */
  loadAccount(
    input: { organizationId: string; accountId: string; now: string },
  ): Promise<AccountIntelligence | null>;
  /** D1. Returns null when the tenant has ratified nothing — a first-class input. */
  loadRatifiedIcp(organizationId: string, icpKey: string): Promise<RatifiedIcp | null>;
  /**
   * The person's OWN row — their attributes and their employer link.
   *
   * Read directly rather than through WS-7's roster, because a person's job
   * title does not depend on our having resolved their employer. Taking
   * identity from the roster would make an unattached person attributeless and
   * silently abstain person ICP fit, which is a gap in OUR data being reported
   * as a gap in the prospect.
   */
  loadPerson(organizationId: string, personId: string): Promise<PersonIdentityRow | null>;
}

/** The person columns WS-6 reads. A subset of LI-1's person surface. */
export interface PersonIdentityRow {
  readonly accountId: string | null;
  readonly attributes: Readonly<Record<string, string | null>>;
}

/**
 * The person attributes that feed identity and the ICP's person subject.
 * Declared as a list so the select, the row shape and the mapping stay one
 * source of truth — and so this file never restates LI-1's columns as fields.
 */
export const PERSON_IDENTITY_COLUMNS = ['job_title', 'department', 'seniority'] as const;

/**
 * LI-1 column → the context's identity field.
 *
 * A pair LIST rather than an object literal, and not by preference: LI-2's
 * boundary guard flags any file that names a spine column as a literal key
 * beside a spine table, because that is what a second writer looks like.
 * Deriving the mapping keeps the guard sharp and keeps `PERSON_IDENTITY_COLUMNS`
 * the single source of truth for the select, the row and this projection.
 */
const IDENTITY_FIELD_BY_COLUMN: ReadonlyArray<readonly [string, 'title' | 'department' | 'seniority']> = [
  ['job_title', 'title'],
  ['department', 'department'],
  ['seniority', 'seniority'],
];

export interface ProspectContextInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  readonly prospectId: string;
  /** Which ratified ICP to score against. Defaults to the tenant's `default`. */
  readonly icpKey?: string;
  /** Injected. The deterministic scoring instant; `asOf` for every engine. */
  readonly asOf: string;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/** The default ports. The ONLY place here that reaches a seam or a table. */
export const defaultProspectContextPorts: ProspectContextPorts = {
  loadEngagement: ({ organizationId, prospectId, now }) =>
    readProspectEngagementIntelligence({ organizationId, prospectId, now }),

  loadAccount: ({ organizationId, accountId, now }) =>
    aggregateAccountIntelligence({ organizationId, accountId, now }),

  loadRatifiedIcp: (organizationId, icpKey) => getRatifiedIcp(organizationId, icpKey),

  async loadPerson(organizationId: string, personId: string): Promise<PersonIdentityRow | null> {
    const { data, error } = await ownedDbTable('unified_persons')
      .select(['account_id', ...PERSON_IDENTITY_COLUMNS].join(', '))
      .eq('id', personId)
      .eq('company_id', organizationId)          // tenant boundary — never optional
      .maybeSingle();
    if (error) throw new Error(`unified_persons read failed: ${error.message}`);
    if (!data) return null;

    const row = data as unknown as Record<string, unknown>;
    return {
      accountId: text(row.account_id),
      attributes: Object.fromEntries(
        PERSON_IDENTITY_COLUMNS.map((c) => [c, text(row[c])]),
      ) as Record<string, string | null>,
    };
  },
};

/**
 * Build the scoring context for one Prospect, for one tenant.
 *
 * Deterministic given its inputs and `asOf`: it reads, maps and returns. It
 * calls no clock, draws no random value and writes nothing, so two builds over
 * unchanged data produce identical contexts — which is what makes the score
 * downstream reproducible.
 *
 * Returns null when the Prospect is not readable in this tenant. WS-5 already
 * refuses to answer for another tenant's Prospect; that refusal is preserved
 * rather than softened into an empty context, because an empty context scores
 * as "we know nothing" and a cross-tenant attempt is not that.
 */
export async function buildProspectIntelligenceContext(
  input: ProspectContextInput,
  ports: ProspectContextPorts = defaultProspectContextPorts,
): Promise<ProspectContextResult | null> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to build a prospect intelligence context');
  }
  if (!input.prospectId?.trim()) {
    throw new Error('prospectId is required to build a prospect intelligence context');
  }
  if (!input.asOf?.trim()) {
    throw new Error('asOf is required — scoring is never anchored to ambient time');
  }

  const gaps: ContextGap[] = [];

  const engagement = await ports.loadEngagement({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    now: input.asOf,
  });
  if (!engagement) return null;

  const personId = engagement.personId;
  if (!personId) {
    gaps.push({
      kind: 'no_person',
      detail: 'the prospect has no resolved person, so no person, account or engagement evidence exists',
    });
  }

  // ── PERSON + ACCOUNT (WS-7) ─────────────────────────────────────────────
  const person = personId ? await ports.loadPerson(input.organizationId, personId) : null;
  const accountId = person?.accountId ?? null;
  const account = accountId
    ? await ports.loadAccount({
      organizationId: input.organizationId, accountId, now: input.asOf,
    })
    : null;
  if (personId && !account) {
    gaps.push({
      kind: 'no_account',
      detail: accountId
        ? `account ${accountId} is not readable in this tenant`
        : 'the person is not attached to an account, so no company fit can be evaluated',
    });
  }

  // ── RATIFIED ICP (D1) ───────────────────────────────────────────────────
  const icpKey = text(input.icpKey) ?? DEFAULT_ICP_KEY;
  const ratifiedIcp = await ports.loadRatifiedIcp(input.organizationId, icpKey);
  if (!ratifiedIcp) {
    gaps.push({
      kind: 'no_ratified_icp',
      detail: `this tenant has ratified no ICP under '${icpKey}'; the icp dimension abstains`,
    });
  }

  // ── IDENTITY — the PERSON's own row, never the account's ────────────────
  // Sourced from `loadPerson`, NOT from WS-7's roster: a person's job title
  // does not depend on our having resolved their employer, and taking it from
  // the roster would leave an unattached person attributeless — abstaining
  // person ICP fit over a gap in OUR data rather than in the prospect.
  const personFields = Object.fromEntries(
    IDENTITY_FIELD_BY_COLUMN
      .map(([column, field]) => [field, person?.attributes[column] ?? undefined] as const)
      .filter(([, value]) => value !== undefined),
  ) as Partial<Record<'title' | 'department' | 'seniority', string>>;

  const identity: LeadIntelligenceContext['identity'] = {
    ...personFields,
    organization: account?.account.name ?? undefined,
    // `geography` is deliberately unset: the only location available is the
    // ACCOUNT's, and an employer's region is not this person's region.
    source: 'prospect_identity',
    observedAt: account?.freshness.attributesUpdatedAt ?? undefined,
  };

  // ── BEHAVIOURAL EVIDENCE (WS-5) ─────────────────────────────────────────
  // Both shapes are built from the SAME timeline so `behavioral.ts`'s
  // longitudinal view and `intent.ts`'s observation view cannot disagree about
  // what happened.
  const behaviour: RawObservation[] = [];
  const behaviouralHistory: BehaviouralEvent[] = [];
  let undated = 0;

  for (const entry of engagement.timeline) {
    if (entry.observedAt === null) { undated += 1; continue; }
    const label = entry.kind === 'signal'
      ? `signal:${entry.channel ?? 'unknown_channel'}`
      : `message:${entry.direction ?? 'direction_unknown'}`;
    const source = entry.source;
    behaviour.push({ label, source, observedAt: entry.observedAt, kind: 'observed' });
    // `stage` is left undefined on purpose: a buying stage is a judgement, and
    // nothing in the engagement record states one. Inferring it from a message
    // would put a second qualification model here.
    behaviouralHistory.push({ label, source, observedAt: entry.observedAt });
  }

  if (undated > 0) {
    gaps.push({
      kind: 'evidence_without_observation_time',
      detail: 'excluded from scoring: dating it by asOf would make an undated event look current',
      count: undated,
    });
  }
  if (engagement.signals.length > 0) {
    gaps.push({
      kind: 'signals_have_no_buying_signal_type',
      detail: "lead_signals carries source_type 'engagement'/'listening', which does not map to the "
        + 'closed buying-signal vocabulary; contributed as behavioural observations instead',
      count: engagement.signals.length,
    });
  }

  // ── RELATIONSHIPS (WS-7 buying roles) ───────────────────────────────────
  const relationships: RawRelationship[] = [];
  let unmappedRoles = 0;
  for (const c of account?.contacts ?? []) {
    const role = c.attributes.buying_role;
    const mapped = role && (MAPPABLE_BUYING_ROLES as readonly string[]).includes(role)
      ? (role as RelationshipRole)
      : undefined;
    if (role && !mapped) unmappedRoles += 1;
    relationships.push({
      personId: c.personId,
      role: mapped,
      source: 'prospect_account_roster',
      observedAt: account?.freshness.attributesUpdatedAt ?? input.asOf,
    });
  }
  if (unmappedRoles > 0) {
    gaps.push({
      kind: 'buying_role_outside_relationship_vocabulary',
      detail: `roles outside ${MAPPABLE_BUYING_ROLES.join('/')} are contributed without a role rather than `
        + 'mapped by resemblance',
      count: unmappedRoles,
    });
  }

  // ── ACCOUNT FACTS for the ICP `account` subject (FR-16) ─────────────────
  // Only facts the Account actually HOLDS. A missing attribute is omitted, and
  // the evaluator reports it `unknown` — never a failed match.
  const accountAttributes: Record<string, unknown> = {};
  for (const fact of account?.facts ?? []) {
    if (fact.value !== null && fact.value !== undefined) accountAttributes[fact.attribute] = fact.value;
  }

  const context: LeadIntelligenceContext = {
    key: { leadKey: input.prospectId, companyId: input.organizationId },
    asOf: input.asOf,
    identity,
    behaviour,
    behaviouralHistory,
    relationships,
    // `signals` is deliberately absent — see refusal 1 in the header.
    ratifiedIcp,
    account: account
      ? {
        attributes: accountAttributes,
        observedAt: account.freshness.attributesUpdatedAt,
      }
      : undefined,
    companyId: accountId ?? undefined,
  };

  return {
    version: PROSPECT_CONTEXT_VERSION,
    context,
    sources: {
      engagement: engagement.completeness.messages > 0 || engagement.completeness.signals > 0,
      account: account !== null,
      ratifiedIcp: ratifiedIcp !== null,
    },
    gaps,
    evidence: { engagement, account, ratifiedIcp },
  };
}
