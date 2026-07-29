/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-006 · Phase C.5 — Grounded Evidence Acquisition Isolation.
 *
 * A standalone, reusable, side-effect-free service that acquires the grounded evidence the canonical
 * producer needs (facts + AI extraction) WITHOUT the legacy refinement pipeline and WITHOUT any mutation:
 *
 *     acquireGroundedEvidence(companyId)
 *        ├─ load profile facts (read-only)
 *        ├─ crawl website  (crawlWebsiteSources — reused, external read)
 *        ├─ clean evidence (cleanEvidenceWithAi — reused)
 *        ├─ LOOP-FREE archetype (inferEntityArchetype over a profile whose DERIVED identity is stripped)
 *        ├─ buildExtractionPrompt (reused; its profile arg is unused by design → `_currentProfile`)
 *        ├─ LLM extraction (runCompletionWithOperation — reused) → buildExtractionWithDefaults (reused)
 *        └─ return ShadowEvidence — STOP.  No writes. No persistence. No profile mutation.
 *
 * NOT coupled to refineProfileWithAI / buildRefinedPayload. Writes NO profile field, report_settings,
 * refresh_history, industry_review, or entity_archetype. The I/O steps (loadProfile/crawl/clean/model) are
 * injected so the composition is deterministic and unit-certifiable; a production factory wires the real,
 * already-existing components (no algorithm is duplicated). DORMANT/UNWIRED — importing changes nothing.
 */
import { inferEntityArchetype } from '../../companyProfile/entityArchetype';
import { buildExtractionPrompt } from '../../companyProfile/refinementPrompts';
import { buildExtractionWithDefaults } from '../../companyProfile/extractionSchema';
import { parseModelOutputOr } from '../../ai/safety/structuredOutputAdoption';
import type { CompanyProfile } from '../../companyProfileService';
import type { ProfileFactsLike } from './canonicalIdentityProducer';
import type { ShadowEvidence } from './canonicalShadowJob';

export type EvidenceSummary = { label: string; url: string; summary: string };

/** Injected I/O — every member is a READ; there is no write channel (structural no-mutation guarantee). */
export interface AcquisitionDeps {
  loadProfile: (companyId: string) => Promise<CompanyProfile | null>;
  crawl: (websiteUrl: string, existing: Set<string>) => Promise<EvidenceSummary[]>;
  cleanEvidence: (companyId: string | null, summaries: EvidenceSummary[]) => Promise<EvidenceSummary[]>;
  runModel: (args: { companyId: string; system: string; user: string }) => Promise<string | null>;
}

export interface AcquisitionObservability {
  companyId: string;
  durationMs: number;
  crawlStatus: 'ok' | 'empty' | 'skipped';
  llmStatus: 'ok' | 'failed';
  evidenceCount: number;
  abstentions: string[];        // interpretive identity fields the extraction did not ground
  validationFailures: string[]; // NO_WEBSITE / CRAWL_FAILED / CLEAN_FAILED / LLM_FAILED
}

export interface AcquisitionResult {
  evidence: ShadowEvidence | null; // null when unacquirable (no website)
  observability: AcquisitionObservability;
}

const INTERPRETIVE = ['category', 'industry', 'business_model', 'provider_type', 'solution_domains'] as const;

/**
 * LOOP-FREE profile: strip the DERIVED identity so the archetype (and therefore the extraction it guides)
 * is inferred exclusively from observable evidence + observable facts — never from the polluted stored
 * identity. This is an in-memory value only; nothing is persisted.
 */
export function toLoopFreeProfile(p: CompanyProfile): CompanyProfile {
  const rs: Record<string, unknown> = { ...((p.report_settings as Record<string, unknown> | null) ?? {}) };
  delete rs.entity_archetype;   // derived identity — never consumed
  delete rs.industry_review;    // derived identity — never consumed
  return { ...p, industry: '', category: '', report_settings: rs } as unknown as CompanyProfile;
}

function extractionFieldMissing(extraction: Record<string, unknown>, field: string): boolean {
  const f = (extraction[field] ?? extraction[`${field}_list`]) as { value?: unknown; values?: unknown; source?: unknown } | undefined;
  if (!f) return true;
  const grounded = (f.value != null && String(f.value).trim() !== '') || (Array.isArray(f.values) && f.values.length > 0);
  return !grounded || String(f.source ?? '').toLowerCase() === 'missing';
}

/**
 * Acquire grounded evidence for one company. Pure given the injected reads; no writes anywhere. Deterministic:
 * identical (profile, crawl, clean, model) inputs ⇒ identical ShadowEvidence.
 */
