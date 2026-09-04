/**
 * LI-4D — the source-neutral ingestion orchestrator.
 *
 * This is the single path every prospect record takes into the platform:
 *
 *   adapter.translate
 *     -> validate
 *     -> identity          (W1  resolveUnifiedPerson)
 *     -> account           (W4  resolveOrCreateAccount / attachPersonToAccount)
 *     -> prospect          (WS-1 resolveOrCreateProspect)
 *     -> provenance        (LI-2 ingestSourceRecord)
 *     -> duplicate parking (LI-4C detectAndParkDuplicates)
 *
 * ─── NO PROVIDER BRANCHES ─────────────────────────────────────────────────
 * There is no `if (source === 'apollo')` here and there never may be. The
 * orchestrator knows only the normalized contract; everything provider-specific
 * lives behind `LeadSourceAdapter.translate`. A test asserts this file mentions
 * no provider name, because the rule is only worth anything if it is enforced.
 *
 * ─── IT REUSES, IT DOES NOT REIMPLEMENT ───────────────────────────────────
 * Identity is W1's resolver — the sole resolve-or-create path. Provenance is
 * LI-2's boundary — the sole evidence store. Accounts are W4's resolver.
 * Duplicates are LI-4C's detector. This module owns the ORDER and the error
 * semantics, and not one of the rules.
 *
 * ─── PER-RECORD, NOT PER-BATCH ────────────────────────────────────────────
 * Every record succeeds or fails on its own. There is no transaction spanning a
 * batch: one malformed row out of five thousand must not discard the other
 * 4,999, and a partial success is reported as exactly that. No step is allowed
 * to report success it did not achieve.
 */

import { ingestSourceRecord } from '../prospectIdentity/ingestionBoundary';
import { resolveUnifiedPerson } from '../identityResolutionService';
import { resolveOrCreateAccount, attachPersonToAccount } from '../prospectIdentity/accountResolution';
import { resolveOrCreateProspect } from '../prospectIdentity/prospectResolution';
import { planProspectEnrichment, type EnrichmentPorts } from '../enrichment/service';
import { ingestionEnrichmentCoverage } from './enrichmentCoverage';
import { detectAndParkDuplicates } from '../prospectIdentity/personDuplicates';
import type { AccountAttributes } from '../prospectIdentity/attributes';
import {
  validateNormalizedRecord,
  type AdapterResult,
  type IngestionBatchResult,
  type IngestionRecordOutcome,
  type NormalizedAccount,
  type NormalizedIngestionRecord,
} from './contracts';
import { getLeadSourceAdapter, UnsupportedSourceError } from './registry';
import { evaluateFeatureFlag } from '../featureFlagService';

/** A batch bounded so a single call cannot be used to exhaust the platform. */
export const MAX_BATCH_SIZE = 1_000;

/**
 * The ingestion capability switch. Default OFF — absent, empty or unrecognised
 * all mean disabled, so a misconfiguration cannot open the write surface.
 *
 * Read on every call rather than captured at module load, so flipping the
 * variable takes effect on the next request in a warm process.
 *
 * Parsing is the repository's existing enablement convention
 * (`isCreatorRenderingEnabled`, `isCreatorWorkspaceLifecycleEnabled`): trimmed,
 * lower-cased, `'1'` or `'true'`. Not restated anywhere else — the HTTP routes
 * and the per-record gate below both call THIS function.
 */
