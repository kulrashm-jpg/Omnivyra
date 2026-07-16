/**
 * contextAssimilationEngine.ts — CONTENT-INTELLIGENCE-002 Phase 2 (the ONLY
 * source-dependent module). Assimilates all reliably-available business
 * knowledge into ONE deterministic CanonicalContext, then runs the pure
 * quality / transparency / evidence engines over it.
 *
 * Sources (fail-open, best-effort per source):
 *   - company profile (authoritative row + report_settings.discovered_metadata +
 *     report_settings.market_pulse) via getProfile({autoRefine:false}).
 *   - recent published content (contentHistory).
 *   Competitive/SEO/market are absent for most companies (inert in prod) and are
 *   honestly reported as missing unless present in report_settings.
 *
 * Determinism: `now` and the source loaders are injectable, so the same inputs
 * always produce the same object (assembledAt excluded).
 */
import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import {
  type CanonicalContext,
  type ContextOrigin,
  type Fact,
} from './canonicalContextTypes';
import { makeFact } from './freshness';
import { mergeListFacts, pickBest } from './contextMerge';
import { computeContextQuality } from './contextQualityEngine';
import { computeTransparency } from './groundingTransparency';
import { buildEvidenceIntelligence } from './evidenceIntelligence';

type AnyRecord = Record<string, unknown>;

export interface RecentContentItem { title: string; published_at?: string | null }

export interface AssimilationDeps {
  loadProfile?: (companyId: string) => Promise<AnyRecord | null>;
  loadRecentContent?: (companyId: string) => Promise<RecentContentItem[]>;
  now?: number;
}

// ── Field helpers (defensive; bridge scalar + `_list` vocabularies) ────────────