export async function acquireGroundedEvidence(companyId: string, deps: AcquisitionDeps): Promise<AcquisitionResult> {
  const t0 = Date.now();
  const validationFailures: string[] = [];
  const profile = await deps.loadProfile(companyId);
  if (!profile || !profile.website_url) {
    return {
      evidence: null,
      observability: { companyId, durationMs: Date.now() - t0, crawlStatus: 'skipped', llmStatus: 'failed', evidenceCount: 0, abstentions: [...INTERPRETIVE], validationFailures: ['NO_WEBSITE'] },
    };
  }
  const loopFree = toLoopFreeProfile(profile);

  let summaries: EvidenceSummary[] = [];
  try { summaries = await deps.crawl(profile.website_url, new Set<string>()); }
  catch { validationFailures.push('CRAWL_FAILED'); }

  const socialLines = (profile.social_profiles || []).map((e) => e?.url).filter(Boolean).map((u) => `- ${u}`);
  const withSocial: EvidenceSummary[] = socialLines.length
    ? [...summaries, { label: 'social_profiles', url: 'social_profiles', summary: `SOCIAL PROFILES FOUND:\n${socialLines.join('\n')}` }]
    : summaries;
  const crawlStatus: AcquisitionObservability['crawlStatus'] = withSocial.length ? 'ok' : 'empty';

  let cleaned: EvidenceSummary[] = withSocial;
  try { cleaned = await deps.cleanEvidence(companyId, withSocial); }
  catch { validationFailures.push('CLEAN_FAILED'); }
  const evidenceForExtraction = cleaned.length ? cleaned : withSocial;

  // LOOP-FREE archetype guidance — derived from observable evidence + loop-free facts only.
  const archetype = inferEntityArchetype({ profile: loopFree, evidence: evidenceForExtraction });
  const prompt = buildExtractionPrompt(evidenceForExtraction, loopFree, archetype);

  let llmStatus: AcquisitionObservability['llmStatus'] = 'ok';
  let raw: string | null = null;
  try { raw = await deps.runModel({ companyId, system: prompt.systemPrompt, user: prompt.userPrompt }); }
  catch { llmStatus = 'failed'; validationFailures.push('LLM_FAILED'); }

  const extraction = buildExtractionWithDefaults(
    parseModelOutputOr<Record<string, unknown>>(raw, {}, { surface: 'canonicalEvidenceAcquisition' }),
  ) as unknown as Record<string, unknown>;

  // Facts are LOOP-FREE: name/domain/products/competitors only — NEVER industry/category.
  const facts: ProfileFactsLike = {
    company_id: companyId,
    name: profile.name ?? undefined,
    website_url: profile.website_url ?? undefined,
    products_services: typeof profile.products_services === 'string' ? profile.products_services : undefined,
    products_services_list: (profile as unknown as { products_services_list?: string[] | null }).products_services_list ?? undefined,
    competitors_list: (profile as unknown as { competitors_list?: string[] | null }).competitors_list ?? undefined,
  };

  const abstentions = INTERPRETIVE.filter((f) => extractionFieldMissing(extraction, f));
  const evidence: ShadowEvidence = { facts, extraction: extraction as ShadowEvidence['extraction'] };
  return {
    evidence,
    observability: { companyId, durationMs: Date.now() - t0, crawlStatus, llmStatus, evidenceCount: evidenceForExtraction.length, abstentions, validationFailures },
  };
}

/**
 * Production deps factory — wires the EXISTING components (no duplication). NOT invoked in this phase.
 * Every member is a read / external-fetch / LLM call; none writes profile or report_settings.
 */
export function makeProductionAcquisitionDeps(
  getProfile: (companyId: string) => Promise<CompanyProfile | null>,
): AcquisitionDeps {
  return {
    loadProfile: getProfile,
    crawl: async (websiteUrl, existing) => {
      const { crawlWebsiteSources } = await import('../../companyProfile/refinementHelpers');
      const res = await crawlWebsiteSources(websiteUrl, existing);
      return res.summaries;
    },
    cleanEvidence: async (companyId, summaries) => {
      const { cleanEvidenceWithAi } = await import('../../companyProfile/refinementPrompts');
      return cleanEvidenceWithAi(companyId, summaries);
    },
    runModel: async ({ companyId, system, user }) => {
      const { runCompletionWithOperation } = await import('../../aiGatewayProvidersOps');
      const res = await runCompletionWithOperation({
        companyId, campaignId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        operation: 'profileExtraction',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      } as Parameters<typeof runCompletionWithOperation>[0]);
      return res.output;
    },
  };
}
