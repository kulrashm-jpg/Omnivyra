import type { PersistedDecisionObject } from '../decisionObjectService';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import type {
  CompanyNarrativeContext,
  StrategicContext,
  StructuredActionTrack,
} from './types';
import {
  firstNonEmpty,
  normalizePageLabel,
  splitCandidates,
} from './narrativeHelpers';
import {
  classifyDecisionType,
} from '../decisionTypeRegistry';
import { impactScore } from '../reportDecisionUtils';

export function isAuthorityDecision(decision: PersistedDecisionObject): boolean {
  return [
    'authority_deficit',
    'authority_gap',
    'backlink_gap',
    'weak_backlink_profile',
    'trust_gap',
    'credibility_gap',
    'brand_trust_gap',
    'weak_brand_presence',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type) || ['authority', 'trust'].includes(classifyDecisionType(decision.issue_type));
}

export function isContentDecision(decision: PersistedDecisionObject): boolean {
  return [
    'content_gap',
    'topic_gap',
    'weak_content_depth',
    'weak_cluster_depth',
    'missing_cluster_support',
    'missing_supporting_content',
    'competitor_content_gap',
    'competitor_dominance',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'content_strategy';
}

export function isOpportunityCandidate(decision: PersistedDecisionObject): boolean {
  const category = classifyDecisionType(decision.issue_type);
  if (category === 'opportunity' || category === 'market' || category === 'authority') return true;
  return impactScore(decision) >= 35 || Number(decision.priority_score ?? 0) >= 50;
}

export function guessFocusPage(
  decision: PersistedDecisionObject,
  publicAudit?: PublicAuditResult | null,
): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const thinPages = splitCandidates(payload.thin_pages);
  const orphanPages = splitCandidates(payload.orphan_like_pages);
  const productPages = splitCandidates(payload.product_pages);
  const focusCandidates = [...thinPages, ...orphanPages, ...productPages];
  for (const candidate of focusCandidates) {
    const label = normalizePageLabel(candidate);
    if (label) return label;
  }
  const lower = `${decision.issue_type} ${decision.title} ${decision.description}`.toLowerCase();
  if (/(pricing)/.test(lower)) return 'pricing';
  if (/(faq|answer|schema)/.test(lower)) return 'FAQ';
  if (/(compare|comparison|versus|\/vs\/)/.test(lower)) return 'comparison';
  if (/(product|feature|solution)/.test(lower)) return 'product';
  if (/(blog|guide|article)/.test(lower)) return 'blog';
  if (publicAudit?.site_structure.pricing_pages.length) return 'pricing';
  if (publicAudit?.site_structure.product_pages.length) return 'product';
  if (publicAudit?.site_structure.homepage) return 'homepage';
  return '';
}

export function lowestDepthPageTargets(publicAudit?: PublicAuditResult | null): string[] {
  if (!publicAudit) return [];
  const thinDecision = publicAudit.decisions.find((decision) => decision.issue_type === 'weak_content_depth');
  const payload = (thinDecision?.action_payload ?? {}) as Record<string, unknown>;
  const thinPages = splitCandidates(payload.thin_pages);
  const labels = thinPages.map((page) => normalizePageLabel(page)).filter(Boolean);
  const deduped = [...new Set(labels)];
  if (deduped.length > 0) return deduped;
  const fallback: string[] = [];
  if (publicAudit.site_structure.product_pages.length) fallback.push('product');
  if (publicAudit.site_structure.pricing_pages.length) fallback.push('pricing');
  if (publicAudit.site_structure.homepage) fallback.push('homepage');
  if (publicAudit.site_structure.blog_pages.length) fallback.push('blog');
  return fallback.slice(0, 3);
}

export function topTrafficPotentialPages(publicAudit?: PublicAuditResult | null): string[] {
  if (!publicAudit) return [];
  const ordered = [
    publicAudit.site_structure.homepage ? 'homepage' : '',
    publicAudit.site_structure.pricing_pages.length ? 'pricing' : '',
    publicAudit.site_structure.product_pages.length ? 'product' : '',
    publicAudit.site_structure.geo_pages.length ? 'geo page' : '',
    publicAudit.site_structure.blog_pages.length ? 'blog' : '',
  ].filter(Boolean);
  return [...new Set(ordered)].slice(0, 3);
}

