/**
 * Canonical Creator Context Assembly — the ONE authoritative company + brand
 * context resolver for every Creator AI operation (Generate / Field Assist /
 * Rewrite / Improve / Expand / Shorten / future ops).
 *
 * No AI entry point performs its own company/brand lookup: they all consume
 * `resolveCreatorCopyContext` (which assembles from the TWO canonical sources —
 * `companyProfileService.getProfile` for business understanding and
 * `brandRuntime.resolveBrand` for brand identity / voice / vocabulary /
 * compliance). The renderer already consumes the SAME BrandRuntime for VISUAL
 * rendering — no duplicate models.
 *
 * Resolved ONCE per request and memoized (short TTL) so multiple downstream AI
 * operations in a request share the same resolved context.
 *
 * Best-effort + null-safe: any failure yields empty structures so callers fall
 * back to the prior (context-free) behavior — never throws.
 */

export interface CreatorCompanyContext {
  description?: string;
  products?: string[];
  audience?: string[];
  positioning?: string;
  differentiators?: string;
  industries?: string[];
  categories?: string[];
  /** Business objectives (growth priorities). */
  businessObjectives?: string[];
  /** Messaging pillars, when the profile carries them. */
  messagingPillars?: string[];
  /** Ideal-customer-profile summary (age group / use case / intent). */
  icp?: string;
}

export interface CreatorBrandVoice {
  tone?: string;
  descriptors?: string[];
  ctaStyle?: string;
  /** Forbidden words / phrases (never use). */
  prohibitedPhrases?: string[];
  /** Preferred / required terms (favour these). */
  requiredTerms?: string[];
  /** Compliance — claims that must never be made. */
  prohibitedClaims?: string[];
  /** Compliance — disclaimers that may be required. */
  disclaimers?: string[];
  /** Whether the brand operates in a regulated industry. */
  regulated?: boolean;
}

export interface CreatorCopyContext {
  company: CreatorCompanyContext;
  brandVoice: CreatorBrandVoice;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}
function list(v: unknown, fallbackCsv?: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (out.length > 0) return out.slice(0, 12);
  }
  const csv = typeof fallbackCsv === 'string' ? fallbackCsv : '';
  if (csv.trim()) {
    const out = csv.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (out.length > 0) return out.slice(0, 12);
  }
  return undefined;
}

