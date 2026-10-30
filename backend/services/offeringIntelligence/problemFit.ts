/**
 * PI WS-D — the Problem Fit SEAM. It prepares a seam; it does not add a dimension.
 *
 * Problem Fit is a relation between two halves: the problems a tenant's offering SOLVES, and the
 * problem a prospect HAS. This module publishes the first half and refuses to imply the second.
 *
 * ─── THE SELL SIDE IS DERIVED AT READ TIME ────────────────────────────────
 * `readTenantOfferingUnderstanding` builds the tenant's offering context from its own
 * `company_profiles` row, runs the canonical `assembleOfferingUnderstanding` — the module's sole
 * owner of build, score and projection — and reshapes the decided facets. It owns nothing, scores
 * nothing and stores nothing. No table, no writer, no migration: the same read-time pattern
 * `leadUnderstanding` already uses.
 *
 * ─── THE BUY SIDE IS ABSENT, AND SAYS SO ──────────────────────────────────
 * Nothing in intake, enrichment or engagement captures a PROSPECT's problem. `lead_signals` carries
 * `content_text` that is never projected into the scoring context, and the ICP criterion surface
 * already names `problem_relevance` and `product_service_alignment` as UNREPRESENTABLE — see
 * `prospectIcp/generator/prompt.ts`. So `assessProblemFitReadiness` reports `scorable: false` with
 * the reason, and `problem_fit` stays out of any frozen dimension list. A seam that quietly returned
 * a number here would be the fabricated zero the read surface exists to prevent.
 *
 * ─── PI WAVE-2C: THE ABSENCE WAS RE-ESTABLISHED FROM SOURCE, AND IS NOW A CONTRACT ──
 * Every candidate store was read rather than assumed: the canonical assertion surface, the canonical
 * signal model, the engagement tables, the prospect's own metadata bag, and the derived opportunity
 * classifications. None of them records a problem the prospect stated. `PROBLEM_FIT_CANDIDATE_STORES`
 * carries that finding per store, with its citation, so a later reader does not have to re-audit it;
 * `PROBLEM_FIT_BUY_SIDE_CONTRACT` states field by field what a record would have to carry.
 *
 * The one thing this module now DOES do with the buy side is refuse it safely. `admitProspectProblem`
 * is a gate, not a mapper: it admits a verbatim prospect statement bound to a canonical, tenant-
 * scoped subject with an origin and an observation time, and refuses everything else — above all the
 * derivations in `INADMISSIBLE_PROBLEM_DERIVATIONS`, because revenue, industry, firmographics, icp
 * fit and engagement volume describe a prospect's shape and not its problem. Even an admissible
 * statement leaves `scorable: false`: migration `20261013000000` establishes that fit is a relation
 * needing a product decision about where it lives, so a representation and a weight are still owed.
 *
 * ─── PI WAVE-3 TRACK A: THE AUDIT WAS RE-RUN, NOT INHERITED ────────────────
 * A negative finding is only evidence while it is still true, so every store below was read again
 * against the current tree rather than trusted. The verdict is unchanged — NO store can supply a
 * prospect-stated problem — but the re-run changed the audit in three ways that matter.
 *
 * 1. ONE REASON WAS STALE, AND A STALE REASON IS THE DANGEROUS KIND. The Wave-2C entry for
 *    `lead_signals` refused it partly because the row "carries no link to the canonical person".
 *    That is no longer true: `lead_signals.contact_id` exists, is INDEXED, and is populated on every
 *    write by `canonicalLeadSignalService`, which resolves a `contacts` row and carries its
 *    `unified_person_id`. A reader who checked only that clause would find it false, conclude the
 *    objection had been answered, and map `content_text` in. So the entry now rests on the two
 *    requirements the store actually fails — `statement` and `observedAt` — and says that the
 *    subject link exists, because an audit that overstates its case loses the argument it should win.
 *
 * 2. FOUR STORES THE FIRST PASS NEVER EXAMINED ARE NOW AUDITED. Searching the schema for a problem
 *    column rather than the known stores surfaced `lead_signals_v1.problem_domain`,
 *    `lead_intent_clusters_v1.problem_domain`, `opportunity_items.problem_domain` and the outcome
 *    ledger. The first three are one classifier's label travelling under a column name that reads
 *    like evidence; the fourth records THAT a prospect replied and never what the reply said.
 *
 * 3. THE AUDIT IS NOW ENFORCED RATHER THAN DOCUMENTED. Each entry carries the `relation` it concerns,
 *    and `admitProspectProblem` refuses a candidate whose `origin.store` names one — quoting that
 *    store's own audited reason. Publishing a finding and then accepting evidence from the store the
 *    finding disqualified is how an audit becomes a comment. Lifting a refusal now means editing the
 *    verdict, in the open, where a reviewer sees it.
 *
 * ─── THE AUDITED, ROW-SPECIFIC ADMISSION EXCEPTION ────────────────────────
 * The audit's refusals are universal claims about RELATIONS, and they remain the default for every
 * one of them. Exactly one entry now also declares `admissibleWhen`: `engagement_messages`, where a
 * SINGLE row can be proven to be an utterance by a named prospect even though nothing about the
 * relation guarantees it for any row. A store-level deny-list cannot express that, in either
 * direction — the property is a property of one row, and this gate is PURE, taking no client and no
 * ports and never reading a row. So the exception is an attestation: a server-set token naming the
 * module that did the reads, the relation it read and the row it proved, checked against the audit's
 * own recorded verifier and against the candidate's own `origin.recordId`. Anything short of all of
 * that keeps the existing refusal, with its existing wording. A caller-settable flag would have been
 * the caller's assertion wearing the gate's clothes, which is the failure mode the whole audit
 * exists to refuse.
 *
 * `source_records` is now audited too, beside its child `source_assertions`: the provenance spine
 * records THAT a provider returned a document about an ENTITY, never that a prospect said anything.
 *
 * What did NOT change: `PROBLEM_FIT_BUY_SIDE_CONTRACT` and `PROBLEM_FIT_CONTRACT_VERSION`. The six
 * requirements were re-read and none of them moved, so `pf.1` still describes exactly what it
 * described. The audit grew; the contract did not, and `scorable` is still the literal `false`.
 */