export function competitorGapTactics(
  competitorIntelligence?: CompetitorIntelligenceResult | null,
  companyContext?: CompanyNarrativeContext,
): string[] {
  const buyingStageGap = competitorIntelligence?.generated_gaps.find((gap) => /buying-stage content/i.test(gap.title));
  if (!buyingStageGap) return [];
  const targets = buyingStageGap.leading_competitors.slice(0, 2);
  const marketFocus = companyContext?.marketFocus || companyContext?.marketContext || 'your market';
  if (targets.length === 0) {
    return [
      `Build comparison and /vs/ pages for the highest-intent ${marketFocus} alternatives already appearing in competitor coverage.`,
    ];
  }
  return targets.map((competitor) => `Build a /vs/ or comparison page against ${competitor} for the buying-stage gaps this snapshot found.`);
}

export function backlinkTactics(
  authorityScore: number | null | undefined,
  companyContext?: CompanyNarrativeContext,
): string[] {
  if (typeof authorityScore === 'number' && authorityScore >= 30) return [];
  const marketFocus = companyContext?.marketFocus || companyContext?.marketContext || 'your market';
  return [
    `Build links from directories, partner lists, and trade publications relevant to ${marketFocus}.`,
    `Pitch one proof-led byline or expert contribution to publications covering ${marketFocus}.`,
  ];
}

export function contentDepthTactics(publicAudit?: PublicAuditResult | null): string[] {
  const targets = lowestDepthPageTargets(publicAudit);
  if (targets.length === 0) return [];
  return [
    `Expand the thinnest ${targets.slice(0, 2).join(' and ')} pages first so they answer buyer questions with enough depth to rank and convert.`,
    `Add proof blocks, objection handling, and clear section hierarchy to the weakest ${targets[0]} pages identified in the crawl.`,
  ];
}

export function aiVisibilityTactics(
  aiVisibilityScore: number | null | undefined,
  publicAudit?: PublicAuditResult | null,
): string[] {
  if ((aiVisibilityScore ?? 0) !== 0) return [];
  const pages = topTrafficPotentialPages(publicAudit);
  if (pages.length === 0) return [];
  return [
    `Add FAQ schema and direct-answer sections to the top traffic-potential pages: ${pages.join(', ')}.`,
  ];
}

export function structuredReasoning(params: {
  decision: PersistedDecisionObject;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
}): string {
  const marketFocus = params.companyContext?.marketFocus || params.companyContext?.marketContext || '';
  const geography = params.companyContext?.geography || '';
  const focus = [marketFocus, geography].filter(Boolean).join(' in ');
  const contextClause = focus ? `for ${focus}` : '';
  const marketClause = params.strategicContext ? ` in a ${params.strategicContext.marketType} market` : '';
  return `${params.decision.description}${contextClause || marketClause ? ` This matters ${contextClause || ''}${marketClause}`.replace(/\s+/g, ' ').trim() : ''} because it affects how buyers discover, trust, and compare the offer before converting.`.replace(/\s+/g, ' ').trim();
}

export function scrubActionCompanyReferences(text: string, companyContext?: CompanyNarrativeContext): string {
  let next = text;
  const companyName = firstNonEmpty(companyContext?.companyName);
  const domain = firstNonEmpty(companyContext?.domain);

  if (domain) {
    const normalizedDomain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    const domainPattern = normalizedDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`\\b(?:www\\.)?${domainPattern}\\b`, 'gi'), 'the site');
  }

  if (companyName) {
    const companyPattern = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`\\b${companyPattern}'s\\b`, 'gi'), "the business's");
    next = next.replace(new RegExp(`\\b${companyPattern}\\b`, 'gi'), 'the business');
  }

  return next.replace(/\s+/g, ' ').trim();
}

