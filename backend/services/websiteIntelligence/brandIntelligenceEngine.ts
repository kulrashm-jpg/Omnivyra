/**
 * Website Brand Intelligence — deterministic (Phase 18, Phase D).
 * Reads ONLY persisted brand + crawl data (company_brand_identity, company_profiles,
 * community_ai_actions, canonical_pages). No LLM. Asset/consistency scoring comes from
 * the stored brand identity; brand trust/authority from community sentiment. Signals
 * with no stored source (NPS, reviews, competitor sentiment) are not_evaluable.
 */
import { supabase } from '../../db/supabaseClient';
import { CheckResult, Freshness, Provenance, aggregate, clamp, freshnessFrom, healthFromScore, norm } from './engineCommon';
import type { IntelHealth } from './engineCommon';

interface BrandIdentity { colors?: unknown; typography?: unknown; logo_assets?: unknown; voice?: unknown; vocabulary?: unknown; compliance?: unknown; design_language?: unknown; tagline?: string | null; completeness?: number | null; status?: string | null; version?: number | null; published_at?: string | null; updated_at?: string | null }
interface ProfileRow { logo_url?: string | null; favicon_url?: string | null }
interface CommunityRow { sentiment?: string | null; platform?: string | null; message_count?: number | null; created_at?: string | null }
interface PageRow { title: string | null; headings: Array<{ level: number; text: string }> | null; ctas: Array<{ text: string }> | null }

export interface BrandIntelligence {
  brandScore: number | null;
  brandHealth: IntelHealth;
  brandConsistency: number | null;
  brandTrust: number | null;
  brandAuthority: number | null;
  brandMaturity: number | null;
  brandStrengths: string[];
  brandWeaknesses: string[];
  recommendations: Array<{ key: string; recommendation: string }>;
  checks: CheckResult[];
  confidence: number;
  freshness: Freshness;
  provenance: Provenance;
}