import { assembleOfferingUnderstanding } from './engines/assembly';
import {
  buildTenantOfferingContext,
  defaultTenantOfferingContextPorts,
  type TenantOfferingContextInput,
  type TenantOfferingContextPorts,
  type TenantOfferingGap,
  type TenantProblemProvenance,
} from './tenantOfferingContext';
import type { OfferingFacetName } from './types';

/**
 * Bumped when this seam's shape changes, so a consumer can pin what it parsed.
 * wsd.2 — `problemProvenance` added. Additive: every field wsd.1 published is unchanged in
 * shape, order and value; the new field states which profile column each problem was read from.
 */
export const OFFERING_SELL_SIDE_VERSION = 'wsd.2';

/** One offering, as the canonical assembly decided it. Every field abstains rather than defaulting. */
export interface SellSideOffering {
  readonly offeringId: string;
  readonly name: string | null;
  /** Declared `product` | `service` | … — null here, because the profile column does not say. */
  readonly offeringType: string | null;
  readonly category: string | null;
  readonly positioning: string | null;
  readonly valueProposition: string | null;
  readonly customerProblems: readonly string[];
  readonly outcomes: readonly string[];
  readonly differentiators: readonly string[];
  readonly industries: readonly string[];
  readonly personas: readonly string[];
  /** The assembly's own confidence. Facets it abstained on are named, not zeroed. */
  readonly confidence: number;
  readonly abstainedFacets: readonly OfferingFacetName[];
}

export interface TenantSellSide {
  readonly version: string;
  readonly organizationId: string;
  readonly asOf: string;
  readonly offerings: readonly SellSideOffering[];
  /**
   * The union of every problem the tenant's offerings claim to solve. This is the half Problem Fit
   * needs from the sell side — and, because `company_profiles` is one row per tenant, it is in
   * practice the tenant's problem statement rather than any one offering's.
   */
  readonly portfolioProblems: readonly string[];
  /**
   * The same problems, each with the profile column it was read from — a stated
   * `core_problem_statement` or one of the `pain_symptoms`.
   *
   * `portfolioProblems` is the half Problem Fit needs; this is how a caller tells a problem from a
   * symptom without re-reading the profile. It is a LOOKUP, not a parallel array: `portfolioProblems`
   * is deduplicated case-insensitively across offerings, so match on the value rather than by index.
   * Additive — `portfolioProblems` and every offering's `customerProblems` are unchanged.
   */
  readonly problemProvenance: readonly TenantProblemProvenance[];
  readonly sources: { readonly profile: boolean; readonly curatedOfferingList: boolean };
  readonly gaps: readonly TenantOfferingGap[];
}

/**
 * Read the tenant's derived offering understanding.
 *
 * Returns null when the tenant has no profile row — "we could not look", which a caller must be able
 * to tell from "we looked and the tenant names no offering" (an empty `offerings` array).
 */
export async function readTenantOfferingUnderstanding(
  input: TenantOfferingContextInput,
  ports: TenantOfferingContextPorts = defaultTenantOfferingContextPorts,
): Promise<TenantSellSide | null> {
  const built = await buildTenantOfferingContext(input, ports);
  if (!built) return null;

  const offerings: SellSideOffering[] = built.contexts.map((ctx) => {
    const { understanding } = assembleOfferingUnderstanding(ctx);
    const f = understanding.facets;
    const abstained = (Object.keys(f) as OfferingFacetName[]).filter((n) => f[n].value === null);
    return {
      offeringId: understanding.key.offeringId,
      name: f.identity.value?.name ?? null,
      offeringType: (f.offeringType.value as string | null) ?? null,
      category: f.category.value?.category ?? null,
      positioning: f.positioning.value?.statement ?? null,
      valueProposition: f.valueProposition.value?.statement ?? null,
      customerProblems: f.customerProblems.value?.problems ?? [],
      outcomes: f.outcomes.value?.outcomes ?? [],
      differentiators: f.differentiators.value?.differentiators ?? [],
      industries: f.industries.value?.industries ?? [],
      personas: f.personas.value?.personas ?? [],
      confidence: understanding.score.confidence,
      abstainedFacets: abstained,
    };
  });

  const seen = new Set<string>();
  const portfolioProblems: string[] = [];
  for (const o of offerings) {
    for (const p of o.customerProblems) {
      const k = p.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      portfolioProblems.push(p);
    }
  }

  return {
    version: OFFERING_SELL_SIDE_VERSION,
    organizationId: built.organizationId,
    asOf: input.asOf,
    offerings,
    portfolioProblems,
    problemProvenance: built.problemProvenance,
    sources: built.sources,
    gaps: built.gaps,
  };
}

