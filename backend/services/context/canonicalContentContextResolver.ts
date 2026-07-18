/**
 * canonicalContentContextResolver.ts — Wave 1 item 6: THE ONE canonical
 * content-context resolver.
 *
 * GOAL: every AI generation path resolves brand identity / campaign / objective /
 * audience / tone / business context through ONE service. Historically THREE
 * divergent assemblers existed:
 *   1) lib/content/companyContextBlockBuilders.ts        (generation prompt blocks)
 *   2) pages/api/content/quick-platform-adapt.ts local   (platform adaptation block)
 *   3) backend/services/creator/creatorCopyContextResolver.ts (creator overlay)
 *
 * This module is the SUPERSET that reproduces exactly what each of those three
 * emitted, so each becomes a thin delegator WITHOUT changing its externally
 * observable output shape (prompt blocks + allow-listed names stay equivalent).
 *
 * SOURCE OF TRUTH: everything reads through `getCanonicalProfile`
 * (canonicalProfileAdapter). This module NEVER performs its own profile lookup
 * logic — it only normalizes + renders.
 *
 * CONSOLIDATION, NOT REDESIGN: the render bodies below are moved verbatim from
 * the three assemblers. No wording changes, no new prompt fields, no scoring.
 *
 * NO IMPORT CYCLE: this module imports low-level helpers from their ORIGINAL
 * modules (entityArchetype / competitorSynthesis / companyStrategyPerspective)
 * and only a TYPE from companyContextBlockBuilders (erased at runtime). The three
 * delegators import runtime bindings FROM here — one direction only.
 */
import type {
  CompanyProfile,
  EntityArchetypeIntelligence,
  UserGuidedIntelligence,
} from '../companyProfile/types';
import type { CompanyIdentity } from '../../../lib/content/companyContextBlockBuilders';
import { buildArchetypePromptContext, isBusinessFirstOnlyArchetype } from '../companyProfile/entityArchetype';
import {
  buildStructuredCompetitorDimensionBlock,
  shouldUseAudienceLedSynthesis,
} from '../companyProfile/competitorSynthesis';
import { buildStrategyInstructions, extractStrategyProfile } from '../../../lib/content/companyStrategyPerspective';
import { getCanonicalProfile } from './canonicalProfileAdapter';

/* ── Creator overlay context types (re-exported; contract preserved) ──────── */

/** Company understanding consumed by the Creator copy-grounding overlay (#3). */
export interface CreatorCompanyContext {
  description?: string;
  products?: string[];
  audience?: string[];
  positioning?: string;
  differentiators?: string;
  industries?: string[];
  categories?: string[];
  businessObjectives?: string[];
  messagingPillars?: string[];
  icp?: string;
}

/* ── Adaptation block type (#2 — quick-platform-adapt) ────────────────────── */

/** The platform-adaptation company context block + allow-listed names (#2). */
export interface AdaptationCompanyContext {
  block: string;
  /** Brand / product / service names the model is allowed to use verbatim. */
  allowedNames: string[];
}

/* ── Normalized superset context ──────────────────────────────────────────── */

/**
 * The normalized, stable content-context shape every generation path can read.
 * A SUPERSET: it carries the primitives (brand / audience / tone / objective /
 * businessContext / identityNames) plus the fully-rendered per-caller artifacts
 * so each of the three callers can delegate without re-deriving anything.
 */
export interface NormalizedContentContext {
  companyId: string | null;
  /** Raw canonical profile (as returned by getCanonicalProfile). */
  profile: CompanyProfile | null;
  /** Extracted generation identity (input to the generation prompt builders). */
  identity: CompanyIdentity;
  /** Brand / company name. */
  brand: string;
  /** Allow-listed brand/product/service names (company name + products list). */
  identityNames: string[];
  /** Target audience (freeform). */
  audience: string;
  /** Brand voice / tone. */
  tone: string;
  /**
   * Per-request campaign objective (optional). NEVER sourced from the profile —
   * only from the caller's per-request input. Absent ⇒ null.
   */
  objective: string | null;
  /** Business context summary (products/services, else unique value). */
  businessContext: string;
  /** Creator overlay company context (#3 mapping). */
  creatorCompany: CreatorCompanyContext;
  /** Generation company-context prompt block (#1 buildCompanyContextBlock). */
  contextBlock: string;
  /** Platform-adaptation block + allow-list (#2), or null when profile is empty. */
  adaptation: AdaptationCompanyContext | null;
}