function buildIcp(profile: Record<string, unknown>): string | undefined {
  const icp = (profile.icp && typeof profile.icp === 'object' ? profile.icp : {}) as Record<string, unknown>;
  const parts = [str(icp.age_group), str(icp.use_case), str(icp.user_intent)].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Resolve the canonical company context (business understanding).
 *
 * DELEGATED (Wave 1 item 6): the company-context resolution + field mapping now
 * live in the ONE canonical resolver (canonicalContentContextResolver). This
 * function preserves its exact contract — company-scoped, best-effort, null-safe
 * ({} on failure) — and remains memoized by companyId via resolveCreatorCopyContext.
 *
 * Objective Preservation (Wave 0): this resolver stays company-scoped and cached
 * by companyId (see resolveCreatorCopyContext, 30s TTL). It carries the company's
 * standing `businessObjectives` (growth priorities), NOT the user's per-request
 * campaign objective — that MUST stay per-request and is threaded separately via
 * the orchestrator input (generateHandler → orchestratorInput.objective →
 * creatorPromptComposer "Campaign objective:" line + blueprint intent.objective).
 * The canonical resolver's company mapping deliberately folds in NO per-request
 * objective, so nothing leaks across requests for the same company.
 */
export async function resolveCreatorCompanyContext(companyId: string): Promise<CreatorCompanyContext> {
  const { resolveCreatorCompany } = await import('@/backend/services/context/canonicalContentContextResolver');
  return resolveCreatorCompany(companyId);
}

/** Resolve the canonical brand voice + compliance (communication style) from BrandRuntime. */
export async function resolveCreatorBrandVoice(companyId: string): Promise<CreatorBrandVoice> {
  try {
    const { resolveBrand } = await import('../brand/brandRuntime');
    const rt = await resolveBrand(companyId);
    if (!rt) return {};
    const voice = (rt.voice ?? {}) as { tone?: string; descriptors?: string[]; ctaStyle?: string };
    const vocab = (rt.vocabulary ?? {}) as { prohibitedPhrases?: string[]; requiredTerms?: string[] };
    const comp = (rt.compliance ?? {}) as { regulated?: boolean; disclaimers?: string[]; prohibitedClaims?: string[] };
    return {
      tone: str(voice.tone),
      descriptors: list(voice.descriptors),
      ctaStyle: str(voice.ctaStyle),
      prohibitedPhrases: list(vocab.prohibitedPhrases),
      requiredTerms: list(vocab.requiredTerms),
      prohibitedClaims: list(comp.prohibitedClaims),
      disclaimers: list(comp.disclaimers),
      regulated: comp.regulated === true,
    };
  } catch {
    return {};
  }
}

/* ── Per-request memoization ─────────────────────────────────────────── */

const CONTEXT_CACHE = new Map<string, { value: CreatorCopyContext; expires: number }>();
const CONTEXT_TTL_MS = 30_000;

/**
 * Resolve BOTH canonical sources into one copy-grounding context, resolving
 * each underlying source exactly once and sharing it (short-TTL memo) so every
 * downstream AI operation in a request consumes the same assembled context.
 */
export async function resolveCreatorCopyContext(companyId: string): Promise<CreatorCopyContext> {
  const id = String(companyId || '').trim();
  if (!id) return { company: {}, brandVoice: {} };
  const now = Date.now();
  const hit = CONTEXT_CACHE.get(id);
  if (hit && hit.expires > now) return hit.value;

  const [company, brandVoice] = await Promise.all([
    resolveCreatorCompanyContext(id),
    resolveCreatorBrandVoice(id),
  ]);
  const value: CreatorCopyContext = { company, brandVoice };
  CONTEXT_CACHE.set(id, { value, expires: now + CONTEXT_TTL_MS });
  return value;
}

/** Canonical Context Assembly entry point (alias — same single implementation). */
export const assembleCreatorContext = resolveCreatorCopyContext;

/**
 * Canonical grounding block — the ONE company + brand-voice grounding used by
 * every Creator AI prompt (field assist + master generation). Returns the
 * brand-voice constraint lines (for the system prompt) and the company-context
 * lines (for the user prompt). The surrounding grounding is identical across
 * all operations; only the action/intent differs at the call site.
 */
export function buildCreatorGroundingBlock(input: {
  company?: CreatorCompanyContext;
  brandVoice?: CreatorBrandVoice;
}): { brandVoiceLines: string[]; companyLines: string[] } {
  const bv = input.brandVoice ?? {};
  const brandVoiceLines = [
    bv.tone ? `Brand tone: ${bv.tone}.` : '',
    Array.isArray(bv.descriptors) && bv.descriptors.length ? `Brand personality: ${bv.descriptors.join(', ')}.` : '',
    bv.ctaStyle ? `CTA style: ${bv.ctaStyle}.` : '',
    Array.isArray(bv.requiredTerms) && bv.requiredTerms.length ? `Prefer these terms when natural: ${bv.requiredTerms.join(', ')}.` : '',
    Array.isArray(bv.prohibitedPhrases) && bv.prohibitedPhrases.length ? `NEVER use these forbidden words/phrases: ${bv.prohibitedPhrases.join(', ')}.` : '',
    Array.isArray(bv.prohibitedClaims) && bv.prohibitedClaims.length ? `NEVER make these claims (compliance): ${bv.prohibitedClaims.join(', ')}.` : '',
  ].filter(Boolean);

  const co = input.company ?? {};
  const companyLines = [
    co.description ? `Business: ${co.description}` : '',
    Array.isArray(co.products) && co.products.length ? `Products/services: ${co.products.join(', ')}` : '',
    Array.isArray(co.audience) && co.audience.length ? `Target customers: ${co.audience.join(', ')}` : '',
    co.positioning ? `Positioning: ${co.positioning}` : '',
    co.differentiators ? `Differentiators: ${co.differentiators}` : '',
    Array.isArray(co.industries) && co.industries.length ? `Industry: ${co.industries.join(', ')}` : '',
    co.icp ? `Ideal customer profile: ${co.icp}` : '',
    Array.isArray(co.businessObjectives) && co.businessObjectives.length ? `Business objectives: ${co.businessObjectives.join(', ')}` : '',
    Array.isArray(co.messagingPillars) && co.messagingPillars.length ? `Messaging pillars: ${co.messagingPillars.join(', ')}` : '',
  ].filter(Boolean);

  return { brandVoiceLines, companyLines };
}

/** Test/maintenance: clear the per-request memo. */
export function __clearCreatorContextCache(): void {
  CONTEXT_CACHE.clear();
}