/** The evidence Problem Fit still needs, which no part of the platform currently captures. */
export const PROBLEM_FIT_MISSING_BUY_SIDE: readonly string[] = [
  'a prospect-stated problem — nothing in intake, enrichment or engagement captures one',
  'lead_signals.content_text is never projected into the scoring context',
  'problem_relevance and product_service_alignment are UNREPRESENTABLE on the ratified ICP criterion surface',
  'a defined representation and weight for a problem_fit score — an open product decision',
];

/**
 * Bumped when the buy-side contract below changes shape, so a consumer pins what it parsed.
 * `pf.1` — the first version to publish the contract as data rather than as prose.
 */
export const PROBLEM_FIT_CONTRACT_VERSION = 'pf.1';

/** One field a buy-side record must carry before Problem Fit could be computed at all. */
export interface ProblemFitEvidenceRequirement {
  readonly field: string;
  readonly requirement: string;
}

/**
 * THE MISSING EVIDENCE CONTRACT, field by field.
 *
 * This is the answer to "what would you need". It is deliberately a list of requirements rather than
 * a table design: the store is an owner decision, and five of these fields are already carried by the
 * canonical evidence spine for every other kind of claim, so a new table may well be the wrong answer.
 */
export const PROBLEM_FIT_BUY_SIDE_CONTRACT: readonly ProblemFitEvidenceRequirement[] = [
  {
    field: 'subject',
    requirement: 'the canonical, tenant-scoped prospect the problem belongs to — a person or account '
      + 'on the spine, identified together with its tenant. A platform handle, a thread, a contact key '
      + 'or a provider record id is not a subject: none of them resolves to the entity a dimension is '
      + 'scored for, and an untenanted subject would let one tenant\'s evidence be read by another',
  },
  {
    field: 'statement',
    requirement: 'the problem AS THE PROSPECT STATED IT, in the prospect\'s own words. A topic label, '
      + 'a keyword match, a classifier\'s output or a seller\'s summary is a derivation of a statement '
      + 'and not the statement, so it cannot stand in for this field',
  },
  {
    field: 'origin',
    requirement: 'the store and the record the statement was read from, so a reader can return to the '
      + 'words rather than trusting a copy of them — the same provenance every assertion on the '
      + 'canonical spine already carries',
  },
  {
    field: 'observedAt',
    requirement: 'when the PROSPECT said it, as the source reported it. Our ingest time is not an '
      + 'observation time: dating a statement by when we happened to read it is how a stale problem '
      + 'becomes a current one',
  },
  {
    field: 'confidence',
    requirement: 'the recording source\'s own confidence in the statement, or an explicit null. A '
      + 'confidence nobody recorded stays null and is never defaulted to a 1 or to a 0',
  },
  {
    field: 'representation and weight',
    requirement: 'a product decision, not a data field: how a problem on each side becomes a 0..1 the '
      + 'combiner can blend, and what that dimension is worth. Migration 20261013000000 establishes '
      + 'that fit is a relation between tenant and prospect rather than a property of either, and '
      + 'leaves where fit lives explicitly undecided',
  },
];

/** What was examined, and why it cannot supply the contract above. */
export interface ProblemFitCandidateStore {
  readonly store: string;
  readonly verdict: 'insufficient';
  readonly reason: string;
  readonly citation: string;
  /**
   * The relation this verdict disqualifies, exactly as a writer would name it in `origin.store`, or
   * null when the entry concerns a read PATH rather than a table. This is the machine half of the
   * audit: `admitProspectProblem` matches `origin.store` against it, so the finding refuses evidence
   * instead of merely describing why it should be refused.
   */
  readonly relation: string | null;
  /**
   * The ONE narrow way this otherwise-refused relation can supply a single row — or null, which is
   * the answer for every entry but one.
   *
   * ─── WHY A ROW EXCEPTION AND NOT A STORE-LEVEL DENY-LIST ENTRY ──────────
   * Each audited verdict is a universal claim about a RELATION: nothing about `engagement_messages`
   * guarantees that a given row is an utterance by a given prospect. That claim is true and stays
   * true. But a store-level deny-list cannot express the property that would answer it in one case,
   * because the property is a property of ONE ROW — this row is tenant-scoped, was written by this
   * prospect, in this subject's thread, with a source-reported time. A deny-list can only say yes or
   * no to the whole table. And `admitProspectProblem` cannot settle it either: the gate is PURE — it
   * takes no client and no ports and never reads a row — so it has no way to look. The only thing a
   * pure gate can do is require an attestation that a named module did the reads, and then check
   * that the attestation refers to the row in front of it.
   *
   * ─── WHY A CALLER-SETTABLE FLAG WOULD BE NO EVIDENCE AT ALL ─────────────
   * `verifier` is MATCHED against this field's value rather than accepted as free text, and the
   * attestation is server-set: the route refuses the key and the sole producer constructs it after
   * the reads it names. A boolean a caller could set would simply relocate the caller's own
   * assertion into a field the gate then believes — the "default standing in for evidence" this
   * whole module exists to refuse. An attestation naming a module and a row id is checkable against
   * something; a flag is checkable against nothing.
   *
   * ─── WHY IT LIVES BESIDE THE VERDICT ────────────────────────────────────
   * The audit promises that "the only way to admit it is to change the verdict in the open". An
   * exception kept anywhere else would make that sentence false while leaving it in the file. Here,
   * the refusal and its single exception are read together, and the exception is a NARROWING of a
   * universal refusal to rows that were individually proven — not a weakening of it. With no
   * attestation, every relation-bearing entry, this one included, is refused exactly as before.
   */
  readonly admissibleWhen: { readonly verifier: string; readonly requirement: string } | null;
}