/* ── Small null-safe helpers (shared internally) ──────────────────────────── */

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

/* ── Generation identity extraction (moved verbatim from #1) ──────────────── */

/**
 * Extract the generation CompanyIdentity from a CompanyProfile. Canonical home
 * for this logic — companyContextBlockBuilders re-exports it for compatibility.
 */
export function extractCompanyIdentity(profile: CompanyProfile | null | undefined): CompanyIdentity {
  if (!profile) return {};
  return {
    companyName: profile.name || undefined,
    industry: profile.industry || undefined,
    targetAudience: profile.target_audience || undefined,
    idealCustomerProfile: profile.ideal_customer_profile || undefined,
    coreProblem: profile.core_problem_statement || undefined,
    painPoints: profile.pain_symptoms?.filter(Boolean) || undefined,
    uniqueValue: profile.unique_value || undefined,
    productsServices: profile.products_services || undefined,
    desiredTransformation: profile.desired_transformation || undefined,
    competitiveAdvantages: profile.competitive_advantages || undefined,
    authorityDomains: profile.authority_domains?.filter(Boolean) || undefined,
    keyMessages: profile.key_messages || undefined,
    brandVoice: profile.brand_voice || undefined,
    strategyProfile: extractStrategyProfile(profile),
    entityArchetype: profile.report_settings?.entity_archetype ?? null,
    competitorIntelligence: profile.report_settings?.competitor_intelligence ?? null,
    userGuidance: profile.report_settings?.user_guidance ?? null,
  };
}

/** Peer-intelligence identity cues (moved verbatim from #1). */
export function buildCompetitorIdentityContext(identity: CompanyIdentity): string {
  if (!shouldUseAudienceLedSynthesis(identity.entityArchetype, identity.competitorIntelligence ?? null)) return '';
  return buildStructuredCompetitorDimensionBlock(identity.competitorIntelligence ?? null);
}

/** User-approved identity guidance (moved verbatim from #1). */
export function buildUserGuidedIdentityContext(identity: CompanyIdentity): string {
  const guidance = identity.userGuidance;
  if (!guidance) return '';
  const lines: string[] = [];
  for (const [section, field] of Object.entries(guidance.messaging ?? {})) {
    const value = field?.edited_value ?? field?.approved_value ?? field?.guidance;
    if (value) lines.push(`${section.replace(/_/g, ' ')}: ${value}`);
  }
  for (const note of guidance.guidance_notes ?? []) {
    if (note.status === 'archived' || !note.text) continue;
    lines.push(`guidance: ${note.text}`);
  }
  return lines.slice(0, 6).join('\n');
}

/**
 * Canonical Company Context Block — the block used in EVERY generation prompt.
 * Moved verbatim from #1's buildCompanyContextBlock; that export now delegates
 * here. Output is byte-identical for a given identity.
 */
