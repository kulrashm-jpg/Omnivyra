/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-004 · Phase C — Producer Isolation.
 *
 * An ISOLATED, additive canonical-shadow execution path, decoupled from the legacy REFRESH_FULL pipeline:
 *
 *     grounded evidence (facts + AI extraction) ─► produceCanonicalIdentity (A.5-certified) ─►
 *     persist ONLY report_settings.canonical_understanding ─► STOP
 *
 * It writes NO legacy identity field (industry, category, entity_archetype, industry_review), NO
 * refresh_history, and does NOT re-run any legacy classification. Every other report_settings key and every
 * top-level profile column is preserved byte-identical (the persist writer touches only the report_settings
 * column, and the pure merge preserves all sibling keys). Deterministic + idempotent GIVEN fixed evidence:
 * re-running with unchanged evidence produces an identical canonical record and performs zero additional
 * mutation (no-op skip).
 *
 * DORMANT / UNWIRED: importing this module changes no production behaviour. It is not called by the refresh
 * pipeline, not gated by any flag, and not invoked against production in this phase (Producer Isolation).
 * Shadow POPULATION (running it against tenants) is a separate, subsequent phase.
 */
import {
  produceCanonicalIdentity,
  writeInputsFromProfileAndExtraction,
  type ProfileFactsLike,
  type CanonicalIdentityRecord,
} from './canonicalIdentityProducer';

/** Grounded AI-extraction, in the shape the A.5 producer's write-path mapper consumes. */
export type ShadowExtraction =
  | Record<string, { value?: unknown; values?: unknown; source?: unknown } | undefined>
  | null;

/** The grounded evidence the isolated path consumes — profile FACTS + AI extraction. No derived identity. */
export interface ShadowEvidence {
  facts: ProfileFactsLike;
  extraction: ShadowExtraction;
}

export interface ShadowProduceResult {
  record: CanonicalIdentityRecord;
  /** Interpretive identity fields that abstained (no grounded evidence) — never fabricated. */
  abstained: string[];
}

const INTERPRETIVE_IDENTITY_FIELDS = ['category', 'business_model', 'provider_type', 'solution_domains'] as const;

/** Pure: run the deployed A.5 producer over grounded evidence and report abstentions. */
export function produceShadowCanonical(evidence: ShadowEvidence, asOf: string): ShadowProduceResult {
  const { record } = produceCanonicalIdentity(
    writeInputsFromProfileAndExtraction(evidence.facts, evidence.extraction, asOf),
  );
  const wv = record.understanding.facets.worldView.value ?? null;
  const present: Record<string, unknown> = {
    category: wv?.category,
    business_model: wv?.businessModel,
    provider_type: wv?.providerType,
    solution_domains: wv?.solutionDomains && wv.solutionDomains.length ? wv.solutionDomains : undefined,
  };
  const abstained = INTERPRETIVE_IDENTITY_FIELDS.filter((f) => present[f] == null);
  return { record, abstained };
}

/**
 * Pure isolation merge: returns report_settings with ONLY `canonical_understanding` set/replaced. Every
 * sibling key (market_pulse, entity_archetype, industry_review, refresh_history, …) is preserved verbatim.
 */
export function applyCanonicalUnderstandingOnly(
  existing: Record<string, unknown> | null | undefined,
  record: CanonicalIdentityRecord,
): Record<string, unknown> {
  return { ...(existing ?? {}), canonical_understanding: record };
}

/**
 * Round-trip-safe canonical serialization: recursively SORT object keys and drop `undefined`, so the value
 * is compared by structure/content — not by key insertion order. PostgreSQL `jsonb` does not preserve object
 * key order, so a snapshot read back after persistence has a different key order than the freshly-produced
 * record; a plain `JSON.stringify` comparison then spuriously differs and the idempotent no-op never fires.
 * Sorting both sides makes the comparison stable across a DB round-trip. (Arrays keep their order — order is
 * semantic there.)
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** Structural equality that survives PostgreSQL jsonb persistence (key-order- and undefined-insensitive). */
const sameCanonical = (a: unknown, b: unknown): boolean => stableStringify(a ?? null) === stableStringify(b ?? null);

/** Persistence seam. The writer MUST update only the report_settings column — never identity columns. */
export interface ShadowPersistDeps {
  readReportSettings: (companyId: string) => Promise<Record<string, unknown> | null>;
  writeReportSettings: (companyId: string, reportSettings: Record<string, unknown>) => Promise<void>;
}

export interface ShadowJobResult {
  companyId: string;
  executed: true;
  wrote: boolean;        // false ⇒ idempotent no-op (canonical already identical)
  abstained: string[];
  version: number;
  builtAt: string;
  durationMs: number;
}

/**
 * Orchestrate the isolated shadow job: produce canonical from grounded evidence, then persist ONLY
 * canonical_understanding — idempotently (skip the write when the canonical record is unchanged).
 */
export async function runCanonicalShadowJob(
  companyId: string,
  asOf: string,
  evidence: ShadowEvidence,
  deps: ShadowPersistDeps,
): Promise<ShadowJobResult> {
  const t0 = Date.now();
  const { record, abstained } = produceShadowCanonical(evidence, asOf);
  const existing = await deps.readReportSettings(companyId);
  const prior = (existing ?? {})['canonical_understanding'];
  if (sameCanonical(prior, record)) {
    return { companyId, executed: true, wrote: false, abstained, version: record.version, builtAt: record.built_at, durationMs: Date.now() - t0 };
  }
  await deps.writeReportSettings(companyId, applyCanonicalUnderstandingOnly(existing, record));
  return { companyId, executed: true, wrote: true, abstained, version: record.version, builtAt: record.built_at, durationMs: Date.now() - t0 };
}

/**
 * Production persistence deps (NOT invoked in this phase). Reads/writes ONLY the report_settings column;
 * it never sets industry/category/entity_archetype/industry_review/refresh_history/updated_at. Provided so
 * the subsequent shadow-population phase can wire the isolated job without re-deriving the isolation contract.
 */
export function makeSupabaseShadowDeps(sb: unknown): ShadowPersistDeps {
  // `sb` is the Supabase client. It is accepted as `unknown` and narrowed to the minimal surface this
  // function uses — matching the full SupabaseClient type here triggers TS2589 (excessively deep) and adds
  // no safety, since the implementation only ever touches the report_settings column.
  const client = sb as {
    from: (table: string) => {
      select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { report_settings?: Record<string, unknown> | null } | null }> } };
      update: (patch: { report_settings: Record<string, unknown> }) => { eq: (c: string, v: string) => Promise<unknown> };
    };
  };
  return {
    readReportSettings: async (companyId) => {
      const { data } = await client.from('company_profiles').select('report_settings').eq('company_id', companyId).maybeSingle();
      return (data?.report_settings as Record<string, unknown> | null) ?? null;
    },
    writeReportSettings: async (companyId, reportSettings) => {
      await client.from('company_profiles').update({ report_settings: reportSettings }).eq('company_id', companyId);
    },
  };
}