/**
 * THE AUDIT, as data. Each store was read, not assumed — which is why each entry cites the file or
 * migration that settles it. The point of publishing this is that the next reader inherits the
 * finding instead of repeating the search and, finding free text somewhere, mapping it in.
 */
export const PROBLEM_FIT_CANDIDATE_STORES: readonly ProblemFitCandidateStore[] = [
  {
    // The PARENT of `source_assertions`, audited beside its child so a reader who finds the child
    // refused cannot conclude the provenance spine itself was never examined.
    store: 'source_records (the provenance spine)',
    relation: 'source_records',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the provenance spine records THAT a provider returned a document ABOUT AN ENTITY, and '
      + 'never that a prospect said anything. `source_entity_type` is CHECK-restricted to `person` '
      + 'or `account`, so every row is a profile of somebody rather than an utterance BY somebody — '
      + 'there is no statement column, and `raw_payload` is the provider\'s own object about the '
      + 'entity. Its child `source_assertions` is refused on a closed attribute vocabulary that '
      + 'names no problem, no pain and no need, so the spine cannot carry one as an attribute '
      + 'either. And `observed_at` is the PROVIDER\'s view of the entity: it is nullable, and the '
      + 'ingestion boundary RE-STAMPS it whenever the payload hash moves while bumping '
      + '`observation_count` on the same row — so it tracks when the provider last saw a changed '
      + 'profile, and can never be read as the instant a prospect spoke',
    citation: 'supabase/migrations/20261002000000_li2_source_records.sql (public.source_records: '
      + 'source_entity_type CHECK IN (person, account), observed_at nullable, observation_count); '
      + 'backend/services/prospectIdentity/attributes.ts (PersonAttributes / AccountAttributes name '
      + 'no problem, pain or need); backend/services/prospectIdentity/ingestionBoundary.ts '
      + '(observed_at is re-stamped on a payload change, observation_count is incremented)',
  },
  {
    store: 'source_assertions',
    relation: 'source_assertions',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the canonical assertion surface is a CLOSED attribute vocabulary and no attribute on it '
      + 'names a problem, a pain or a need; the ingestion boundary refuses to write outside that '
      + 'surface, so an assertion carrying one could not be stored even if a provider sent it',
    citation: 'backend/services/prospectIdentity/attributes.ts (PersonAttributes / AccountAttributes); '
      + 'backend/services/prospectIdentity/ingestionBoundary.ts (candidates outside the allowed columns '
      + 'are skipped); supabase/migrations/20261002000000_li2_source_records.sql',
  },
  {
    store: 'lead_signals',
    relation: 'lead_signals',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the canonical signal model does store the prospect\'s words in `content_text`, and the '
      + 'SUBJECT objection no longer holds — `contact_id` is written on every signal and carries a '
      + '`contacts.unified_person_id`, so a tenant-scoped canonical person IS reachable. It fails on '
      + 'the other two requirements instead. `statement`: a signal\'s declared kind is only `engagement` '
      + 'or `listening`, so no row asserts that its text states a problem, and treating any engagement '
      + 'text as one is the `engagement` derivation this module refuses by name. `observedAt`: '
      + '`detected_at` is DEFAULTED to the writer\'s own clock when a caller omits it, so it cannot be '
      + 'trusted as the time the prospect spoke — which is the exact substitution the contract forbids',
    citation: 'supabase/_schema/baseline.sql (public.lead_signals: content_text, contact_id, '
      + 'detected_at, and the CHECK restricting its signal kind); supabase/migrations/20260419_contacts_spine.sql '
      + '(idx_lead_signals_contact_id); backend/services/canonicalLeadSignalService.ts '
      + '(resolveContactId writes contact_id; detectedAt falls back to new Date())',
  },
  {
    store: 'lead_signals_v1 (the listening pipeline)',
    relation: 'lead_signals_v1',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the closest thing the platform has, and still not it: the row carries verbatim `raw_text` '
      + 'and a genuinely source-reported `post_created_at`, which would satisfy two requirements. But '
      + 'its only actor is an `author_handle` string — there is no contact or person column, so the '
      + 'text binds to no canonical subject — and its `problem_domain` is not the author\'s words at '
      + 'all: it is the lead qualifier\'s label, written out of signal metadata. A column named for a '
      + 'problem holding a classifier\'s output is precisely how an absence becomes a number',
    citation: 'supabase/_schema/baseline.sql (public.lead_signals_v1: raw_text, author_handle, '
      + 'post_created_at, problem_domain — and no contact/person column); '
      + 'backend/services/leadJobProcessor.ts (problem_domain comes from qualifyLead); '
      + 'backend/services/leadQualifier.ts',
  },
  {
    store: 'lead_intent_clusters_v1',
    relation: 'lead_intent_clusters_v1',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'a POPULATION aggregate keyed by a cluster hash, not a prospect — and a problem asserted '
      + 'for a cluster is asserted for nobody in it. Worse for this purpose, `problem_domain` is NOT '
      + 'NULL and the clusterer supplies the literal `General` whenever the underlying signals name '
      + 'none, so the column is never empty even when nothing was observed: a default standing in for '
      + 'evidence, which is the one failure mode this whole module exists to prevent',
    citation: 'supabase/_schema/baseline.sql (public.lead_intent_clusters_v1: problem_domain NOT NULL, '
      + 'cluster_hash, signal_count); backend/services/leadClusterService.ts (the General fallback '
      + 'and the per-domain grouping)',
  },
  {
    store: 'the prospect engagement seam',
    relation: null,
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the only reader that reaches engagement evidence FROM a canonical prospect deliberately '
      + 'selects no text at all — neither the message body nor `content_text` — and publishes counts, '
      + 'scores and times. Re-read in Wave 3: its signal projection now reads `lead_signals` by both '
      + '`thread_id` and `contact_id`, and still names no text column in either select list. So no '
      + 'prospect words reach the scoring context by this path today',
    citation: 'backend/services/engagement/prospectEngagementIntelligence.ts (MessageRow, SignalRow '
      + 'and their select lists)',
  },
  {
    store: 'engagement_messages',
    relation: 'engagement_messages',
    verdict: 'insufficient',
    // THE ONE EXCEPTION, and the only non-null `admissibleWhen` in the audit.
    //
    // The `reason` below is left EXACTLY as written, deliberately. One half of it — "carries no
    // tenant column" — has gone stale: `supabase/migrations/20261221000000_eng004_engagement_message_tenant.sql`
    // adds `organization_id`, backfills it from the parent thread, sets it NOT NULL and enforces
    // `message.organization_id = thread.organization_id` with the `engagement_messages_tenant_matches_thread`
    // trigger. Whether that migration has been APPLIED to any real database is NOT verified here and
    // was not verified by this change. The staleness is recorded in `admissibleWhen.requirement`
    // rather than by editing the `reason`, because the reason's other half still holds (the table
    // carries no link to the canonical person) and because `piWs3aProblemFitSourceReverify.test.ts`
    // pins audited reason text — an audit whose wording moves to accommodate a change is no longer
    // a record of what was found. A stale clause that is NAMED is evidence; one silently rewritten
    // is not.
    admissibleWhen: {
      verifier: 'prospectProblems/verifyProspectMessage',
      requirement: 'one named message row, and nothing else, may be admitted — and only when the '
        + 'verifier has itself read and proven ALL of: (1) the row is reachable under the VERIFIED '
        + 'tenant, so the read is never untenanted — note that the "carries no tenant column" half '
        + 'of the reason below is now STALE: migration 20261221000000 adds `organization_id`, '
        + 'backfills it from the parent thread, sets it NOT NULL and enforces it with the '
        + '`engagement_messages_tenant_matches_thread` trigger, and whether that migration is '
        + 'APPLIED to any real database is NOT verified here; (2) the row is POSITIVELY '
        + 'prospect-authored — an author that resolves to the prospect, never the absence of a '
        + 'workspace author and never `direction`, which has no CHECK and defaults to `inbound` so '
        + 'that value is indistinguishable from nobody having stated one; (3) the message thread\'s '
        + 'person is THE SAME canonical person as the observation\'s subject, because '
        + '`message_type` defaults to `comment` and a third party posting in the prospect\'s thread '
        + 'is not the prospect speaking; (4) the statement is derived from the row\'s own `content` '
        + 'and from nothing else — no summary, no label, no excerpt; (5) the observation time is '
        + 'the source-reported `platform_created_at` and not `created_at` or `detected_at`, which '
        + 'are OUR clocks and are never substituted. The attestation is server-set, names this '
        + 'verifier, names this relation and names the row it proves; it admits that row and no '
        + 'other, and the relation stays refused for every row nobody proved',
    },
    reason: 'the message body exists but the table carries no tenant column — its only tenancy is its '
      + 'thread — and no link to the canonical person. Reading it by any other key would be an '
      + 'untenanted read, which is the one thing the engagement seam refuses to do',
    citation: 'supabase/_schema/baseline.sql (public.engagement_messages); '
      + 'supabase/migrations/20261221000000_eng004_engagement_message_tenant.sql',
  },
  {
    store: 'canonical_leads.lead_metadata',
    relation: 'canonical_leads',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'a free-form jsonb bag with no schema. Its two writers record a resolution version, a '
      + 'creator and an observation time, plus whatever a CRM row carried; neither writes a problem, '
      + 'and a bag no writer fills is not a source — reading a key out of it would be reading a key '
      + 'this platform never wrote',
    citation: 'backend/services/prospectIdentity/prospectResolution.ts; '
      + 'backend/services/crmIngestionService.ts',
  },
  {
    store: 'derived opportunity classifications',
    relation: 'opportunity_items',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the opportunity surface does classify prospect text, but by keyword and pattern match — '
      + 'that output is an inference about the text, and its verbatim excerpt is capped display copy '
      + 'bound to a feed item rather than to a prospect. A classifier\'s label is exactly what the '
      + '`statement` field of the contract refuses, and `opportunity_items.problem_domain` is the same '
      + 'label persisted: a company-scoped row with no person or account column on it',
    citation: 'backend/services/opportunityFeedService.ts (classifyOpportunity, buildSignalExcerpt); '
      + 'supabase/migrations/20260818_opportunity_signal_excerpt.sql; '
      + 'supabase/_schema/baseline.sql (public.opportunity_items: problem_domain, company_id)',
  },
  {
    store: 'outreach_outcomes (the outcome ledger)',
    relation: 'outreach_outcomes',
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: 'the outcome ledger proves a prospect ANSWERED and never says what they said. '
      + '`outcome_type` is a closed vocabulary — `replied`, `rejected`, `meeting_booked` and five '
      + 'more — so the strongest record of a real prospect response the platform holds is a category, '
      + 'not a sentence, and `evidence` holds the PROVIDER\'s event payload rather than the '
      + 'prospect\'s words. `rejected` is the sharpest case: it is the closest the platform comes to '
      + 'knowing a prospect has a reason, and the reason is nowhere in the row',
    citation: 'supabase/_schema/baseline.sql (public.outreach_outcomes: outcome_type CHECK, evidence); '
      + 'supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql; '
      + 'supabase/migrations/20260915000000_ws3_feedback_ingestion.sql; '
      + 'backend/services/leadOutreachExecution/feedbackIngestion.ts (FeedbackSignal, evidence)',
  },
  {
    store: 'the ratified ICP criterion surface',
    relation: null,
    verdict: 'insufficient',
    admissibleWhen: null,
    reason: '`problem_relevance` and `product_service_alignment` are declared unrepresentable, and the '
      + 'migration says why: both are FIT concepts rather than properties a prospect has, so storing '
      + 'one as an asserted attribute would let one tenant\'s fit be written onto an entity another '
      + 'tenant observes, and would make a criterion match against a value the ICP itself produced',
    citation: 'backend/services/prospectIcp/generator/prompt.ts (UNREPRESENTABLE_CONCEPTS); '
      + 'supabase/migrations/20261013000000_pi_ws6_ws7_icp_attribute_extension.sql',
  },
];

