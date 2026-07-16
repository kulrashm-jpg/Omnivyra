/**
 * RF-3A — deterministic, reproducible golden dataset.
 * Covers size (small/medium/enterprise) × completeness (none/sparse/rich) ×
 * website on/off × market-intel on/off × activity (active/dormant). Every entry
 * has a fixed clock and fixed content, so canonical assembly is byte-stable.
 */
import type { DatasetEntry, CompanySize, Completeness, Activity } from './types';

/** Fixed evaluation epoch — deterministic freshness/assembly (never Date.now()). */
export const EVAL_EPOCH = Date.parse('2026-07-15T00:00:00Z');
const daysAgo = (n: number) => new Date(EVAL_EPOCH - n * 86_400_000).toISOString();

function marketPulse(on: boolean): Record<string, unknown> {
  return on
    ? {
        core_offerings: ['Analytics suite', 'Attribution engine'],
        named_competitors: ['CompetitorA', 'CompetitorB'],
        primary_markets: ['B2B SaaS', 'Mid-market'],
        updated_at: daysAgo(10),
      }
    : {};
}
function discoveredMeta(on: boolean): Record<string, unknown> {
  return on
    ? { title: 'Acme — modern martech', description: 'On-brand content, 5x faster.', seo_keywords: ['martech', 'aeo'], discovered_at: daysAgo(5) }
    : {};
}

function buildProfile(opts: {
  name: string; industry: string; completeness: Completeness; website: boolean; market: boolean;
}): Record<string, unknown> {
  const report_settings = { market_pulse: marketPulse(opts.market), discovered_metadata: discoveredMeta(opts.website) };
  if (opts.completeness === 'none') {
    // No first-party profile at all — the hardest grounding case.
    return { report_settings };
  }
  if (opts.completeness === 'sparse') {
    // Name + industry present; the rest EMPTY (backfill candidates).
    return {
      name: opts.name, industry: opts.industry,
      website_url: opts.website ? `https://${opts.name.toLowerCase()}.example` : '',
      overall_confidence: 0.5, last_refined_at: daysAgo(20), report_settings,
    };
  }
  // rich — everything populated (canonical must change NOTHING here).
  return {
    name: opts.name, industry: opts.industry, category: `${opts.industry} platform`,
    products_services: 'Flagship product, Add-on module',
    products_services_list: ['Flagship product', 'Add-on module'],
    competitive_advantages: ['Grounded in your crawl', 'Multi-platform'],
    unique_value: 'Ship on-brand content 5x faster',
    ideal_customer_profile: 'B2B marketing leaders at SaaS',
    target_audience: 'B2B marketing leaders at SaaS',
    target_audience_list: ['CMOs', 'Content leads'],
    pain_symptoms: ['generic AI output', 'slow production'],
    brand_positioning: 'sharp, modern', brand_voice: 'sharp, modern',
    content_themes: 'AEO, attribution', content_themes_list: ['AEO', 'attribution'],
    growth_priorities: ['mid-market expansion'],
    website_url: opts.website ? `https://${opts.name.toLowerCase()}.example` : '',
    overall_confidence: 0.9, last_refined_at: daysAgo(3), report_settings,
  };
}

function recent(activity: Activity): { title: string; published_at?: string | null }[] {
  if (activity === 'dormant') return [];
  return [
    { title: 'How AEO changes content strategy', published_at: daysAgo(2) },
    { title: 'Attribution for mid-market teams', published_at: daysAgo(9) },
    { title: 'Multi-platform playbook', published_at: daysAgo(16) },
  ];
}

interface Spec {
  size: CompanySize; industry: string; completeness: Completeness;
  website: boolean; market: boolean; activity: Activity;
}

// Representative matrix — deliberately spans the corners + typical middles.
const SPECS: Spec[] = [
  { size: 'small', industry: 'Fintech', completeness: 'none', website: false, market: false, activity: 'dormant' }, // hardest
  { size: 'small', industry: 'Fintech', completeness: 'sparse', website: false, market: false, activity: 'dormant' },
  { size: 'small', industry: 'Ecommerce', completeness: 'sparse', website: true, market: false, activity: 'active' },
  { size: 'medium', industry: 'Martech', completeness: 'sparse', website: true, market: true, activity: 'active' },
  { size: 'medium', industry: 'Healthtech', completeness: 'rich', website: false, market: false, activity: 'dormant' },
  { size: 'medium', industry: 'Martech', completeness: 'rich', website: true, market: true, activity: 'active' },
  { size: 'enterprise', industry: 'Cybersecurity', completeness: 'rich', website: true, market: true, activity: 'active' }, // richest
  { size: 'enterprise', industry: 'Logistics', completeness: 'sparse', website: true, market: true, activity: 'dormant' },
  { size: 'enterprise', industry: 'Cybersecurity', completeness: 'none', website: true, market: true, activity: 'active' }, // no profile but signals
];

/** Deterministic dataset. Same call → byte-identical entries. */
export function loadGoldenDataset(): DatasetEntry[] {
  return SPECS.map((s, i) => {
    const name = `${s.industry}Co${i}`;
    return {
      id: `eval-${String(i).padStart(2, '0')}-${s.size}-${s.completeness}`,
      size: s.size, industry: s.industry, completeness: s.completeness,
      websiteEnabled: s.website, marketIntel: s.market, activity: s.activity,
      now: EVAL_EPOCH,
      profile: buildProfile({ name, industry: s.industry, completeness: s.completeness, website: s.website, market: s.market }),
      recentContent: recent(s.activity),
    };
  });
}