export function buildContextBlock(identity: CompanyIdentity): string {
  const archetypeContext = isBusinessFirstOnlyArchetype(identity.entityArchetype)
    ? ''
    : buildArchetypePromptContext(identity.entityArchetype);
  const competitorIdentityContext = buildCompetitorIdentityContext(identity);
  const userGuidanceContext = buildUserGuidedIdentityContext(identity);
  const lines = [
    identity.companyName ? `COMPANY: ${identity.companyName}` : null,
    archetypeContext ? `ENTITY ARCHETYPE: ${archetypeContext}` : null,
    competitorIdentityContext ? `PEER INTELLIGENCE: ${competitorIdentityContext}` : null,
    userGuidanceContext ? `USER-APPROVED IDENTITY GUIDANCE: ${userGuidanceContext}` : null,
    identity.industry ? `INDUSTRY: ${identity.industry}` : null,
    identity.targetAudience ? `TARGET AUDIENCE: ${identity.targetAudience}` : null,
    identity.idealCustomerProfile ? `IDEAL CUSTOMER (ICP): ${identity.idealCustomerProfile}` : null,
    identity.coreProblem ? `CORE PROBLEM: ${identity.coreProblem}` : null,
    identity.painPoints?.length ? `PAIN POINTS: ${identity.painPoints.slice(0, 5).join('; ')}` : null,
    identity.uniqueValue ? `UNIQUE VALUE: ${identity.uniqueValue}` : null,
    identity.productsServices ? `PRODUCTS/SERVICES: ${identity.productsServices}` : null,
    identity.desiredTransformation ? `TRANSFORMATION: ${identity.desiredTransformation}` : null,
    identity.competitiveAdvantages ? `DIFFERENTIATORS: ${identity.competitiveAdvantages}` : null,
    identity.authorityDomains?.length ? `AUTHORITY DOMAINS: ${identity.authorityDomains.slice(0, 5).join(', ')}` : null,
    identity.keyMessages ? `KEY MESSAGES: ${identity.keyMessages}` : null,
    identity.brandVoice ? `BRAND VOICE: ${identity.brandVoice} — write every sentence in this voice.` : null,
    identity.strategyProfile ? buildStrategyInstructions(identity.strategyProfile) : null,
  ].filter(Boolean);

  if (lines.length === 0) return '';
  return lines.join('\n');
}

/* ── Allow-listed identity names (shared by #2 + normalized context) ──────── */

/**
 * The allow-list of brand/product/service names the model may use verbatim.
 * Source of truth: the company name plus every entry in products_services_list
 * (the structured list). The freeform products_services string is intentionally
 * excluded (prose, not names). Dedup is case-insensitive; order is preserved.
 * Moved verbatim from #2's inline allow-list construction.
 */
export function extractIdentityNames(profile: CompanyProfile | null): string[] {
  const seen = new Set<string>();
  const allowedNames: string[] = [];
  const pushName = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return;
    const cleaned = raw.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    allowedNames.push(cleaned);
  };
  if (profile) {
    pushName(profile.name);
    if (Array.isArray(profile.products_services_list)) {
      for (const entry of profile.products_services_list) pushName(entry);
    }
  }
  return allowedNames;
}

/**
 * Platform-adaptation company context block (#2). Reproduces exactly the
 * route-local buildCompanyContextBlock: the labelled field lines (280-char
 * truncation + ellipsis), the allow-list, and the appended "Allowed product /
 * brand names" line. Returns null when there is nothing to render — identical
 * to the original contract.
 */