/**
 * Derivations that must never become a prospect's problem, each with the reason it is refused.
 *
 * This list exists because the repository has already had to remove one revenue-derived fabrication.
 * Every entry describes evidence the platform genuinely holds — which is precisely what makes each
 * one available to be misused as a proxy for a problem nobody stated.
 */
export const INADMISSIBLE_PROBLEM_DERIVATIONS: readonly { readonly derivation: string; readonly reason: string }[] = [
  { derivation: 'revenue', reason: 'annual revenue and a revenue band say how big a company is, not what is wrong in it' },
  { derivation: 'industry', reason: 'an industry is a population, and a problem asserted for a population is asserted for no prospect' },
  { derivation: 'firmographics', reason: 'headcount, employee band, founded year, funding and growth stage describe a company\'s shape, not its problem' },
  { derivation: 'icp_fit', reason: 'icp fit is the tenant\'s own criteria scored against the prospect; using it as the prospect\'s problem would match a criterion against a value the tenant produced' },
  { derivation: 'engagement', reason: 'message counts, recency and reply volume measure contact, not need — and absence of contact measures nothing at all' },
  { derivation: 'classifier', reason: 'a keyword, topic or pattern label is an inference about text; the contract asks for the text' },
  { derivation: 'tenant_offering', reason: 'the problems the tenant says it solves are the SELL side; echoing them onto the prospect would make every prospect a perfect fit' },
];