export function isLeadIngestionEnabled(): boolean {
  const raw = String(process.env.ENABLE_LEAD_INGESTION ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * The ONE flag key that governs prospect ingestion per tenant.
 *
 * Declared once and exported so an operator, a route and a test all name the
 * same string. A second spelling anywhere would silently enable nobody.
 */
export const LEAD_INGESTION_FLAG_KEY = 'lead_ingestion';

/** Why ingestion was permitted or refused for one tenant. */
export interface IngestionGateDecision {
  readonly allowed: boolean;
  /** Machine-readable. Stable strings, safe to log. */
  readonly reason: string;
}

/**
 * THE canonical ingestion gate: the global kill switch AND the tenant's flag.
 *
 * ─── TWO SWITCHES, IN SERIES ──────────────────────────────────────────────
 * `ENABLE_LEAD_INGESTION` remains the outer kill switch and is checked FIRST,
 * because it is free: an operator who turns it off closes every tenant at once
 * without a single database read. Only when it is on does the tenant's own
 * `lead_ingestion` flag decide, so enabling one organisation never enables the
 * other thirty-nine.
 *
 * ─── IT INTRODUCES NO FLAG SYSTEM ─────────────────────────────────────────
 * Evaluation is `featureFlagService.evaluateFeatureFlag` over the existing
 * org-scoped `feature_flags` table — the same mechanism billing already uses in
 * production, with its own activation/rollback audit. Nothing here is
 * PI-specific inside that service, and no schema is added.
 *
 * ─── IT FAILS CLOSED, ALWAYS ──────────────────────────────────────────────
 * A missing tenant, a missing flag row, a disabled flag and a THROWN evaluation
 * error all return `allowed: false`. An ingestion gate that opened because a
 * lookup failed would be the one failure mode worth preventing above all
 * others, so the catch below denies rather than propagating.
 */
export async function resolveLeadIngestionGate(
  organizationId: string | null | undefined,
): Promise<IngestionGateDecision> {
  if (!isLeadIngestionEnabled()) {
    return { allowed: false, reason: 'global_kill_switch_off' };
  }
  const org = String(organizationId ?? '').trim();
  if (!org) {
    // A tenant-scoped gate cannot answer without a tenant. Refusing is the only
    // safe answer: the alternative is a global "yes" wearing tenant clothes.
    return { allowed: false, reason: 'organization_required' };
  }

  try {
    const result = await evaluateFeatureFlag({
      organizationId: org,
      flagKey: LEAD_INGESTION_FLAG_KEY,
      // Ingestion is per-ORGANISATION, not per-user, so there is no cohort key
      // to hash. A percentage rollout on this flag therefore resolves to
      // `cohort_key_required_for_percent_rollout` — a refusal, which is the
      // correct direction for a write surface.
      cohortKey: null,
    });
    return result.enabled
      ? { allowed: true, reason: `tenant_flag:${result.reason}` }
      : { allowed: false, reason: `tenant_flag:${result.reason}` };
  } catch (e) {
    return {
      allowed: false,
      reason: `flag_evaluation_failed:${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface IngestBatchInput {
  /** TENANT. Authoritative; a record claiming a different tenant is rejected. */
  organizationId: string;
  source: string;
  /** Verbatim provider records. Translated one at a time by the adapter. */
  records: Array<Record<string, unknown>>;
  /** Operational correlation only; carries no foreign key. */
  ingestionRunId?: string | null;
  /** Injected instant, so a run is reproducible. */
  now?: string;
}

const fail = (
  externalId: string | null,
  rejection: IngestionRecordOutcome['rejection'],
  error: unknown,
): IngestionRecordOutcome => ({
  externalId,
  ok: false,
  rejection,
  error: error instanceof Error ? error.message : String(error),
});

/**
 * The employer attributes a normalized record carries, in LI-1's vocabulary.
 *
 * ONE mapping, used by both the account-entity path and the person-entity
 * employer pass. Two copies would drift, and a firmographic silently dropped on
 * one path but not the other is the kind of divergence nothing would catch.
 */
function toAccountAttributeInput(account: NormalizedAccount | null | undefined): AccountAttributes {
  return {
    industry: account?.industry ?? null,
    employeeCount: account?.employeeCount ?? null,
    employeeBand: account?.employeeBand ?? null,
    countryCode: account?.countryCode ?? null,
    region: account?.region ?? null,
    city: account?.city ?? null,
    description: account?.description ?? null,
    annualRevenue: account?.annualRevenue ?? null,
    revenueBand: account?.revenueBand ?? null,
    foundedYear: account?.foundedYear ?? null,
    technologies: account?.technologies ?? null,
    fundingStage: account?.fundingStage ?? null,
    lastFundingAt: account?.lastFundingAt ?? null,
  };
}

/**
 * Whether the source said anything about the employer worth recording.
 *
 * Identity fields (`externalId`, `name`, `domain`, `websiteUrl`) are deliberately
 * NOT counted: they are what resolved the account, not claims about it. Without
 * this check every person record with an employer would write an empty source
 * record asserting nothing.
 */
function hasAccountAttributes(account: NormalizedAccount | null | undefined): boolean {
  if (!account) return false;
  return Object.values(toAccountAttributeInput(account)).some((v) => v !== null && v !== undefined);
}

/**
 * Resolve the prospect's EMPLOYER, when the source said anything about one.
 *
 * Returns `null` rather than throwing on insufficient evidence: most sources say
 * nothing useful about the employer, and that is not an ingestion failure. A
 * genuine resolver error IS a failure and propagates.
 */
async function resolveAccount(
  record: NormalizedIngestionRecord,
  at: string,
): Promise<string | null> {
  const a = record.account;
  if (!a) return null;
  if (!a.externalId && !a.domain && !a.websiteUrl) return null;

  const resolution = await resolveOrCreateAccount(record.organizationId, {
    source: record.source,
    sourceReference: a.externalId ?? null,
    domain: a.domain ?? null,
    name: a.name ?? null,
    legalName: a.legalName ?? null,
    websiteUrl: a.websiteUrl ?? null,
  }, at);

  // W4 refuses to act when the evidence points at more than one account. That
  // refusal is preserved here: an ambiguous employer is not silently picked.
  return resolution.outcome === 'ambiguous' ? null : resolution.accountId;
}

/**
 * Ingest ONE already-translated record through the full chain.
 *
 * Exported so a caller can drive a single record without constructing a batch;
 * the batch path uses it unchanged, so both take exactly the same route.
 */
export async function ingestNormalizedRecord(
  result: AdapterResult,
  options: {
    ingestionRunId?: string | null;
    now?: string;
    /**
     * WS-2 seam ports. OPTIONAL by design: without them no enrichment planning
     * happens and ingestion behaves exactly as before, so wiring the planner
     * adds no reads to the hot path and no new failure mode for callers that
     * do not want it. Enrichment is never a prerequisite for the canonical
     * Prospect — the plan is produced AFTER the Prospect already exists.
     */
    enrichmentPorts?: EnrichmentPorts;
    /** Attributes the caller's next action needs. Absent by default: inventing
     *  one here would be downstream sales logic WS-5/WS-8/WS-9 own. */
    requiredForNextAction?: readonly string[];
    /** Freshness policy. Absent means WS-2's documented default; WS-4 invents
     *  no business freshness period of its own. */
    stalenessDays?: number;
    /**
     * The batch's already-resolved tenant gate. Supplied by `ingestLeadBatch`
     * so one database read serves the whole batch instead of one per record.
     * Omitted by a caller driving a single record, in which case the gate is
     * resolved here — the surface is never left ungated either way.
     */
    gateDecision?: IngestionGateDecision;
  } = {},
): Promise<IngestionRecordOutcome> {
  const record = result.normalized;
  const at = options.now ?? new Date().toISOString();
  const externalId = record?.externalId ?? null;

  // ── CAPABILITY GATE ─────────────────────────────────────────────────────
  // Defence in depth, and the reason it lives HERE rather than in
  // `ingestLeadBatch`: this function is the single funnel every record passes
  // through, and it is exported for callers who drive one record without a
  // batch. Guarding the batch alone would leave that surface open.
  //
  // Evaluated per record and BEFORE the identity resolver — the first write of
  // the chain — so a flag flipped mid-batch stops the next record rather than
  // interrupting one already part-written. Nothing here is a rollback: it is
  // simply a boundary the write path has not yet crossed.
  //
  // The KILL SWITCH is re-read per record because it is free, which is what
  // preserves the mid-batch-flip guarantee exactly as before. The TENANT flag
  // is a database read, so a batch resolves it once and passes it in via
  // `gateDecision`; a caller driving a single record without a batch supplies
  // nothing and it is resolved here, so that surface stays closed.
  if (!isLeadIngestionEnabled()) {
    return fail(externalId, 'ingestion_disabled', new Error('lead ingestion is disabled'));
  }

  const gate = options.gateDecision
    ?? await resolveLeadIngestionGate(record?.organizationId);
  if (!gate.allowed) {
    return fail(
      externalId,
      'ingestion_disabled',
      new Error(`lead ingestion is not enabled for this tenant (${gate.reason})`),
    );
  }

  const invalid = validateNormalizedRecord(record);
  if (invalid) return fail(externalId, 'validation_failed', invalid);

  // ── IDENTITY ────────────────────────────────────────────────────────────
  // Resolved FIRST so the evidence can be stored already linked to its person.
  // W1's resolver is the sole resolve-or-create path; nothing here re-derives it.
  let personId: string | null = null;
  if (record.entityType === 'person') {
    try {
      const identity = await resolveUnifiedPerson({
        companyId: record.organizationId,
        email: record.person?.email ?? null,
        phone: record.person?.phone ?? null,
        externalKeys: (record.person?.externalKeys ?? {}) as Record<string, { external_id?: string }>,
      });
      personId = identity.unifiedPersonId;
    } catch (e) {
      return fail(externalId, 'identity_failed', e);
    }
  }

  // ── EMPLOYER ────────────────────────────────────────────────────────────
  let accountId: string | null = null;
  try {
    accountId = await resolveAccount(record, at);
    if (accountId && personId) await attachPersonToAccount(record.organizationId, personId, accountId);
  } catch (e) {
    return fail(externalId, 'account_resolution_failed', e);
  }

  // ── PROSPECT (WS-1) ─────────────────────────────────────────────────────
  // C-2 froze `canonical_leads` as the canonical Prospect, and until now this
  // orchestrator never produced one: it resolved a person, an account and
  // provenance and returned no prospect id, so BR-01 was unsatisfiable by
  // intake. This step closes that, and does nothing else — the rules live in
  // WS-1's resolver and are not restated here.
  //
  // Placed AFTER identity and employer so the Prospect can be anchored to an
  // already-resolved person, and BEFORE provenance so the source record is
  // written once the canonical row it describes exists.
  //
  // A record with no `externalId` yields `insufficient_evidence` and a null
  // prospectId. That is NOT a failure: partial records must still ingest, and
  // WS-1 refuses to synthesise an identity key precisely because a fabricated
  // one would mint a new Prospect on every replay. Only a genuine resolver
  // error fails the record, matching how employer resolution already behaves.
  let prospectId: string | null = null;
  try {
    const prospect = await resolveOrCreateProspect(record.organizationId, {
      externalLeadKey: record.externalId,
      source: record.source,
      personId,
      email: record.person?.email ?? null,
      phone: record.person?.phone ?? null,
      fullName: record.person?.fullName ?? null,
    }, at);
    prospectId = prospect.prospectId;
  } catch (e) {
    return fail(externalId, 'prospect_resolution_failed', e);
  }

  // ── ENRICHMENT PLAN (WS-2 seam) ─────────────────────────────────────────
  // Planning runs only when the caller supplied ports, and only once a
  // canonical Prospect exists — a plan is about a Prospect, and there is
  // nothing to plan for a record that resolved to none.
  //
  // It NEVER fails the record. A planning failure means we could not decide
  // what to enrich; the person, employer and evidence are still durable and
  // the record is still a successful ingestion. Reporting it as a failure
  // would discard good intake over an advisory step.
  let enrichmentPlan: IngestionRecordOutcome['enrichmentPlan'];
  if (options.enrichmentPorts && prospectId) {
    try {
      const { plan } = await planProspectEnrichment({
        organizationId: record.organizationId,
        prospectId,
        // Derived from the catalogue, never declared here. Today the enrichment
        // group holds no available source, so every gap is honestly reported as
        // no_available_source rather than pointed at an intake adapter.
        coverage: ingestionEnrichmentCoverage(),
        requiredForNextAction: options.requiredForNextAction,
        stalenessDays: options.stalenessDays,
        now: at,
      }, options.enrichmentPorts);
      enrichmentPlan = {
        planned: plan.toEnrich.length,
        counts: plan.counts,
        noAvailableSource: plan.fields.filter((f) => f.action === 'no_available_source').length,
        needsResolution: plan.fields.filter((f) => f.action === 'needs_resolution').length,
      };
    } catch (e) {
      enrichmentPlan = { planned: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── PROVENANCE ──────────────────────────────────────────────────────────
  // LI-2 owns redaction, payload hashing, assertion recording and the canonical
  // update rules. A provenance failure fails the record: evidence recorded
  // nowhere is a prospect nobody can explain.
  let ingestion;
  try {
    ingestion = await ingestSourceRecord({
      organizationId: record.organizationId,
      provider: record.source,
      entityType: record.entityType,
      sourceRecordId: record.externalId,
      rawPayload: result.raw ?? {},
      personId,
      accountId,
      observedAt: record.observedAt ?? null,
      ingestionRunId: options.ingestionRunId ?? null,
      personAttributes: record.entityType === 'person' ? {
        fullName: record.person?.fullName ?? null,
        firstName: record.person?.firstName ?? null,
        lastName: record.person?.lastName ?? null,
        jobTitle: record.person?.jobTitle ?? null,
        department: record.person?.department ?? null,
        seniority: record.person?.seniority ?? null,
        countryCode: record.person?.countryCode ?? null,
        region: record.person?.region ?? null,
        city: record.person?.city ?? null,
        timezone: record.person?.timezone ?? null,
      } : undefined,
      accountAttributes: record.entityType === 'account' ? toAccountAttributeInput(record.account) : undefined,
      confidence: record.confidence ?? null,
    }, at);
  } catch (e) {
    return fail(externalId, 'provenance_failed', e);
  }

  // ── EMPLOYER FIRMOGRAPHICS (P2C) ────────────────────────────────────────
  // A person record carries what the source said about the EMPLOYER too, and
  // the call above cannot store it: `ingestSourceRecord` is single-entity by
  // design — one entityType, one target table, one allowed column set. So the
  // employer's attributes get their own pass through the SAME boundary.
  //
  // This is not a second writer. It is the sanctioned writer, invoked a second
  // time for the second entity, and the schema was built for it: the source
  // record key is (organization_id, provider, source_entity_type,
  // source_record_id), so a person-entity row and an account-entity row coexist
  // by design rather than by collision.
  //
  // Two person records naming the same employer therefore produce two account
  // assertions. That is correct, not duplication: if they agree LI-2's RULE A
  // applies the value once, and if they disagree RULE B withholds it — which is
  // exactly the arbitration this evidence model exists to perform.
  if (accountId && record.entityType === 'person' && hasAccountAttributes(record.account)) {
    try {
      await ingestSourceRecord({
        organizationId: record.organizationId,
        provider: record.source,
        entityType: 'account',
        // The employer's OWN provider id when the source gave one; otherwise the
        // person record that asserted it, so the claim stays traceable to the
        // evidence that made it rather than being attributed to nothing.
        sourceRecordId: record.account?.externalId?.trim() || record.externalId,
        rawPayload: result.raw ?? {},
        personId: null,
        accountId,
        observedAt: record.observedAt ?? null,
        ingestionRunId: options.ingestionRunId ?? null,
        accountAttributes: toAccountAttributeInput(record.account),
        confidence: record.confidence ?? null,
      }, at);
    } catch (e) {
      // Consistent with the employer resolution above, which already fails a
      // record rather than proceeding with a half-known employer.
      return fail(externalId, 'provenance_failed', e);
    }
  }

  // ── DUPLICATE PARKING ───────────────────────────────────────────────────
  // LI-4C surfaces duplicates for review. It NEVER merges, and this call does
  // not change that: it parks candidates and reports how many.
  let duplicatesParked = 0;
  let duplicatesAlreadyOpen = 0;
  if (personId) {
    try {
      const dup = await detectAndParkDuplicates({
        organizationId: record.organizationId,
        personId,
        email: record.person?.email ?? null,
        phone: record.person?.phone ?? null,
        externalKeys: record.person?.externalKeys ?? null,
        sourceRecordId: ingestion.sourceRecordId,
      });
      duplicatesParked = dup.parked;
      duplicatesAlreadyOpen = dup.alreadyOpen;
    } catch (e) {
      // The evidence and the person are already durable, so this is NOT a
      // silent swallow: the record is reported as failed with the reason, and
      // the operator can see that detection — not ingestion — is what broke.
      return {
        externalId,
        ok: false,
        rejection: 'duplicate_detection_failed',
        error: e instanceof Error ? e.message : String(e),
        sourceRecordId: ingestion.sourceRecordId,
        personId,
        accountId,
        prospectId,
      };
    }
  }

  return {
    externalId,
    ok: true,
    sourceRecordId: ingestion.sourceRecordId,
    personId,
    accountId,
    prospectId,
    enrichmentPlan,
    provenanceOutcome: ingestion.outcome,
    canonicalApplied: ingestion.canonicalApplied,
    canonicalWithheld: ingestion.canonicalWithheld,
    duplicatesParked,
    duplicatesAlreadyOpen,
  };
}

/**
 * Ingest a batch from one source.
 *
 * Records are processed independently and sequentially. Sequential is
 * deliberate: concurrent writes for the same person would race on the identity
 * resolver's create path, and the database would resolve it via `23505`, but
 * doing it in order keeps the outcome list meaningful and the load predictable.
 */
export async function ingestLeadBatch(input: IngestBatchInput): Promise<IngestionBatchResult> {
  const { organizationId, source } = input;
  if (!organizationId?.trim()) {
    throw new Error('ingestLeadBatch: organizationId is required — ingestion is never tenant-less');
  }
  if (!source?.trim()) {
    throw new Error('ingestLeadBatch: source is required');
  }
  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length > MAX_BATCH_SIZE) {
    throw new Error(`ingestLeadBatch: ${records.length} records exceeds the ${MAX_BATCH_SIZE} limit for one batch`);
  }

  const at = input.now ?? new Date().toISOString();
  const outcomes: IngestionRecordOutcome[] = [];

  // ── TENANT GATE, ONCE PER BATCH ─────────────────────────────────────────
  // Resolved here rather than per record because it is a database read, and
  // passed down so every record is judged by the same decision. A refused
  // tenant fails the WHOLE batch before a single adapter runs — there is
  // nothing to translate for a tenant that may not ingest.
  const gateDecision = await resolveLeadIngestionGate(organizationId);
  if (!gateDecision.allowed) {
    return {
      organizationId,
      source,
      total: records.length,
      succeeded: 0,
      failed: records.length,
      outcomes: records.map(() => fail(
        null,
        'ingestion_disabled',
        new Error(`lead ingestion is not enabled for this tenant (${gateDecision.reason})`),
      )),
    };
  }

  // An unsupported source fails the WHOLE batch, and before anything is written:
  // there is no adapter, so not one record could be translated anyway.
  let adapter;
  try {
    adapter = getLeadSourceAdapter(source);
  } catch (e) {
    if (e instanceof UnsupportedSourceError) {
      return {
        organizationId,
        source,
        total: records.length,
        succeeded: 0,
        failed: records.length,
        outcomes: records.map(() => fail(null, 'unsupported_source', e)),
      };
    }
    throw e;
  }

  for (const raw of records) {
    let translated: AdapterResult;
    try {
      translated = adapter.translate(raw ?? {}, organizationId);
    } catch (e) {
      outcomes.push(fail(null, 'normalization_failed', e));
      continue;
    }

    // The batch's tenant is authoritative. An adapter that returns a different
    // one is a bug or an attack, and either way the record is refused rather
    // than written into whichever tenant it named.
    if (translated?.normalized?.organizationId !== organizationId) {
      outcomes.push(fail(
        translated?.normalized?.externalId ?? null,
        'validation_failed',
        `adapter returned tenant '${translated?.normalized?.organizationId}' for a batch owned by '${organizationId}'`,
      ));
      continue;
    }
    // Likewise the source: provenance must name the adapter that produced it.
    if (translated.normalized.source !== adapter.source) {
      outcomes.push(fail(
        translated.normalized.externalId ?? null,
        'validation_failed',
        `adapter '${adapter.source}' returned source '${translated.normalized.source}'`,
      ));
      continue;
    }

    outcomes.push(await ingestNormalizedRecord(translated, {
      ingestionRunId: input.ingestionRunId ?? null,
      now: at,
      // One decision for the batch. The kill switch is still re-read per
      // record inside, so a mid-batch flip still stops the next one.
      gateDecision,
    }));
  }

  const succeeded = outcomes.filter((o) => o.ok).length;
  return {
    organizationId,
    source,
    total: records.length,
    succeeded,
    failed: outcomes.length - succeeded,
    outcomes,
  };
}