export function replaceLegacyOmnivyraReferences(text: string, companyContext?: CompanyNarrativeContext): string {
  if (!text) return text;
  const companyName = firstNonEmpty(companyContext?.companyName, companyContext?.domain) || 'this business';
  return text
    .replace(/\bOmnivyra's\b/g, `${companyName}'s`)
    .replace(/\bOmnivyra\b/g, companyName)
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferStructuredActionTrack(params: {
  issueType?: string | null;
  actionType?: string | null;
  title?: string | null;
  recommendation?: string | null;
  optimizationFocus?: string | null;
  tactics?: string[] | null;
}): StructuredActionTrack {
  const signature = [
    params.issueType,
    params.actionType,
    params.title,
    params.recommendation,
    params.optimizationFocus,
    ...(params.tactics ?? []),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(backlink|authority|citation|directory|publication|partner list|outreach|proof-led asset|links from)/.test(signature)) {
    return 'authority';
  }
  if (params.actionType === 'adjust_strategy' || /(positioning proof|credibility|expert framing|proof architecture|trust signals|category claim)/.test(signature)) {
    return 'positioning';
  }
  if (/(comparison|competitor|\/vs\/|decision-stage|objection-handling|buying-stage)/.test(signature)) {
    return 'comparison';
  }
  return 'generic';
}

export function authorityActionTactics(
  authorityScore: number | null | undefined,
  companyContext?: CompanyNarrativeContext,
): string[] {
  const marketFocus = companyContext?.marketFocus || companyContext?.marketContext || 'the market';
  const entityLabel = companyContext?.companyName || companyContext?.domain || 'the site';
  return [
    backlinkTactics(authorityScore, companyContext)[0] || `Secure backlinks from relevant publications and partner domains covering ${marketFocus}.`,
    `Publish one proof-led asset, such as a case study, benchmark, or customer evidence page, that earns citations and reinforces authority.`,
    `Turn the strongest proof asset into an outreach sequence for analysts, directories, and partner ecosystems that can reference ${entityLabel}.`,
  ].filter(Boolean).slice(0, 3);
}

export function positioningProofTactics(
  companyContext?: CompanyNarrativeContext,
  publicAudit?: PublicAuditResult | null,
): string[] {
  const primaryPages = topTrafficPotentialPages(publicAudit);
  const pageLabel = primaryPages.length ? primaryPages.slice(0, 2).join(' and ') : 'the homepage and primary commercial pages';
  return [
    `Add above-the-fold trust signals on ${pageLabel}, including proof bars, customer evidence, and a clearer category claim.`,
    'Introduce expert positioning blocks that explain who the offer is for, what it replaces, and why it is credible in this market.',
    'Add credibility modules such as testimonials, implementation proof, certifications, or outcome callouts directly beside conversion paths.',
  ];
}

export function comparisonPageTactics(
  decision: PersistedDecisionObject,
  publicAudit?: PublicAuditResult | null,
): string[] {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const thinPages = splitCandidates(payload.thin_pages);
  const startingPages = thinPages.length ? thinPages.slice(0, 2).join(' and ') : topTrafficPotentialPages(publicAudit).slice(0, 2).join(' and ');
  return [
    `Build /vs/ pages for the highest-priority alternatives and route them from ${startingPages || 'the key commercial pages'} first.`,
    'Add objection-handling sections that answer pricing, switching risk, implementation effort, and fit questions before the CTA.',
    'Create decision-stage pages that compare options, summarize tradeoffs, and move buyers toward a confident next step.',
  ];
}

export function buildStructuredTactics(params: {
  decision: PersistedDecisionObject;
  companyContext?: CompanyNarrativeContext;
  strategicContext?: StrategicContext;
  publicAudit?: PublicAuditResult | null;
  competitorIntelligence?: CompetitorIntelligenceResult | null;
  authorityScore?: number | null;
  contentQualityScore?: number | null;
  aiVisibilityScore?: number | null;
}): string[] {
  const { decision, companyContext, publicAudit, authorityScore, aiVisibilityScore } = params;
  const issueType = String(decision.issue_type ?? '').toLowerCase();
  const actionType = String(decision.action_type ?? '').toLowerCase();

  if (isAuthorityDecision(decision)) {
    return authorityActionTactics(authorityScore, companyContext);
  }
  if (actionType === 'comparison_pages' || issueType.includes('comparison')) {
    return comparisonPageTactics(decision, publicAudit);
  }
  if (actionType === 'positioning_proof' || issueType.includes('positioning')) {
    return positioningProofTactics(companyContext, publicAudit);
  }
  if (issueType.includes('backlink') || issueType.includes('authority')) {
    return backlinkTactics(authorityScore, companyContext);
  }
  if (issueType.includes('content') || issueType.includes('depth')) {
    return contentDepthTactics(publicAudit);
  }
  if (issueType.includes('competitor') || issueType.includes('gap')) {
    return competitorGapTactics(params.competitorIntelligence, companyContext);
  }
  if (issueType.includes('geo') || issueType.includes('ai_visibility')) {
    return aiVisibilityTactics(aiVisibilityScore, publicAudit);
  }
  // Default: generic tactics
  const focus = companyContext?.companyName || 'the site';
  return [
    `Prioritize the highest-impact opportunity identified and assign a clear owner and deadline.`,
    `Build evidence or proof for the fix so results can be measured after execution.`,
    `Document what worked so ${focus} can apply the pattern to adjacent opportunities.`,
  ];
}