/** A proposed buy-side record, as a future writer would offer it. Every field may be absent. */
export interface ProspectProblemCandidate {
  readonly subjectType?: 'person' | 'account' | null;
  readonly subjectId?: string | null;
  readonly organizationId?: string | null;
  readonly statement?: string | null;
  readonly origin?: { readonly store?: string | null; readonly recordId?: string | null } | null;
  readonly observedAt?: string | null;
  readonly confidence?: number | null;
  /**
   * How this came to be. Only `prospect_statement` is admissible; anything else is refused, and a
   * value naming one of `INADMISSIBLE_PROBLEM_DERIVATIONS` is refused by name.
   */
  readonly derivedFrom?: string | null;
  /**
   * SERVER-SET. The attestation that one named row of an otherwise-refused relation was read and
   * proven, which is the only thing that satisfies that relation's `admissibleWhen`.
   *
   * NOT a caller field. It is never read from a request body — the route refuses the key and the
   * sole producer constructs it after the reads it names — so a caller cannot reach it. Present on
   * this interface only because the gate must be handed it; absent or null on every other path, and
   * a candidate without it is refused exactly as a candidate has always been refused.
   *
   * THE SHAPE IS DECLARED STRUCTURALLY, ON PURPOSE, and is not imported. `prospectProblems` publishes
   * a `SourceVerification` interface with these three fields, and this declaration is deliberately
   * its structural twin rather than an import of it: `offeringIntelligence` must not depend on
   * `prospectProblems`. The gate is the thing being depended ON — the capture path calls it, not the
   * other way round — and an import here would invert that and couple the published admission
   * contract to one consumer. Structural assignability is exactly what makes the published type work
   * through this field without a dependency, which is the point: the contract is the shape, not the
   * symbol. The two must stay in step, and the check below pins `verifier` against the audit's own
   * recorded value rather than against anything imported, so a drifted verifier fails closed.
   */
  readonly sourceVerification?: {
    readonly verifier: string;
    readonly relation: string;
    readonly recordId: string;
  } | null;
}

/** A candidate that satisfied every field of the contract. Nothing produces one today. */
export interface ProspectStatedProblem {
  readonly subjectType: 'person' | 'account';
  readonly subjectId: string;
  readonly organizationId: string;
  readonly statement: string;
  readonly origin: { readonly store: string; readonly recordId: string };
  readonly observedAt: string;
  /** Null when the source recorded none. Never defaulted. */
  readonly confidence: number | null;
  readonly derivedFrom: 'prospect_statement';
}

export interface ProblemFitRejection {
  readonly field: 'subject' | 'statement' | 'origin' | 'observedAt' | 'confidence' | 'derivedFrom';
  readonly reason: string;
}

export interface ProblemFitAdmission {
  readonly admissible: boolean;
  /** Null unless every requirement was met. A partial record is never half-admitted. */
  readonly problem: ProspectStatedProblem | null;
  /** Every unmet requirement, not just the first — a writer fixes one record, not one field. */
  readonly rejections: readonly ProblemFitRejection[];
}