export function buildAdaptationContextBlock(profile: CompanyProfile | null): AdaptationCompanyContext | null {
  if (!profile) return null;
  const fields: Array<[string, string | null | undefined]> = [
    ['Company', profile.name],
    ['Industry', profile.industry],
    ['Website', profile.website_url],
    ['Products / services', profile.products_services],
    ['Target audience', profile.target_audience],
    ['Geography', profile.geography],
    ['Brand voice', profile.brand_voice],
    ['Unique value', profile.unique_value],
    ['Brand positioning', profile.brand_positioning],
    ['Key messages', profile.key_messages],
  ];
  const rendered = fields
    .map(([label, value]) => {
      if (!value || typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const compact = trimmed.length > 280 ? `${trimmed.slice(0, 277).trimEnd()}…` : trimmed;
      return `- ${label}: ${compact}`;
    })
    .filter((line): line is string => line !== null);

  const allowedNames = extractIdentityNames(profile);

  if (rendered.length === 0 && allowedNames.length === 0) return null;

  if (allowedNames.length > 0) {
    rendered.push(`- Allowed product / brand names (use ONLY these, copy verbatim): ${allowedNames.map((n) => `"${n}"`).join(', ')}`);
  }

  return { block: rendered.join('\n'), allowedNames };
}

/* ── Creator overlay company context (#3 mapping) ─────────────────────────── */

/**
 * Map a canonical profile → Creator overlay company context. Moved verbatim
 * from #3's resolveCreatorCompanyContext body (the read is company-scoped; NO
 * per-request objective is folded in — it only carries the standing
 * businessObjectives / growth priorities).
 */
export function mapCreatorCompanyContext(profile: CompanyProfile | null): CreatorCompanyContext {
  if (!profile) return {};
  const p = profile as unknown as Record<string, unknown>;
  return {
    description: str(p.description),
    products: list(p.products_services_list, p.products_services),
    audience: list(p.target_audience_list, p.target_audience),
    positioning: str(p.brand_positioning) ?? str(p.product_positioning),
    differentiators: str(p.biggest_advantage) ?? str(p.competitive_advantages),
    industries: list(p.industry_list, p.industry),
    categories: list(p.category_list, p.category),
    businessObjectives: list(p.growth_priorities),
    messagingPillars: list(p.messaging_pillars, p.recommendation_context),
    icp: buildIcp(p),
  };
}

/**
 * Company-scoped Creator overlay resolution. Best-effort + null-safe: any
 * failure yields {} so callers fall back to context-free behavior (never
 * throws). Reads through getCanonicalProfile with autoRefine:false — identical
 * to the historical #3 behavior.
 */
export async function resolveCreatorCompany(companyId: string): Promise<CreatorCompanyContext> {
  try {
    const profile = (await getCanonicalProfile(companyId, { autoRefine: false })) as CompanyProfile | null;
    return mapCreatorCompanyContext(profile);
  } catch {
    return {};
  }
}

/* ── Normalized resolution ────────────────────────────────────────────────── */

export interface ResolveContentContextOptions {
  /** Per-request campaign objective. Company-scoped reads NEVER cache this. */
  objective?: string | null;
  /** Optional per-request campaign label (reserved; not folded into cache). */
  campaign?: string | null;
  /** Passed through to getCanonicalProfile. */
  autoRefine?: boolean;
}

/**
 * Pure normalization: profile (+ per-request opts) → the stable superset. Kept
 * separate from resolveContentContext so it is deterministic + unit-testable
 * without a profile fetch.
 */
export function normalizeContentContext(
  profile: CompanyProfile | null,
  opts?: ResolveContentContextOptions,
  companyId?: string | null,
): NormalizedContentContext {
  const identity = extractCompanyIdentity(profile);
  const objectiveRaw = opts?.objective;
  const objective = typeof objectiveRaw === 'string' && objectiveRaw.trim() ? objectiveRaw.trim() : null;
  return {
    companyId: companyId ?? null,
    profile: profile ?? null,
    identity,
    brand: str(profile?.name) ?? '',
    identityNames: extractIdentityNames(profile),
    audience: str(profile?.target_audience) ?? '',
    tone: str(profile?.brand_voice) ?? '',
    objective,
    businessContext: str(profile?.products_services) ?? str(profile?.unique_value) ?? '',
    creatorCompany: mapCreatorCompanyContext(profile),
    contextBlock: buildContextBlock(identity),
    adaptation: buildAdaptationContextBlock(profile),
  };
}

/**
 * THE canonical resolution entry point. Fetches the canonical profile once
 * (through getCanonicalProfile — the single source) and normalizes it into the
 * superset context every generation path can consume. Best-effort: a failed
 * fetch yields the empty-profile normalization rather than throwing.
 */
export async function resolveContentContext(
  companyId?: string | null,
  opts?: ResolveContentContextOptions,
): Promise<NormalizedContentContext> {
  const id = String(companyId ?? '').trim() || null;
  let profile: CompanyProfile | null = null;
  if (id) {
    try {
      profile = (await getCanonicalProfile(id, { autoRefine: opts?.autoRefine ?? false })) as CompanyProfile | null;
    } catch {
      profile = null;
    }
  }
  return normalizeContentContext(profile, opts, id);
}