const defined = (v: unknown): boolean => {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

export function scoreBrandIntelligence(identity: BrandIdentity | null, profile: ProfileRow | null, community: CommunityRow[], pages: PageRow[], nowMs: number): BrandIntelligence {
  const checks: CheckResult[] = [];
  const C = (key: string, label: string, status: CheckResult['status'], score: number | null, detail?: string) => checks.push({ key, label, status, score, detail });
  const pick = (...c: CheckResult[]) => { const ev = c.filter((x) => typeof x.score === 'number'); return ev.length ? clamp(ev.reduce((a, x) => a + (x.score as number), 0) / ev.length) : null; };

  // --- brand identity (asset consistency) ---
  const idChecks: CheckResult[] = [];
  if (identity) {
    const a = (key: string, label: string, ok: boolean) => { const c: CheckResult = { key, label, status: 'pass', score: ok ? 100 : 30 }; checks.push(c); idChecks.push(c); };
    a('brand_colors', 'Brand colours', defined(identity.colors));
    a('typography', 'Typography', defined(identity.typography));
    a('logo_consistency', 'Logo consistency', defined(identity.logo_assets) || defined(profile?.logo_url));
    a('tone_voice', 'Tone / voice', defined(identity.voice) || defined(identity.vocabulary));
    const completeness = typeof identity.completeness === 'number' ? clamp(identity.completeness * 100) : (defined(identity.colors) && defined(identity.typography) ? 70 : 40);
    const ac: CheckResult = { key: 'brand_assets', label: 'Brand asset completeness', status: 'pass', score: completeness }; checks.push(ac); idChecks.push(ac);
    C('professional_appearance', 'Professional appearance', 'pass', completeness);
  } else {
    for (const [k, l] of [['brand_colors', 'Brand colours'], ['typography', 'Typography'], ['logo_consistency', 'Logo consistency'], ['tone_voice', 'Tone / voice'], ['brand_assets', 'Brand asset completeness'], ['professional_appearance', 'Professional appearance']] as const) C(k, l, 'not_evaluable', null, 'No stored brand identity');
  }

  // --- messaging / CTA / value prop consistency (from crawl) ---
  const consistencyChecks: CheckResult[] = [];
  if (pages.length) {
    const titles = pages.map((p) => norm(p.title)).filter(Boolean);
    const tokenSets = titles.map((t) => new Set(t.split(' ')));
    const shared = tokenSets.length > 1 ? tokenSets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x)))).size : 0;
    const mc: CheckResult = { key: 'messaging_consistency', label: 'Messaging consistency', status: 'pass', score: clamp(shared > 0 ? 80 : 45) }; checks.push(mc); consistencyChecks.push(mc);
    const ctas = pages.flatMap((p) => (p.ctas || []).map((c) => norm(c.text))).filter(Boolean);
    const ctaConsistency = ctas.length ? clamp(100 - ((new Set(ctas).size - 1) / Math.max(1, ctas.length)) * 60) : null;
    const cc: CheckResult = { key: 'cta_consistency', label: 'CTA consistency', status: ctas.length ? 'pass' : 'not_evaluable', score: ctaConsistency }; checks.push(cc); if (ctas.length) consistencyChecks.push(cc);
    const vp: CheckResult = { key: 'value_proposition_consistency', label: 'Value proposition consistency', status: 'pass', score: clamp(defined(identity?.tagline) ? 80 : (titles.length ? 50 : 30)) }; checks.push(vp); consistencyChecks.push(vp);
    const hier = pages.filter((p) => (p.headings || []).some((h) => h.level === 1) && (p.headings || []).some((h) => h.level === 2)).length;
    C('visual_hierarchy', 'Visual hierarchy', 'pass', clamp((hier / pages.length) * 100));
  } else {
    for (const [k, l] of [['messaging_consistency', 'Messaging consistency'], ['cta_consistency', 'CTA consistency'], ['value_proposition_consistency', 'Value proposition consistency'], ['visual_hierarchy', 'Visual hierarchy']] as const) C(k, l, 'not_evaluable', null, 'No crawled pages');
  }

  // --- brand trust + authority (community sentiment) ---
  let trust: number | null = null; let authority: number | null = null;
  if (community.length) {
    const total = community.length;
    const positive = community.filter((c) => norm(c.sentiment) === 'positive').length;
    const negative = community.filter((c) => norm(c.sentiment) === 'negative').length;
    trust = clamp(((positive - negative) / total) * 50 + 50);
    const platforms = new Set(community.map((c) => norm(c.platform)).filter(Boolean)).size;
    authority = clamp(platforms * 25 + Math.min(50, total));
    C('trust_consistency', 'Brand trust (sentiment)', 'pass', trust, `${positive} positive / ${negative} negative of ${total}`);
    C('brand_authority', 'Brand authority', 'pass', authority, `${platforms} active platforms`);
  } else {
    C('trust_consistency', 'Brand trust (sentiment)', 'not_evaluable', null, 'No community signals');
    C('brand_authority', 'Brand authority', 'not_evaluable', null, 'No community signals');
  }

  // --- maturity + differentiation ---
  let maturity: number | null = null;
  if (identity) {
    const published = norm(identity.status) === 'published';
    maturity = clamp((published ? 60 : 30) + Math.min(40, ((identity.version ?? 1) - 1) * 10) + (typeof identity.completeness === 'number' ? identity.completeness * 0 : 0));
    C('brand_maturity', 'Brand maturity', 'pass', maturity, published ? 'Published identity' : 'Draft identity');
  } else {
    C('brand_maturity', 'Brand maturity', 'not_evaluable', null, 'No stored brand identity');
  }
  C('brand_differentiation', 'Brand differentiation', 'not_evaluable', null, 'Requires competitor comparison (not in scope here)');

  const agg = aggregate(checks);
  const brandConsistency = pick(...idChecks, ...consistencyChecks);
  const recMap: Record<string, string> = {
    brand_colors: 'Define a brand colour palette.', typography: 'Define brand typography.',
    logo_consistency: 'Upload a primary logo asset.', tone_voice: 'Document brand tone and voice.',
    brand_assets: 'Complete the brand identity profile.', messaging_consistency: 'Align page titles around core brand terms.',
    cta_consistency: 'Standardise the primary call-to-action across the site.', value_proposition_consistency: 'Add a consistent tagline / value proposition.',
    visual_hierarchy: 'Use a clear H1/H2 hierarchy on every page.', trust_consistency: 'Address negative community sentiment.', brand_authority: 'Grow presence across more channels.',
  };
  const recommendations = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 60).map((c) => ({ key: c.key, recommendation: recMap[c.key] || `Improve ${c.label.toLowerCase()}.` }));

  return {
    brandScore: agg.score, brandHealth: healthFromScore(agg.score), brandConsistency, brandTrust: trust, brandAuthority: authority, brandMaturity: maturity,
    brandStrengths: checks.filter((c) => typeof c.score === 'number' && (c.score as number) >= 80).map((c) => c.label),
    brandWeaknesses: checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 50).map((c) => c.label),
    recommendations, checks, confidence: agg.confidence,
    freshness: freshnessFrom(identity?.published_at ?? identity?.updated_at ?? null, nowMs, 24 * 90),
    provenance: { sources: ['company_brand_identity', 'company_profiles', 'community_ai_actions', 'canonical_pages'], checksEvaluated: agg.evaluated, checksTotal: agg.total, deterministic: true },
  };
}

export async function evaluateBrandIntelligence(companyId: string, nowMs = Date.now()): Promise<BrandIntelligence> {
  try {
    const since = new Date(nowMs - 30 * 24 * 3_600_000).toISOString();
    const [idRes, profRes, commRes, pageRes] = await Promise.all([
      supabase.from('company_brand_identity').select('colors, typography, logo_assets, voice, vocabulary, compliance, design_language, tagline, completeness, status, version, published_at, updated_at').eq('company_id', companyId).order('version', { ascending: false }).limit(5),
      supabase.from('company_profiles').select('logo_url, favicon_url').eq('company_id', companyId).maybeSingle(),
      supabase.from('community_ai_actions').select('sentiment, platform, message_count, created_at').eq('company_id', companyId).gte('created_at', since).limit(2000),
      supabase.from('canonical_pages').select('title, headings, ctas').eq('company_id', companyId).order('last_crawled_at', { ascending: false }).limit(500),
    ]);
    const rows = (idRes.data || []) as BrandIdentity[];
    const identity = rows.find((r) => norm(r.status) === 'published') ?? rows[0] ?? null;
    return scoreBrandIntelligence(identity, (profRes.data as ProfileRow) ?? null, (commRes.data || []) as CommunityRow[], (pageRes.data || []) as PageRow[], nowMs);
  } catch {
    return scoreBrandIntelligence(null, null, [], [], nowMs);
  }
}