/**
 * The audited verdict for a relation a writer might name in `origin.store`, or null when the audit
 * has nothing to say about it.
 *
 * Matching is case-insensitive and tolerates a schema qualifier, because `public.lead_signals` and
 * `lead_signals` are the same table and an audit that could be bypassed by spelling is not an audit.
 */
export function auditedProblemSource(store: string | null | undefined): ProblemFitCandidateStore | null {
  const key = relationKey(store);
  if (!key) return null;
  return PROBLEM_FIT_CANDIDATE_STORES.find((c) => c.relation !== null && relationKey(c.relation) === key) ?? null;
}

/**
 * The ONE spelling rule for a relation name, extracted so the lookup above and the row-exception
 * check below cannot drift. Two normalisers would be two audits, and an attestation accepted under
 * a spelling the lookup rejects would be a bypass rather than a narrowing.
 */
function relationKey(store: string | null | undefined): string | null {
  if (typeof store !== 'string') return null;
  const key = store.trim().toLowerCase().replace(/^public\./, '');
  return key.length > 0 ? key : null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
};

/**
 * THE GATE. It admits a prospect-stated problem and refuses everything else.
 *
 * It maps nothing and scores nothing: there is no store behind it yet, and this is deliberately the
 * only shape in which the buy side can enter the module — so the day a store appears, the evidence
 * has to pass the contract rather than the contract being relaxed to fit the evidence.
 *
 * Wave 3 added one refusal: an `origin.store` naming a relation the audit has already disqualified is
 * rejected on sight, with that store's recorded reason and citation. Every field could otherwise be
 * filled correctly from `lead_signals` — a real canonical subject, real words, a real record id — and
 * the record would still be a problem nobody stated. The audit is the part that knows that.
 */
export function admitProspectProblem(candidate: ProspectProblemCandidate): ProblemFitAdmission {
  const rejections: ProblemFitRejection[] = [];

  const subjectType = candidate.subjectType === 'person' || candidate.subjectType === 'account'
    ? candidate.subjectType : null;
  const subjectId = text(candidate.subjectId);
  const organizationId = text(candidate.organizationId);
  if (!subjectType || !subjectId || !organizationId) {
    rejections.push({
      field: 'subject',
      reason: 'a problem needs a canonical person or account id AND the tenant it belongs to; an '
        + 'unidentified or untenanted subject is not a prospect',
    });
  }

  const declared = text(candidate.derivedFrom);
  const named = declared
    ? INADMISSIBLE_PROBLEM_DERIVATIONS.find((d) => d.derivation === declared.toLowerCase())
    : undefined;
  if (named) {
    rejections.push({ field: 'derivedFrom', reason: `refused: ${named.derivation} — ${named.reason}` });
  } else if (declared !== 'prospect_statement') {
    rejections.push({
      field: 'derivedFrom',
      reason: 'only `prospect_statement` is admissible — a record must attest that the prospect stated '
        + 'this, because nothing downstream can tell a statement from a derivation after the fact',
    });
  }

  const statement = text(candidate.statement);
  if (!statement) {
    rejections.push({ field: 'statement', reason: 'the problem in the prospect\'s own words is the evidence; an empty statement is an absence' });
  }

  const store = text(candidate.origin?.store);
  const recordId = text(candidate.origin?.recordId);
  if (!store || !recordId) {
    rejections.push({ field: 'origin', reason: 'the store and record the statement was read from must be named, so a reader can return to the words' });
  } else {
    // The audit is a gate, not a comment. A store this module has already examined and found unable
    // to supply the contract cannot supply it through this door either — and the refusal quotes that
    // store's own recorded reason, so the only way to admit it is to change the verdict in the open.
    //
    // ─── THE ONE ROW-SPECIFIC EXCEPTION ───────────────────────────────────
    // The refusal is a universal claim about a RELATION, and it stays the default: the exception
    // below is a NARROWING to rows that were individually proven, not a weakening. Every one of
    // these must hold, and any single mismatch keeps the refusal above with its existing wording:
    //
    //   · the audited entry declares an exception at all (`admissibleWhen` is non-null) — true of
    //     exactly one entry, so no other relation can be admitted however the candidate is shaped;
    //   · the candidate carries a `sourceVerification` — a server-set attestation that some module
    //     performed reads. No attestation means nothing was proven, which is the ordinary case and
    //     the one the enforcement loop exercises;
    //   · its `verifier` is the verifier the AUDIT names, matched against the audit's own recorded
    //     value rather than taken as free text, so a different module cannot vouch for this row;
    //   · its `relation` is the audited entry's own relation, normalised by the one spelling rule
    //     `auditedProblemSource` uses, so an attestation for table A cannot admit a row of table B;
    //   · its `recordId` is the candidate's own `origin.recordId` — the attestation must be ABOUT
    //     the row being offered. Without this, one proven row would be a key that opens the table.
    //
    // This check lives beside the verdict it overrides so the promise above stays literally true:
    // the refusal and its single exception are read together, in the open, in the same file.
    const audited = auditedProblemSource(store);
    if (audited) {
      const allowance = audited.admissibleWhen;
      const attested = candidate.sourceVerification ?? null;
      // `auditedKey` is non-null for anything `auditedProblemSource` can return, and is required
      // explicitly anyway: two nulls comparing equal must never be how an attestation passes.
      const auditedKey = relationKey(audited.relation);
      const admittedByRow = allowance !== null
        && attested !== null
        && auditedKey !== null
        && text(attested.verifier) === allowance.verifier
        && relationKey(attested.relation) === auditedKey
        && text(attested.recordId) === recordId;
      if (!admittedByRow) {
        rejections.push({
          field: 'origin',
          reason: `refused: ${audited.store} was audited and found ${audited.verdict} as a source of a `
            + `prospect-stated problem — ${audited.reason} (${audited.citation})`,
        });
      }
    }
  }

  const observedAt = text(candidate.observedAt);
  const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (!observedAt || !Number.isFinite(observedMs)) {
    rejections.push({ field: 'observedAt', reason: 'when the prospect said it, as the source reported it; our ingest time is not an observation time and is never substituted' });
  }

  const confidence = candidate.confidence ?? null;
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    rejections.push({ field: 'confidence', reason: 'a recorded confidence must be a number in 0..1; an unrecorded one stays null rather than being defaulted' });
  }

  if (rejections.length > 0) return { admissible: false, problem: null, rejections };

  return {
    admissible: true,
    problem: {
      subjectType: subjectType!,
      subjectId: subjectId!,
      organizationId: organizationId!,
      statement: statement!,
      origin: { store: store!, recordId: recordId! },
      observedAt: observedAt!,
      confidence,
      derivedFrom: 'prospect_statement',
    },
    rejections: [],
  };
}

