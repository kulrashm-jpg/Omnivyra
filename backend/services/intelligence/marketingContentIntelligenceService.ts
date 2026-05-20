/**
 * Content-performance intelligence — DETERMINISTIC scoring over real telemetry.
 *
 * Reads existing tables: blogs, page_analytics_daily, lead_attributions. NO
 * machine learning, NO autonomous claims. Per-blog score is an explainable
 * weighted sum of measurable signals with recency decay; attribution-grounded
 * (a content piece's score is amplified when it appears as a lead landing
 * page / first-touch / last-touch).
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface ContentScore {
  blogId: string;
  title: string;
  url: string | null;
  views30d: number;
  ctaClicks30d: number;
  formSubmits30d: number;
  attributionTouches: number;
  decayDays: number;
  score: number;       // 0..100
  confidence: number;  // 0..100 (sample size)
  basis: string;
}

export interface ContentIntelligenceReport {
  companyId: string;
  generatedAt: string;
  top: ContentScore[];
  underperforming: ContentScore[];
  capabilityNote: string;
}

const HALF_LIFE_DAYS = 21;

function decay(ageDays: number): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function confidenceFromN(n: number): number {
  return Math.round((1 - Math.exp(-n / 6)) * 100);
}

export async function buildContentIntelligence(companyId: string): Promise<ContentIntelligenceReport> {
  let blogs: any[] = [];
  try {
    const { data } = await ownedDbTable('blogs')
      .select('id, title, slug, published_at')
      .eq('company_id', companyId)
      .order('published_at', { ascending: false })
      .limit(200);
    blogs = (data ?? []) as any[];
  } catch {
    blogs = [];
  }

  if (blogs.length === 0) {
    return {
      companyId,
      generatedAt: new Date().toISOString(),
      top: [],
      underperforming: [],
      capabilityNote: 'No blogs found — content intelligence is grounded in published content.',
    };
  }

  // Aggregated daily page analytics over the last 30 days, by page_url.
  const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const byUrl = new Map<string, { views: number; cta: number; submits: number }>();
  try {
    const { data } = await ownedDbTable('page_analytics_daily')
      .select('page_url, page_views, cta_clicks, form_submits, day')
      .eq('company_id', companyId)
      .gte('day', sinceIso);
    for (const r of ((data ?? []) as any[])) {
      const cur = byUrl.get(r.page_url) ?? { views: 0, cta: 0, submits: 0 };
      cur.views += Number(r.page_views ?? 0);
      cur.cta += Number(r.cta_clicks ?? 0);
      cur.submits += Number(r.form_submits ?? 0);
      byUrl.set(r.page_url, cur);
    }
  } catch {
    /* table absent → byUrl stays empty; honest fallback */
  }

  // Attribution touches: count of lead_attributions per landing_page.
  const byAttr = new Map<string, number>();
  try {
    const { data } = await ownedDbTable('lead_attributions')
      .select('landing_page')
      .eq('company_id', companyId)
      .gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString());
    for (const r of ((data ?? []) as any[])) {
      const k = String(r.landing_page ?? '');
      if (!k) continue;
      byAttr.set(k, (byAttr.get(k) ?? 0) + 1);
    }
  } catch {
    /* absent → no attribution amplification */
  }

  const now = Date.now();
  const scored: ContentScore[] = blogs.map((b) => {
    const publishedAt = b.published_at ? Date.parse(b.published_at) : now;
    const ageDays = Math.max(0, (now - publishedAt) / 86_400_000);
    const d = decay(ageDays);
    // Match by slug substring (defensive — pages share canonical URL shape).
    const slug = String(b.slug ?? '').toLowerCase();
    const urlAggKey = slug
      ? Array.from(byUrl.keys()).find((u) => u.toLowerCase().includes(slug)) ?? null
      : null;
    const agg = urlAggKey ? byUrl.get(urlAggKey) ?? null : null;
    const attrKey = slug
      ? Array.from(byAttr.keys()).find((u) => u.toLowerCase().includes(slug)) ?? null
      : null;
    const attr = attrKey ? byAttr.get(attrKey) ?? 0 : 0;

    const views = agg?.views ?? 0;
    const cta = agg?.cta ?? 0;
    const submits = agg?.submits ?? 0;
    // Deterministic weighted score: bias toward attribution+conversion.
    const raw =
      Math.log1p(views) * 6 * d +
      cta * 4 * d +
      submits * 12 * d +
      attr * 18; // attribution touches dominate
    const score = clamp(Math.round(raw));
    const sampleSize = views + cta * 3 + submits * 6 + attr * 8;
    return {
      blogId: String(b.id),
      title: String(b.title ?? ''),
      url: urlAggKey,
      views30d: views,
      ctaClicks30d: cta,
      formSubmits30d: submits,
      attributionTouches: attr,
      decayDays: Math.round(ageDays),
      score,
      confidence: confidenceFromN(sampleSize),
      basis: `w=log1p(views)*6 + cta*4 + submits*12 (×decay) + attr*18; half-life ${HALF_LIFE_DAYS}d`,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    top: scored.slice(0, 10),
    underperforming: [...scored].sort((a, b) => a.score - b.score).slice(0, 5),
    capabilityNote:
      'Deterministic weighted formula over page_analytics_daily + lead_attributions. No ML; confidence is sample-size only.',
  };
}
