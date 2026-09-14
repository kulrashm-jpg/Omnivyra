/**
 * CPG-002 — grounding orchestration (§4, §5, §12, §14).
 *
 * Runs every available evidence source, pools the claims, and hands the COMPLETE
 * evidence set for each field to the CPG-001 resolver.
 *
 * ─── THE RULE IN §5 ────────────────────────────────────────────────────────
 * The orchestrator NEVER picks a winner. It does not take the first result, the
 * highest-tier result, or the freshest result. Ranking, conflict detection and
 * effective-value selection are the resolver's job, and it can only do that job
 * correctly if it sees everything at once — including the sources that disagree.
 * All this layer does is gather, tag, and pass along.
 *
 * ─── FAILURE ISOLATION (§12, §17) ──────────────────────────────────────────
 * Each source is wrapped. A source that throws, hangs on a bad page, or returns
 * garbage is recorded as `unavailable` and the run continues. One broken vendor
 * must never turn a partial profile into no profile.
 *
 * ─── NO SILENT OVERWRITE ───────────────────────────────────────────────────
 * The orchestrator never writes a profile value. It produces GroundedField
 * objects whose effective value the resolver chose, and the resolver's rule is
 * that a user claim always wins by default. Acquisition can therefore surface a
 * conflict but can never resolve one.
 *
 * Deterministic: sources run in declared order, claims are sorted stably, and
 * `asOf` is injected — identical inputs give byte-identical output.
 */

import type { EntitySignals, EvidenceClaim, GroundedField, UserClaim } from '../types';
import { resolve, buildConfirmationRequest } from '../claimResolution';
import type { ConfirmationRequest } from '../types';
import type { AcquisitionContext, EvidenceSource, UnavailableReason } from './evidenceSource';
import { coverageSummary } from './capabilityMatrix';
import { establishIdentity, enrichKnownEntity, type IdentityEstablishmentReport } from './identityEstablishment';

export interface SourceOutcome {
  sourceId: string;
  label: string;
  state: 'retrieved' | 'unavailable' | 'errored';
  reason?: UnavailableReason | 'threw';
  detail?: string;
  claimCount: number;
  documentsFetched: number;
}

export interface OrchestrationInput {
  companyId: string;
  knownEntity: EntitySignals;
  companyDomain: string | null;
  /** What the user told us, per field. Never overwritten. */
  userClaims: readonly UserClaim[];
  /** Fields to resolve even when no user claim and no evidence exist. */
  fieldsOfInterest: readonly string[];
  /** Fields Omnivyra derives rather than observes — resolved as SYNTHESIS. */
  synthesizedFields?: readonly string[];
  sources: readonly EvidenceSource[];
  fetcher: AcquisitionContext['fetcher'];
  userSuppliedUrls?: readonly string[];
  asOf: string;
  /**
   * CPG-010 §11 — run the identity pre-step (aliases + registry identities)
   * before any source. Default ON when a company domain is known; pass false to
   * resolve against the supplied knownEntity only.
   */
  establishIdentity?: boolean;
  /** Registry fair-access User-Agent (SEC asks for one), operator-configured. Never a credential. */
  registryUserAgent?: string;
}

export interface OrchestrationResult {
  companyId: string;
  asOf: string;
  sourceOutcomes: SourceOutcome[];
  /** CPG-010 — what the identity pre-step established, with its audit trail (null when not run). */
  identity: IdentityEstablishmentReport | null;
  /** The known entity every source and the resolver actually used. */
  knownEntity: EntitySignals;
  fields: GroundedField[];
  confirmationRequests: ConfirmationRequest[];
  coverage: {
    total: number;
    verified: number;
    reported: number;
    conflicting: number;
    unverified: number;
    userProvided: number;
    synthesized: number;
    /** Honest statement of what could not be reached at all. */
    acquisitionLimitation: string;
  };
}

/** Run one source with full isolation. Never throws. */
async function runSource(source: EvidenceSource, ctx: AcquisitionContext): Promise<{ outcome: SourceOutcome; claims: EvidenceClaim[] }> {
  const base = { sourceId: source.id, label: source.label };
  try {
    const available = await source.isAvailable();
    if (!available) {
      return { outcome: { ...base, state: 'unavailable', reason: 'no_credential', detail: 'source reports itself unavailable', claimCount: 0, documentsFetched: 0 }, claims: [] };
    }
    const result = await source.acquire(ctx);
    if (result.state === 'unavailable') {
      return { outcome: { ...base, state: 'unavailable', reason: result.reason, detail: result.detail, claimCount: 0, documentsFetched: 0 }, claims: [] };
    }
    return {
      outcome: { ...base, state: 'retrieved', claimCount: result.claims.length, documentsFetched: result.documentsFetched },
      claims: result.claims,
    };
  } catch (err) {
    // Isolation: a throwing source is an outcome, not an outage.
    return {
      outcome: { ...base, state: 'errored', reason: 'threw', detail: err instanceof Error ? err.message : String(err), claimCount: 0, documentsFetched: 0 },
      claims: [],
    };
  }
}

