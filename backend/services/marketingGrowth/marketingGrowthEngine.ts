/**
 * Marketing & Growth domain scoring (Phase 22). Pure, deterministic, evidence-backed.
 *
 * This is DOMAIN scoring only — it composes existing engine reads (growth summary, lead
 * stats, website snapshot, activation readiness) into marketing/growth modules + raw
 * recommendation inputs. It owns NO generic intelligence: executive summary, business
 * impact, recommendations merge, roadmap, confidence, freshness, presentation and renderers
 * all belong to Platform Intelligence (the plugin composes through it). No LLM. Unknown
 * stays Unknown (unevidenced dimensions are reported not-available, never fabricated).
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface MarketingGrowthInputs {
  growth: any | null;     // growthIntelligenceService.getGrowthIntelligenceSummary
  leadStats: any | null;  // leadIntelligenceReadService.getLeadStats
  website: any | null;    // websiteIntelligenceRepository.getWebsiteSnapshot
  readiness: any | null;  // activationReadinessService.buildActivationReadiness
}

const norm = (v: number, max: number): number => Math.max(0, Math.min(100, Math.round((v / max) * 100)));
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');
const moduleScore = (status: string | undefined): number | null => (status === 'ready' ? 85 : status === 'partial' ? 60 : status === 'unavailable' ? null : null);

export interface MarketingGrowthResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scoreMarketingGrowth(inputs: MarketingGrowthInputs): MarketingGrowthResult {
  const { growth, leadStats, website, readiness } = inputs;
  const b = growth?.scoreBreakdown ?? null;
  const total = Number(leadStats?.total ?? 0);
  const bands = leadStats?.intentBands ?? { high: 0, medium: 0, low: 0 };
  const checkDone = (id: string) => !!readiness?.checks?.find((c: any) => c.id === id)?.done;
  const websiteModule = (key: string) => website?.modules?.find((m: any) => m.key === key)?.status as string | undefined;
  const lastUpdated = readiness?.generatedAt ?? website?.health?.computedAt ?? null;

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated });

  // --- Marketing health dimensions (Phase C) — only evidenced dimensions score ---
  add('website', 'Website', website?.health?.compositeScore ?? null, 'websiteIntelligenceRepository', [`Composite ${Math.round(website?.health?.compositeScore ?? 0)}/100`]);
  add('lead_capture', 'Lead Capture', checkDone('leads') ? 90 : total > 0 ? 60 : 30, 'activationReadinessService', [checkDone('leads') ? 'Lead capture active' : 'Lead capture not configured']);
  add('content', 'Content', b ? norm(b.contentVelocity, 20) : moduleScore(websiteModule('content_analysis')), 'growthIntelligenceService', [b ? `Content velocity contributes ${b.contentVelocity}` : 'From website content']);
  add('campaigns', 'Campaigns', b ? norm(b.opportunity, 10) : null, 'growthIntelligenceService', [b ? `Opportunity activation ${b.opportunity}` : 'No campaign signal']);
  add('engagement', 'Engagement', b ? norm(b.engagement, 30) : null, 'growthIntelligenceService', [b ? `Engagement contributes ${b.engagement}` : 'No engagement signal']);
  add('publishing', 'Publishing', b ? norm(b.publishing, 25) : null, 'growthIntelligenceService', [b ? `Publishing contributes ${b.publishing}` : 'No publishing signal']);
  add('community', 'Community', b ? norm(b.community, 15) : null, 'growthIntelligenceService', [b ? `Community contributes ${b.community}` : 'No community signal']);
  add('seo', 'SEO', moduleScore(websiteModule('seo')), 'websiteIntelligenceRepository', ['From website SEO module']);
  add('organic', 'Organic', (() => { const s = moduleScore(websiteModule('seo')); const c = b ? norm(b.contentVelocity, 20) : null; const vals = [s, c].filter((x): x is number => x != null); return vals.length ? Math.round(vals.reduce((a, x) => a + x, 0) / vals.length) : null; })(), 'derived', ['SEO + content velocity']);
  add('analytics', 'Analytics', checkDone('analytics') ? 90 : 40, 'activationReadinessService', [checkDone('analytics') ? 'Analytics connected' : 'Analytics not connected']);
  add('tracking', 'Tracking', website?.tracking?.active ? 90 : 30, 'websiteIntelligenceRepository', [website?.tracking?.active ? 'Tracking active' : 'Tracking not detected']);
  add('integrations', 'Integrations', website?.health?.categoryScores?.integration_reliability ?? (checkDone('cms') ? 80 : null), 'websiteIntelligenceRepository', ['CMS / integration health']);
  add('brand', 'Brand', moduleScore(websiteModule('brand')), 'websiteIntelligenceRepository', ['From website brand module']);
  add('competitive', 'Competitive', moduleScore(websiteModule('competitive')), 'websiteIntelligenceRepository', ['From website competitive module']);
  add('marketpulse', 'MarketPulse', moduleScore(websiteModule('marketpulse')), 'websiteIntelligenceRepository', ['From website signals']);

  // --- Channels (Phase D) — unevidenced paid/social/email stay unavailable ---
  add('channel_paid', 'Paid channels', null, 'marketingGrowth', ['No paid-channel data captured']);
  add('channel_social', 'Social channels', null, 'marketingGrowth', ['No social-channel data captured']);
  add('channel_email', 'Email', null, 'marketingGrowth', ['No email-channel data captured']);

  // --- Funnel (Phase E) — qualification rate where evidence exists; later stages Unknown ---
  const knownRate = total > 0 ? Math.round((Number(leadStats?.withIdentity ?? 0) / total) * 100) : null;
  const qualRate = total > 0 ? Math.round((bands.high / total) * 100) : null;
  add('funnel', 'Funnel', qualRate, 'leadIntelligence', total > 0 ? [`${total} leads`, `${bands.high} qualified (${qualRate}%)`, `${knownRate}% identity-known`, 'Opportunities → revenue: Unknown (not instrumented)'] : ['No funnel data']);

  // --- Revenue (Phase F) — Unknown stays Unknown (no spend/revenue data) ---
  add('revenue', 'Revenue', null, 'marketingGrowth', ['Pipeline signal from lead intent', 'CAC / ROAS / ROI / LTV: Unknown (no spend/revenue evidence)']);

  // --- Pipeline ---
  add('pipeline', 'Pipeline', total > 0 ? Math.min(100, total * 4) : 0, 'leadIntelligence', [`${total} leads in pipeline`, `${bands.high} high-intent`]);

  // --- Maturity (Phase G) — evidence-counted level 1..5 ---
  const signals = [
    !!website?.domain?.verified, !!website?.tracking?.active, checkDone('leads'), checkDone('cms'), checkDone('analytics'),
    !!(b && b.contentVelocity > 0), !!(b && b.opportunity > 0),
  ].filter(Boolean).length;
  const maturityLevel = signals >= 7 ? 5 : signals >= 6 ? 4 : signals >= 4 ? 3 : signals >= 2 ? 2 : 1;
  add('maturity', 'Marketing Maturity', maturityLevel * 20, 'marketingGrowth', [`Level ${maturityLevel}/5 (${signals} activated capabilities)`]);

  // --- Recommendation inputs (Phase I) — platform engine merges/prioritises ---
  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'marketingGrowth', module, impactLevel, confidence });
  if ((website?.health?.compositeScore ?? 100) < 60) rec('improve_website', 'Improve website health to strengthen the marketing foundation.', 'website', 'medium', 0.8);
  if (!checkDone('leads')) rec('enable_lead_capture', 'Activate lead capture to start the marketing funnel.', 'lead_capture', 'high', 0.9);
  if (!checkDone('analytics')) rec('connect_analytics', 'Connect analytics for measurable marketing.', 'analytics', 'high', 0.85);
  if (b && norm(b.contentVelocity, 20) < 50) rec('increase_content', 'Increase content velocity to build organic growth.', 'content', 'medium', 0.8);
  if (b && norm(b.community, 15) < 50) rec('grow_community', 'Grow community activity to drive advocacy.', 'community', 'low', 0.75);
  if (qualRate != null && qualRate < 20) rec('improve_qualification', 'Improve lead qualification to lift funnel conversion.', 'funnel', 'medium', 0.8);
  rec('instrument_revenue', 'Instrument revenue/spend to unlock CAC, ROAS and ROI.', 'revenue', 'medium', 0.7);
  if (maturityLevel < 3) rec('advance_maturity', 'Advance marketing maturity by activating core capabilities.', 'maturity', 'medium', 0.8);
  rec('activate_channels', 'Activate and instrument paid/social/email channels.', 'channel_paid', 'medium', 0.7);

  const scored = M.map((m) => m.score).filter((s): s is number => s != null);
  const score = scored.length ? Math.round(scored.reduce((a, x) => a + x, 0) / scored.length) : 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated, maturityLevel };
}
