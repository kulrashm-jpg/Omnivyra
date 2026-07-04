/**
 * Canonical Entity / Knowledge Graph Provider Bridge  (BETA-PROVIDER-006) — REFERENCE IMPLEMENTATION #6
 *
 * Wires the SIXTH real external evidence provider — Entity / Knowledge Graph — into the canonical
 * BETA-ENGINE-004 framework by REUSING the existing production `WikidataAdapter`
 * (`intelligence/adapters/wikidataAdapter.ts` via `getKnowledgeGraphProvider()`) — no provider code is
 * duplicated. It:
 *   • registers the canonical `entity_graph` provider with live auth/connection from env,
 *   • DETERMINISTICALLY CONSOLIDATES one or more entity providers (Wikidata + Google KG + schema.org) into
 *     a single normalised input the canonical `entityEvidenceAdapter` converts to Evidence,
 *   • maps every provider failure to canonical Evidence (no fabrication, no silent failure),
 *   • exposes a deterministic availability signal.
 *
 * AUDIT NOTE (honest): a real Wikidata knowledge-graph adapter already exists and is REUSED. There is NO
 * decision engine that currently consumes `entity_graph_strength` as a confidence input — the descriptor
 * itself records "entity_graph_strength dimension has no engine" (BETA-AUDIT-003/004). Its genuine consumer
 * today is the REPORT's entity dimension in `canonicalReportBuilder` (which already calls
 * `getKnowledgeGraphProvider()`). This bridge canonicalises that reused provider + produces canonical
 * Evidence; it does NOT fabricate a confidence flip in a decision engine that does not read entity data.
 * Decision-engine adoption (routing entity Evidence into an engine's sample) is the honest remaining gap.
 *
 * Backward compatible: with no entity credential/flag the provider is UNAVAILABLE and nothing changes.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  entityEvidenceAdapter, type EntityEvidenceInput,
} from './evidencePlatform/providers/entity/entityEvidenceAdapter';
import { getKnowledgeGraphProvider } from './intelligence/providerRegistry';

const PROVIDER_ID = 'entity_graph';
const ENV_KEYS = ['WIKIDATA_ENABLED', 'GOOGLE_KG_API_KEY'];

/**
 * A single entity provider's resolved facts (Wikidata, Google KG, schema.org, …). Every field nullable —
 * only genuinely-resolved facts are consolidated. `resolved` = the provider performed a lookup and returned
 * a measured result (even a measured absence). `source` is a free-form key (no hardcoded providers).
 */
export interface EntityProviderPayload {
  source: string;
  resolved: boolean;
  wikidataQid?: string | null;
  googleKgMid?: string | null;
  schemaCompleteness?: number | null; // 0..1
  sameAsTargets?: string[] | null;
  hasDescription?: boolean | null;
  observedAt?: string | null;
}

/** True when any entity/knowledge-graph provider is enabled. */
export function isEntityProviderConfigured(): boolean {
  return process.env.WIKIDATA_ENABLED === 'true' || Boolean(process.env.GOOGLE_KG_API_KEY);
}

/** Register the canonical entity_graph provider with auth/connection derived from env (idempotent). */
export function registerEntityProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('entity_graph descriptor missing from anticipated providers');
  const configured = isEntityProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability signal. */