export interface ProblemFitReadiness {
  /** The contract shape this verdict was produced against. */
  readonly version: string;
  /** Whether the tenant's own offerings could be read, and whether they said anything. */
  readonly sellSide: 'available' | 'empty' | 'unreadable';
  /**
   * The prospect half. `not_implemented` is the production state: no caller can offer a candidate
   * because no store holds one. The other two states exist so that a caller which DOES offer one is
   * told what happened to it, instead of seeing the same blanket answer.
   */
  readonly buySide: 'not_implemented' | 'no_admissible_evidence' | 'evidence_unscored';
  /** Always false — in every state, including `evidence_unscored`. */
  readonly scorable: false;
  readonly reason: string;
  readonly missing: readonly string[];
  /** Field by field, what a buy-side record must carry. */
  readonly contract: readonly ProblemFitEvidenceRequirement[];
  /** Store by store, why none of them carries it. */
  readonly candidateStores: readonly ProblemFitCandidateStore[];
  /** Why each offered candidate was refused. Empty when none was offered. */
  readonly rejected: readonly { readonly index: number; readonly rejections: readonly ProblemFitRejection[] }[];
}

/**
 * State the readiness of Problem Fit, honestly. `scorable` is a literal `false`: this is a seam, and
 * a dimension is a frozen product decision made elsewhere.
 *
 * `candidates` is optional and empty in production — nothing in the platform can supply one. Passing
 * any puts them through `admitProspectProblem` AND through the tenant check the gate cannot make on
 * its own, so the verdict reports what was refused and why; even an admissible statement leaves
 * `scorable` false, because the representation and the weight are the last unmet requirement and they
 * are not this module's to decide.
 */
export function assessProblemFitReadiness(
  sell: TenantSellSide | null,
  candidates: readonly ProspectProblemCandidate[] = [],
): ProblemFitReadiness {
  const sellSide = !sell ? 'unreadable' : sell.portfolioProblems.length ? 'available' : 'empty';

  const admissions = candidates.map((c, index) => ({ index, ...admitProspectProblem(c) }));

  // TENANT BOUNDARY. `admitProspectProblem` can only check that a subject IS tenanted; it has no
  // second tenant to compare against. Here there is one, so a problem belonging to a different
  // organization than the sell side being assessed is refused rather than counted — otherwise one
  // tenant's prospect statement would decide another tenant's readiness verdict. When the sell side
  // is unreadable there is nothing to compare to, and the candidate's own tenant is left to stand.
  const resolved = admissions.map((a) => {
    if (!a.admissible || !a.problem || !sell) return a;
    if (a.problem.organizationId === sell.organizationId) return a;
    return {
      index: a.index,
      admissible: false as const,
      problem: null,
      rejections: [
        ...a.rejections,
        {
          field: 'subject' as const,
          reason: `refused: the problem is tenanted to ${a.problem.organizationId} but the sell side `
            + `being assessed belongs to ${sell.organizationId}; a problem is only evidence for the `
            + 'tenant that observed it',
        },
      ],
    };
  });

  const rejected = resolved
    .filter((a) => !a.admissible)
    .map((a) => ({ index: a.index, rejections: a.rejections }));
  const admitted = resolved.filter((a) => a.admissible);

  const buySide = candidates.length === 0
    ? 'not_implemented'
    : admitted.length > 0 ? 'evidence_unscored' : 'no_admissible_evidence';

  const sellReason = sellSide === 'available'
    ? 'the sell side is derivable from the tenant profile'
    : sellSide === 'empty'
      ? 'the tenant profile states no customer problem'
      : 'the tenant has no company_profiles row, so the sell side cannot be read';
  const buyReason = buySide === 'not_implemented'
    ? 'the prospect side of the relation is not represented anywhere — no store examined records a problem the prospect stated'
    : buySide === 'no_admissible_evidence'
      ? 'every offered prospect problem was refused by the buy-side contract, so the prospect side stays unknown'
      : 'a prospect statement satisfies the evidence contract, but problem_fit still has no defined representation or weight, which is an owner decision';

  return {
    version: PROBLEM_FIT_CONTRACT_VERSION,
    sellSide,
    buySide,
    scorable: false,
    reason: `${sellReason}; ${buyReason}`,
    missing: PROBLEM_FIT_MISSING_BUY_SIDE,
    contract: PROBLEM_FIT_BUY_SIDE_CONTRACT,
    candidateStores: PROBLEM_FIT_CANDIDATE_STORES,
    rejected,
  };
}