function str(profile: AnyRecord, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = profile[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function list(profile: AnyRecord, ...keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const v = profile[k];
    const values = Array.isArray(v)
      ? v
      : typeof v === 'string' && v.trim()
      ? v.split(/[;,\n]/)
      : [];
    for (const raw of values) {
      const s = String(raw).trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function reportSettings(profile: AnyRecord): AnyRecord {
  const rs = profile.report_settings;
  return rs && typeof rs === 'object' ? (rs as AnyRecord) : {};
}

/** Best available profile freshness (last_refined_at → updated_at → created_at). */
function profileFreshness(profile: AnyRecord): string | null {
  return str(profile, 'last_refined_at', 'updated_at', 'created_at');
}

// ── Default source loaders ─────────────────────────────────────────────────────

async function defaultLoadProfile(companyId: string): Promise<AnyRecord | null> {
  try {
    const { getProfile } = await import('../companyProfileServiceRest1Rest2Pulse');
    // autoRefine:false — a grounding read must never trigger an AI write / crawl.
    const p = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    return (p as AnyRecord) ?? null;
  } catch (err) {
    logger.warn('context_assimilation_profile_load_failed', {
      companyId, message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function defaultLoadRecentContent(companyId: string): Promise<RecentContentItem[]> {
  try {
    const { data } = await supabase
      .from('blogs')
      .select('title, published_at, status')
      .eq('company_id', companyId)
      .order('published_at', { ascending: false })
      .limit(10);
    return (data ?? [])
      .map((r) => ({ title: String((r as AnyRecord).title ?? '').trim(), published_at: (r as AnyRecord).published_at as string | null }))
      .filter((r) => r.title);
  } catch {
    return [];
  }
}

// ── Assimilation ───────────────────────────────────────────────────────────────

export async function assimilateContext(
  companyId: string,
  deps: AssimilationDeps = {},
): Promise<CanonicalContext> {
  const now = deps.now ?? Date.now();
  const loadProfile = deps.loadProfile ?? defaultLoadProfile;
  const loadRecentContent = deps.loadRecentContent ?? defaultLoadRecentContent;

  const [profile, recentContent] = await Promise.all([
    loadProfile(companyId),
    loadRecentContent(companyId).catch(() => [] as RecentContentItem[]),
  ]);

  const p = profile ?? {};
  const rs = reportSettings(p);
  const mp = (rs.market_pulse && typeof rs.market_pulse === 'object' ? rs.market_pulse : {}) as AnyRecord;
  const dm = (rs.discovered_metadata && typeof rs.discovered_metadata === 'object' ? rs.discovered_metadata : {}) as AnyRecord;

  const pFresh = profileFreshness(p);
  // Profile confidence: use stored overall_confidence when present, else a
  // conservative default. Deterministic.
  const overall = typeof p.overall_confidence === 'number' ? p.overall_confidence : null;
  const pConf = overall !== null ? Math.min(1, Math.max(0.4, overall > 1 ? overall / 100 : overall)) : 0.75;

  const F = <T>(value: T | null | undefined, origin: ContextOrigin, conf: number, ts: string | null): Fact<T> | null =>
    makeFact(value, origin, conf, ts, now);

  // Business identity
  const name = str(p, 'name');
  const industryVal = str(p, 'industry') ?? (list(p, 'industry_list')[0] ?? null);
  const categoryVal = str(p, 'category') ?? (list(p, 'category_list')[0] ?? null);
  const identityText = name ? `${name}${categoryVal || industryVal ? ` — ${categoryVal ?? industryVal}` : ''}` : null;

  const offerings = mergeListFacts([
    F(list(p, 'products_services_list', 'products_services'), 'profile', pConf, pFresh),
    F(list(mp, 'core_offerings', 'solution_domains'), 'profile', 0.7, pFresh),
  ]);

  const differentiators = mergeListFacts([
    F(list(p, 'competitive_advantages'), 'profile', pConf, pFresh),
    F(str(p, 'unique_value') ? [str(p, 'unique_value')!] : [], 'profile', pConf, pFresh),
  ]);

  const websiteText = str(dm, 'description', 'title') ?? str(p, 'website_url');

  const competitive = list(mp, 'named_competitors');
  const marketSignals = list(mp, 'primary_markets', 'target_markets', 'market_alternatives');

  const ctxBase: Omit<CanonicalContext, 'quality' | 'transparency' | 'evidenceIntelligence' | 'knownGaps'> = {
    companyId,
    businessIdentity: F(identityText, 'profile', pConf, pFresh),
    offerings,
    differentiators,
    icp: F(str(p, 'ideal_customer_profile', 'target_customer_segment', 'target_audience'), 'profile', pConf, pFresh),
    personas: F(list(p, 'target_audience_list'), 'profile', pConf, pFresh),
    painPoints: F(list(p, 'pain_symptoms').concat(str(p, 'core_problem_statement') ? [str(p, 'core_problem_statement')!] : []), 'profile', pConf, pFresh),
    customerGoals: F(list(p, 'goals_list', 'goals'), 'profile', pConf, pFresh),
    industry: F(industryVal, 'profile', pConf, pFresh),
    marketPosition: F(str(p, 'brand_positioning') ?? str(mp, 'business_model'), 'profile', pConf, pFresh),
    brandPositioning: F(str(p, 'brand_positioning', 'brand_voice') ?? (list(p, 'brand_voice_list')[0] ?? null), 'profile', pConf, pFresh),

    evidence: null, // no dedicated case-study/testimonial store exists (see audit)
    contentHistory: F(recentContent.map((c) => c.title).slice(0, 8), 'content_history', 0.7, recentContent[0]?.published_at ?? null),
    strategicDirection: F(list(p, 'content_themes_list', 'content_themes').concat(str(p, 'campaign_focus') ? [str(p, 'campaign_focus')!] : []), 'profile', pConf, pFresh),
    campaignHistory: null,        // wired best-effort later (campaignLearningService)
    performanceLearnings: null,
    currentInitiatives: F(list(p, 'growth_priorities'), 'profile', pConf, pFresh),

    websiteIntelligence: F(websiteText, dm && Object.keys(dm).length ? 'website' : 'profile', 0.7, str(dm, 'discovered_at') ?? pFresh),
    competitiveObservations: F(competitive, 'competitive', 0.55, str(mp, 'updated_at') ?? pFresh),
    seoObservations: F(list(dm, 'seo_keywords'), 'seo', 0.55, str(dm, 'discovered_at') ?? pFresh),
    marketSignals: F(marketSignals, 'competitive', 0.55, str(mp, 'updated_at') ?? pFresh),

    assembledAt: new Date(now).toISOString(),
  };

  // Quality + transparency + evidence need the full object; assemble in stages.
  const quality = computeContextQuality(ctxBase as CanonicalContext);
  const withQuality: CanonicalContext = {
    ...(ctxBase as CanonicalContext),
    quality,
    knownGaps: [],
    transparency: {
      groundedFrom: [], confidence: 0, freshnessLabel: 'unknown', freshestDays: null, evidenceAvailable: false, missingContext: [],
    },
    evidenceIntelligence: { internal: [], external: [], reasoning: [], note: '' },
  };
  withQuality.evidenceIntelligence = buildEvidenceIntelligence(withQuality);
  withQuality.transparency = computeTransparency(withQuality);
  withQuality.knownGaps = withQuality.transparency.missingContext;

  return withQuality;
}

/** Cached-friendly public entry point (thin; add caching later if needed). */
export async function getCanonicalContext(companyId: string, deps?: AssimilationDeps): Promise<CanonicalContext> {
  return assimilateContext(companyId, deps);
}
