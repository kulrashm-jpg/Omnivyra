/**
 * Product & Usage Intelligence domain scoring (Phase 34). Measures each tenant's adoption
 * and usage of OmniVyra. Pure, deterministic, evidence-backed. Composes EXISTING reads
 * (activation readiness, growth summary, lead stats). Owns NO generic intelligence. No LLM.
 * Unknown stays Unknown — per-user / seat / DAU·MAU / login / API-usage data is not captured
 * in the schema, so stickiness / utilization / user engagement / power-users are not-available.
 */
import type { PluginModule } from '../platformIntelligence/registry';
import type { RawRecommendationInput } from '../platformIntelligence/recommendations';

export interface ProductUsageInputs {
  readiness: any | null;  // activationReadinessService.buildActivationReadiness
  growth: any | null;     // growthIntelligenceService.getGrowthIntelligenceSummary
  leadStats: any | null;  // leadIntelligenceReadService.getLeadStats
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const norm = (v: number, max: number) => clamp((v / max) * 100);
const statusFromScore = (s: number | null): PluginModule['status'] => (s == null ? 'unavailable' : s >= 75 ? 'ready' : 'partial');

export interface ProductUsageResult {
  modules: PluginModule[];
  recommendationInputs: RawRecommendationInput[];
  score: number;
  lastUpdated: string | null;
  maturityLevel: number;
}

export function scoreProductUsage(inputs: ProductUsageInputs): ProductUsageResult {
  const { readiness, growth, leadStats } = inputs;
  const checks: any[] = readiness?.checks ?? [];
  const done = (id: string) => !!checks.find((c) => c.id === id)?.done;
  const publishedPosts = Number(growth?.contentVelocity?.publishedPosts ?? 0);
  const publishSuccess = Number(growth?.publishing?.successRate ?? 0); // 0..1
  const communityActions = Number(growth?.community?.executedActions ?? 0);
  const campaignsActivated = Number(growth?.opportunities?.campaignsFromOpportunities ?? 0);
  const leads = Number(leadStats?.total ?? 0);
  const updatedAt = readiness?.generatedAt ?? null;

  // Feature/module evidence (which product areas are actively used).
  const features = {
    content: publishedPosts > 0, community: communityActions > 0, leads: leads > 0,
    campaigns: campaignsActivated > 0, analytics: done('analytics'), cms: done('cms'),
  };
  const evidencedFeatures = Object.values(features).filter(Boolean).length;
  const inactive = Object.entries(features).filter(([, v]) => !v).map(([k]) => k);

  const M: PluginModule[] = [];
  const add = (key: string, label: string, score: number | null, source: string, findings: string[]) =>
    M.push({ key, label, source, score, status: statusFromScore(score), available: score != null, findings: findings.slice(0, 3), lastUpdated: updatedAt });

  add('activation', 'Activation', checks.length ? clamp((checks.filter((c) => c.done).length / checks.length) * 100) : null, 'activationReadinessService', checks.length ? [`${checks.filter((c) => c.done).length}/${checks.length} activation steps done`] : ['No activation data — Unknown']);
  add('feature_adoption', 'Feature Adoption', growth || readiness || leadStats ? clamp((evidencedFeatures / 6) * 100) : null, 'derived', [`${evidencedFeatures}/6 product areas active`]);
  add('module_adoption', 'Module Adoption', growth || readiness ? clamp((evidencedFeatures / 6) * 100) : null, 'derived', inactive.length ? [`Inactive: ${inactive.join(', ')}`] : ['All core modules active']);
  add('content_creation', 'Content Creation', growth ? norm(publishedPosts, 30) : null, 'growthIntelligenceService', growth ? [`${publishedPosts} posts published`] : ['Unknown']);
  add('publishing', 'Publishing', growth ? clamp(publishSuccess * 100) : null, 'growthIntelligenceService', growth ? [`${Math.round(publishSuccess * 100)}% publish success`] : ['Unknown']);
  add('community_usage', 'Community Usage', growth ? norm(communityActions, 50) : null, 'growthIntelligenceService', growth ? [`${communityActions} community actions`] : ['Unknown']);
  add('campaign_usage', 'Campaign Usage', growth ? norm(campaignsActivated, 10) : null, 'growthIntelligenceService', growth ? [`${campaignsActivated} campaigns activated`] : ['Unknown']);
  add('lead_capture_usage', 'Lead Capture Usage', leadStats ? (leads > 0 ? clamp(Math.min(100, leads * 4)) : 0) : null, 'leadIntelligence', leadStats ? [`${leads} leads captured`] : ['Unknown']);
  add('integration_usage', 'Integration Usage', readiness ? (done('cms') ? 85 : 30) : null, 'activationReadinessService', [done('cms') ? 'CMS connected' : 'No CMS integration']);

  // Workspace engagement = mean of activity signals.
  const activity = [growth ? norm(publishedPosts, 30) : null, growth ? norm(communityActions, 50) : null, growth ? norm(campaignsActivated, 10) : null].filter((x): x is number => x != null);
  const workspaceEngagement = activity.length ? clamp(activity.reduce((a, b) => a + b, 0) / activity.length) : null;
  add('workspace_engagement', 'Workspace Engagement', workspaceEngagement, 'derived', activity.length ? ['Mean of content/community/campaign activity'] : ['Unknown']);

  // Account health = activation + workspace engagement (where evidenced).
  const accountInputs = [M.find((m) => m.key === 'activation')!.score, workspaceEngagement].filter((x): x is number => x != null);
  const accountHealth = accountInputs.length ? clamp(accountInputs.reduce((a, b) => a + b, 0) / accountInputs.length) : null;
  add('account_health', 'Account Health', accountHealth, 'derived', accountInputs.length ? ['Activation + engagement'] : ['Unknown']);

  // Honest Unknowns — no per-user / seat / time-series data captured.
  add('user_engagement', 'User Engagement', null, 'productUsage', ['Unknown — no per-user/session data captured']);
  add('stickiness', 'Stickiness (DAU/MAU)', null, 'productUsage', ['Unknown — no daily/monthly active-user data']);
  add('utilization', 'License Utilization', null, 'productUsage', ['Unknown — no seat/license data']);
  add('expansion_readiness', 'Expansion Readiness', null, 'productUsage', ['Unknown — no usage-growth trend']);
  add('power_users', 'Power Users', null, 'productUsage', ['Unknown — no per-user activity']);

  const evidenced = M.map((m) => m.score).filter((s): s is number => s != null);
  const productHealth = evidenced.length ? clamp(evidenced.reduce((a, b) => a + b, 0) / evidenced.length) : null;
  add('product_health', 'Product Health', productHealth, 'productUsage', evidenced.length ? [`Composite of ${evidenced.length} usage signals`] : ['Insufficient evidence — Unknown']);

  const signals = [evidencedFeatures >= 4, (workspaceEngagement ?? 0) > 0, (M.find((m) => m.key === 'activation')!.score ?? 0) >= 60].filter(Boolean).length + (evidencedFeatures >= 2 ? 1 : 0);
  const maturityLevel = signals >= 4 ? 4 : signals >= 3 ? 3 : signals >= 2 ? 2 : 1; // capped at 4 — per-user maturity uninstrumented
  add('product_maturity', 'Product Maturity', maturityLevel * 20, 'productUsage', [`Level ${maturityLevel}/5 (per-user/stickiness not instrumented)`]);

  const recInputs: RawRecommendationInput[] = [];
  const rec = (key: string, text: string, module: string, impactLevel: 'high' | 'medium' | 'low', confidence: number) => recInputs.push({ key, text, source: 'productUsage', module, impactLevel, confidence });
  if (checks.length && checks.some((c) => !c.done)) rec('complete_activation', 'Complete activation steps to reach first value.', 'activation', 'high', 0.85);
  if (inactive.length) rec('adopt_inactive_modules', `Drive adoption of inactive modules: ${inactive.join(', ')}.`, 'module_adoption', 'medium', 0.8);
  if (growth && publishedPosts < 5) rec('increase_product_usage', 'Increase product usage (publish more content, run campaigns).', 'content_creation', 'medium', 0.75);
  rec('instrument_user_engagement', 'Instrument per-user activity to measure engagement and stickiness.', 'user_engagement', 'medium', 0.7);
  rec('instrument_utilization', 'Instrument seats/licenses to measure utilization.', 'utilization', 'medium', 0.7);

  const score = productHealth ?? 0;
  return { modules: M, recommendationInputs: recInputs, score, lastUpdated: updatedAt, maturityLevel };
}