export async function orchestrateGrounding(input: OrchestrationInput): Promise<OrchestrationResult> {
  // ── CPG-010 §11: establish identity FIRST, so every source and the resolver
  // weigh evidence against the same established aliases and registry ids.
  let identity: IdentityEstablishmentReport | null = null;
  let knownEntity = input.knownEntity;
  if (input.establishIdentity !== false && input.companyDomain) {
    try {
      identity = await establishIdentity({
        canonicalDomain: input.companyDomain, fetcher: input.fetcher,
        retrievedAt: input.asOf, registryUserAgent: input.registryUserAgent,
        companyNames: [input.knownEntity.companyName, input.knownEntity.legalEntity,
          ...(input.knownEntity.registryIdentities ?? []).filter((i) => (i.role ?? 'subject') === 'subject').map((i) => i.legalName)]
          .filter((x): x is string => !!x),
        jurisdictions: input.knownEntity.jurisdictions ?? [],
        knownIdentifiers: [input.knownEntity.registryId, ...(input.knownEntity.registryIdentities ?? [])
          .filter((i) => (i.role ?? 'subject') === 'subject').map((i) => i.registryId)].filter((x): x is string => !!x),
      });
      knownEntity = enrichKnownEntity(input.knownEntity, identity);
    } catch {
      // Isolation: identity establishment failing leaves the supplied identity.
      identity = null;
    }
  }

  const ctx: AcquisitionContext = {
    companyId: input.companyId,
    knownEntity,
    companyDomain: input.companyDomain,
    asOf: input.asOf,
    fetcher: input.fetcher,
    userSuppliedUrls: input.userSuppliedUrls,
  };

  const sourceOutcomes: SourceOutcome[] = [];
  const allClaims: EvidenceClaim[] = [];
  for (const source of input.sources) {
    const { outcome, claims } = await runSource(source, ctx);
    sourceOutcomes.push(outcome);
    allClaims.push(...claims);
  }

  // Stable ordering so the run is byte-reproducible.
  allClaims.sort((a, b) => (a.field + a.claimId).localeCompare(b.field + b.claimId));

  const userByField = new Map(input.userClaims.map((c) => [c.field, c]));
  const evidenceByField = new Map<string, EvidenceClaim[]>();
  for (const c of allClaims) {
    const list = evidenceByField.get(c.field) ?? [];
    list.push(c);
    evidenceByField.set(c.field, list);
  }

  const synth = new Set(input.synthesizedFields ?? []);
  const fields = [...new Set([
    ...input.fieldsOfInterest,
    ...userByField.keys(),
    ...evidenceByField.keys(),
  ])].sort();

  const grounded: GroundedField[] = fields.map((field) =>
    // The resolver receives the COMPLETE evidence set — agreeing and disagreeing.
    resolve({
      companyId: input.companyId,
      field,
      kind: synth.has(field) ? 'SYNTHESIS' : 'FACT',
      userClaim: userByField.get(field) ?? null,
      evidence: evidenceByField.get(field) ?? [],
      knownEntity,
      companyDomain: input.companyDomain,
      asOf: input.asOf,
    }),
  );

  const confirmationRequests = grounded
    .map((g) => buildConfirmationRequest(g, input.companyDomain))
    .filter((r): r is ConfirmationRequest => r !== null);

  const count = (s: GroundedField['status']) => grounded.filter((g) => g.status === s).length;

  return {
    companyId: input.companyId,
    asOf: input.asOf,
    sourceOutcomes,
    identity,
    knownEntity,
    fields: grounded,
    confirmationRequests,
    coverage: {
      total: grounded.length,
      verified: count('PUBLICLY_VERIFIED'),
      reported: count('PUBLICLY_REPORTED'),
      conflicting: count('CONFLICTING'),
      unverified: count('UNVERIFIED'),
      userProvided: count('USER_PROVIDED'),
      synthesized: count('SYNTHESIZED'),
      acquisitionLimitation: coverageSummary().statement,
    },
  };
}
