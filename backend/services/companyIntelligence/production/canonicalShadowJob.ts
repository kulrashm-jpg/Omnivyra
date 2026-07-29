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

// ── Semantic idempotency — persist only when the MEANINGFUL company identity changes, never on metadata ──

/** The meaningful identity extracted from a canonical record — the ONLY thing that gates persistence. */
interface SemanticIdentity {
  category: string | null;
  segment: string | null;          // industry / market segment
  businessModel: string | null;
  providerType: string | null;
  solutionDomains: string[] | null;
  customerSegments: string[] | null;
  products: string[] | null;
  services: string[] | null;
  name: string | null;
  domain: string | null;
}

const normStr = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s ? s : null;
};
const normList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort(); // order-insensitive
  return out.length ? out : null;
};

/**
 * Extract the semantic identity from a canonical record. Deliberately EXCLUDES `built_at`, freshness
 * timestamps, evidence refs, version, producer, and every other metadata/observability field — those must
 * never trigger a write.
 */
function extractSemanticIdentity(rec: unknown): SemanticIdentity {
  const f = ((rec as { understanding?: { facets?: Record<string, { value?: Record<string, unknown> | null }> } })?.understanding?.facets) ?? {};
  const wv = (f.worldView?.value ?? {}) as Record<string, unknown>;
  const id = (f.identity?.value ?? {}) as Record<string, unknown>;
  const off = (f.offerings?.value ?? {}) as Record<string, unknown>;
  const cust = (f.customers?.value ?? {}) as Record<string, unknown>;
  const mp = (f.marketPosition?.value ?? {}) as Record<string, unknown>;
  return {
    category: normStr(wv.category),
    segment: normStr(mp.segment),
    businessModel: normStr(wv.businessModel),
    providerType: normStr(wv.providerType),
    solutionDomains: normList(wv.solutionDomains),
    customerSegments: normList(cust.segments),
    products: normList(off.products),
    services: normList(off.services),
    name: normStr(id.name),
    domain: normStr(id.domain),
  };
}

const grounded = (v: string | string[] | null): boolean => v !== null && (Array.isArray(v) ? v.length > 0 : v.length > 0);
const fieldEqual = (a: string | string[] | null, b: string | string[] | null): boolean =>
  (Array.isArray(a) || Array.isArray(b)) ? JSON.stringify(a) === JSON.stringify(b) : a === b;

export type EvolutionReason = 'INITIAL' | 'IMPROVED' | 'CHANGED' | 'IDENTICAL' | 'DEGRADATION_PROTECTED';

/**
 * Evidence-evolution persistence policy (per-field, composed to a whole-record decision):
 *   A  abstention → grounded  = IMPROVED  → persist (knowledge gained)
 *   B  grounded   → same       = no signal (semantically identical)
 *   C  grounded   → different  = CHANGED   → persist (identity evolved)
 *   D  grounded   → abstention = DEGRADATION → do NOT auto-overwrite (identity is never erased by a transient
 *                                              loss of evidence; a real change needs an explicit freshness policy)
 * Composition: ANY degradation (D) blocks the write even if other fields improved/changed — a later stable
 * extraction persists cleanly. Otherwise any improvement (A) or change (C) persists; a purely-identical or
 * metadata-only diff (built_at, freshness, ordering, evidence) does not.
 */
export function decideCanonicalPersistence(prior: unknown, next: unknown): { persist: boolean; reason: EvolutionReason } {
  if (prior == null) return { persist: true, reason: 'INITIAL' };
  const a = extractSemanticIdentity(prior);
  const b = extractSemanticIdentity(next);
  let improved = false, changed = false, degraded = false;
  for (const k of Object.keys(a) as Array<keyof SemanticIdentity>) {
    const pg = grounded(a[k]), ng = grounded(b[k]);
    if (!pg && ng) improved = true;                                 // A
    else if (pg && ng && !fieldEqual(a[k], b[k])) changed = true;   // C
    else if (pg && !ng) degraded = true;                            // D
  }
  if (degraded) return { persist: false, reason: 'DEGRADATION_PROTECTED' };
  if (improved || changed) return { persist: true, reason: changed ? 'CHANGED' : 'IMPROVED' };
  return { persist: false, reason: 'IDENTICAL' };
}

/** Persistence seam. The writer MUST update only the report_settings column — never identity columns. */
export interface ShadowPersistDeps {
  readReportSettings: (companyId: string) => Promise<Record<string, unknown> | null>;
  writeReportSettings: (companyId: string, reportSettings: Record<string, unknown>) => Promise<void>;
}

export interface ShadowJobResult {
  companyId: string;
  executed: true;
  wrote: boolean;        // false ⇒ semantic no-op (identity unchanged / metadata-only / degradation-protected)
  reason: EvolutionReason; // why the write did/didn't happen (observability)
  abstained: string[];
  version: number;
  builtAt: string;
  durationMs: number;
}

/**
 * Orchestrate the isolated shadow job: produce canonical from grounded evidence, then persist ONLY
 * canonical_understanding — with SEMANTIC idempotency. The write fires only when the meaningful company
 * identity evolves (improvement or change); metadata-only diffs (built_at, freshness, ordering, evidence)
 * and transient evidence degradations never trigger a write. See decideCanonicalPersistence.
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
  const decision = decideCanonicalPersistence(prior, record);
  if (!decision.persist) {
    return { companyId, executed: true, wrote: false, reason: decision.reason, abstained, version: record.version, builtAt: record.built_at, durationMs: Date.now() - t0 };
  }
  await deps.writeReportSettings(companyId, applyCanonicalUnderstandingOnly(existing, record));
  return { companyId, executed: true, wrote: true, reason: decision.reason, abstained, version: record.version, builtAt: record.built_at, durationMs: Date.now() - t0 };
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