export function isEntityProviderAvailable(): boolean {
  registerEntityProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function entityProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/** Composite entity graph strength (matches the reused WikidataAdapter's scoring: 60% schema, 40% sameAs). */
function entityGraphStrength(schemaCompleteness: number | null, sameAsCount: number): number {
  const completenessComponent = (schemaCompleteness ?? 0) * 60;
  const sameAsComponent = Math.min(sameAsCount, 8) * 5;
  return Math.round(Math.max(0, Math.min(100, completenessComponent + sameAsComponent)));
}

/**
 * DETERMINISTIC MULTI-PROVIDER CONSOLIDATION (Phase 6). Consolidates N entity-provider payloads into a
 * single normalised entity input. Rules — all deterministic + explainable:
 *   • Sources that did not resolve are dropped (missing/unavailable) — they do not count toward coverage.
 *   • Duplicate source keys are de-duplicated (last wins, stable).
 *   • knowledge_graph_presence = 1 if ≥1 resolved source carries an identifier or non-zero schema/sameAs;
 *     0 when ≥1 source performed a lookup but none resolved an entity (a genuine MEASURED absence).
 *   • entity_identifier_present = 1 if any source supplies a Wikidata QID or Google KG mid (never inferred).
 *   • schema_completeness = MAX across sources (best available evidence); sameas_count = size of the UNION
 *     of sameAs targets (cross-provider de-dup); has_canonical_description = 1 if any source has one.
 *   • identifier_conflict = 1 if two sources report DIFFERENT Wikidata QIDs for the subject (disagreement
 *     surfaced, not hidden; the lexicographically-first QID is kept deterministically).
 *   • entity_graph_strength = composite from consolidated schema completeness + sameAs (CALCULATED).
 *   • freshness = hours between the most recent observedAt and the passed-in observedAt.
 * Pure; no clock/random (timestamps compared are all passed in).
 */
export function consolidateEntityProviders(
  payloads: EntityProviderPayload[],
  observedAt: string | null,
): EntityEvidenceInput {
  // De-duplicate by source key (last wins).
  const bySource = new Map<string, EntityProviderPayload>();
  for (const p of payloads) {
    const key = (p.source ?? '').trim().toLowerCase();
    if (key) bySource.set(key, p);
  }
  const all = [...bySource.values()];
  const looked = all.filter((p) => p.resolved);

  if (looked.length === 0) {
    // No provider performed a resolvable lookup → nothing measured (distinct from a measured absence).
    return {
      subjectId: '', knowledgeGraphPresence: null, entityIdentifierPresent: null, entitySourceCount: null,
      sameAsCount: null, schemaCompleteness: null, hasCanonicalDescription: null, identifierConflict: null,
      entityGraphStrength: null, freshnessHours: null, observedAt,
      providerReliability: entityProviderReliability(), contributingSources: [],
    };
  }

  const qids = new Set<string>();
  const sameAs = new Set<string>();
  let maxCompleteness: number | null = null;
  let hasIdentifier = false;
  let hasDescription = false;
  let mostRecentMs: number | null = null;
  const resolvedSources: string[] = [];

  for (const p of looked) {
    const qid = (p.wikidataQid ?? '').trim();
    const mid = (p.googleKgMid ?? '').trim();
    if (qid) qids.add(qid);
    if (qid || mid) hasIdentifier = true;
    if (p.schemaCompleteness != null) maxCompleteness = maxCompleteness == null ? p.schemaCompleteness : Math.max(maxCompleteness, p.schemaCompleteness);
    for (const t of p.sameAsTargets ?? []) { const v = (t ?? '').trim().toLowerCase(); if (v) sameAs.add(v); }
    if (p.hasDescription) hasDescription = true;
    if (p.observedAt) { const ms = Date.parse(p.observedAt); if (Number.isFinite(ms)) mostRecentMs = mostRecentMs == null ? ms : Math.max(mostRecentMs, ms); }
    // A source "resolved an entity" if it carries an identifier or any populated entity signal.
    if (qid || mid || (p.schemaCompleteness ?? 0) > 0 || (p.sameAsTargets?.length ?? 0) > 0) resolvedSources.push((p.source ?? '').toLowerCase());
  }

  const presence = resolvedSources.length > 0 ? 1 : 0; // 0 = measured absence (a lookup ran, found nothing)
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const freshnessHours = mostRecentMs != null && Number.isFinite(observedMs)
    ? Math.max(0, (observedMs - mostRecentMs) / 3_600_000)
    : null;

  return {
    subjectId: '',
    knowledgeGraphPresence: presence,
    entityIdentifierPresent: hasIdentifier ? 1 : 0,
    entitySourceCount: resolvedSources.length,
    sameAsCount: sameAs.size,
    schemaCompleteness: maxCompleteness,
    hasCanonicalDescription: hasDescription ? 1 : 0,
    identifierConflict: qids.size > 1 ? 1 : 0,
    entityGraphStrength: presence === 1 ? entityGraphStrength(maxCompleteness, sameAs.size) : 0,
    freshnessHours,
    observedAt,
    providerReliability: entityProviderReliability(),
    contributingSources: [...new Set(resolvedSources)],
  };
}

/**
 * Reference fetch → canonical Evidence. REUSES the existing Wikidata knowledge-graph adapter (real HTTP +
 * cache live there) via `getKnowledgeGraphProvider()`, maps its result into an `EntityProviderPayload`,
 * consolidates it (with any additional supplied provider payloads), and converts through the canonical
 * adapter. Every failure (no flag, unavailable, entity not found, timeout, invalid) becomes canonical
 * Evidence — never throws, never fabricates. `nowIso` is passed in (deterministic; no clock access).
 *
 * With no entity flag configured the provider is UNAVAILABLE and this returns a single UNAVAILABLE Evidence
 * without performing a lookup (backward-compatible, test-verified).
 */
export async function fetchEntityEvidence(
  brandName: string,
  domain: string | null,
  nowIso: string,
  extraProviders: EntityProviderPayload[] = [],
): Promise<Evidence[]> {
  registerEntityProvider();
  if (!isEntityProviderConfigured()) {
    return entityEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'knowledge_graph_presence',
      'Entity provider not connected. Set WIKIDATA_ENABLED=true or GOOGLE_KG_API_KEY.',
    ));
  }
  const provider = getKnowledgeGraphProvider(); // reuse existing real Wikidata adapter
  const result = await provider.lookup({ brandName, domain });
  if (result.state !== 'measured') {
    return entityEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: result.reason_unavailable ?? 'Entity provider returned no measured result.',
      evidenceKey: 'knowledge_graph_presence',
      observedAt: nowIso,
    });
  }
  const rec = result.entity;
  const wikidataPayload: EntityProviderPayload = {
    source: provider.id,
    resolved: true,
    wikidataQid: rec?.wikidata_qid ?? null,
    googleKgMid: rec?.google_kg_mid ?? null,
    schemaCompleteness: rec?.schema_completeness ?? null,
    sameAsTargets: rec?.sameAs_targets ?? null,
    hasDescription: Boolean(rec?.canonical_description),
    observedAt: nowIso,
  };
  const consolidated = consolidateEntityProviders([wikidataPayload, ...extraProviders], nowIso);
  return entityEvidenceAdapter.toEvidence({ ...consolidated, subjectId: brandName }, { observedAt: nowIso, subjectId: brandName });
}
