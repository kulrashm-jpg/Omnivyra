/**
 * Website Intelligence business-impact configuration (Phase 18) — now Consumer #1 of the
 * Platform Business Impact Engine (Phase 21B). This file owns ONLY the website-specific
 * relationship graph + module-dimension defaults + dimension labels; the machinery
 * (buildBusinessImpact / aggregateBusinessImpact / estimateROI) lives in the platform
 * engine. The exported wrappers bind the website config, so output is byte-identical.
 */
import { buildBusinessImpact as platformBuildBusinessImpact, aggregateBusinessImpact as platformAggregate, estimateROI as platformEstimateROI, type ImpactGraphConfig, type BusinessImpact as PlatformBusinessImpact } from '../platformIntelligence/businessImpact';

export type ImpactDimension = 'technical' | 'seo' | 'accessibility' | 'content' | 'lead' | 'conversion' | 'authority' | 'marketing' | 'revenue';
export type BusinessImpact = PlatformBusinessImpact<ImpactDimension>;

const MODULE_DIMENSIONS: Record<string, Partial<Record<ImpactDimension, number>>> = {
  content_analysis: { content: 80, conversion: 60, authority: 50 },
  technical: { technical: 80, seo: 70 },
  accessibility: { accessibility: 80, seo: 50, authority: 40 },
  brand: { authority: 70, conversion: 50, marketing: 40 },
  seo: { seo: 85, authority: 60, marketing: 40 },
  performance: { conversion: 60, marketing: 50, seo: 40 },
  competitive: { authority: 60, marketing: 50 },
  tracking: { marketing: 75, conversion: 40 },
  attribution: { marketing: 70, lead: 50 },
  conversion: { conversion: 80, lead: 60, revenue: 50 },
  forms: { lead: 80, conversion: 60 },
  cms: { technical: 50, marketing: 40 },
  publishing: { marketing: 50, authority: 30 },
  integration: { technical: 50, marketing: 30 },
  domain: { authority: 60, seo: 50 },
  lead_readiness: { lead: 85, revenue: 60 },
  campaign_readiness: { marketing: 70 },
  marketing_readiness: { marketing: 75 },
  marketpulse: { marketing: 50, authority: 40 },
  website_intelligence: { authority: 50 },
};

const RELATIONSHIP_GRAPH: Record<string, { dimensions: Partial<Record<ImpactDimension, number>>; cascade: string[] }> = {
  pricing_visibility: { dimensions: { content: 70, conversion: 75, lead: 60, revenue: 65, authority: 40 }, cascade: ['Content', 'Lower trust', 'Lower conversion', 'Fewer qualified leads', 'Lower revenue confidence'] },
  cta_quality: { dimensions: { content: 60, conversion: 80, lead: 70, revenue: 50 }, cascade: ['Content', 'Weak call-to-action', 'Lower lead capture', 'Lower conversion', 'Lower revenue'] },
  conversion_copy: { dimensions: { content: 55, conversion: 75, lead: 55 }, cascade: ['Content', 'Unpersuasive copy', 'Lower conversion', 'Fewer leads'] },
  headline_clarity: { dimensions: { content: 50, seo: 55, accessibility: 60, authority: 45 }, cascade: ['Missing H1', 'Accessibility', 'SEO', 'Lower authority'] },
  heading_hierarchy: { dimensions: { accessibility: 70, seo: 60, authority: 40 }, cascade: ['Heading structure', 'Accessibility', 'SEO', 'Lower authority'] },
  link_text: { dimensions: { accessibility: 65, seo: 45 }, cascade: ['Generic link text', 'Accessibility', 'Weaker SEO anchors'] },
  https: { dimensions: { technical: 85, seo: 70, authority: 60, conversion: 40 }, cascade: ['Insecure pages', 'Technical risk', 'SEO penalty', 'Lower trust'] },
  broken_links: { dimensions: { technical: 80, seo: 70, conversion: 50, authority: 40 }, cascade: ['Broken pages', 'Crawl errors', 'Lost SEO equity', 'Lower trust'] },
  duplicate_titles: { dimensions: { seo: 70, authority: 40 }, cascade: ['Duplicate titles', 'Keyword cannibalisation', 'Lower SEO authority'] },
  duplicate_descriptions: { dimensions: { seo: 60 }, cascade: ['Duplicate descriptions', 'Weaker SERP differentiation'] },
  internal_linking: { dimensions: { seo: 65, authority: 45, content: 40 }, cascade: ['Weak internal linking', 'Diluted page authority', 'Lower SEO'] },
  meta_tags: { dimensions: { seo: 70, marketing: 40 }, cascade: ['Missing meta', 'Lower SERP CTR', 'Less organic traffic'] },
  open_graph: { dimensions: { marketing: 55, authority: 30 }, cascade: ['Missing Open Graph', 'Weaker social sharing'] },
  tracker_installed: { dimensions: { marketing: 80, conversion: 50, lead: 40 }, cascade: ['Tracking missing', 'Performance-data confidence', 'Marketing-intelligence confidence'] },
  tracking: { dimensions: { marketing: 80, conversion: 50 }, cascade: ['Tracking gap', 'Lower analytics confidence', 'Weaker marketing intelligence'] },
  attribution_capture: { dimensions: { marketing: 70, lead: 60, revenue: 40 }, cascade: ['Attribution gap', 'Unattributed leads', 'Harder ROI proof'] },
  contact_info: { dimensions: { conversion: 60, lead: 65, authority: 40 }, cascade: ['No contact path', 'Lower trust', 'Fewer inbound leads'] },
  legal_pages: { dimensions: { authority: 55, conversion: 40 }, cascade: ['Missing legal pages', 'Lower trust', 'Compliance risk'] },
  testimonials: { dimensions: { authority: 60, conversion: 55 }, cascade: ['No social proof', 'Lower trust', 'Lower conversion'] },
  social_proof: { dimensions: { authority: 60, conversion: 55 }, cascade: ['No social proof', 'Lower credibility', 'Lower conversion'] },
  case_studies: { dimensions: { authority: 55, conversion: 50, lead: 40 }, cascade: ['No case studies', 'Weaker proof', 'Lower qualified leads'] },
  brand_assets: { dimensions: { authority: 60, conversion: 40, marketing: 40 }, cascade: ['Incomplete brand', 'Lower professionalism', 'Lower trust'] },
  logo_consistency: { dimensions: { authority: 55, marketing: 40 }, cascade: ['Inconsistent logo', 'Weaker brand recall'] },
  messaging_consistency: { dimensions: { authority: 50, content: 45, conversion: 40 }, cascade: ['Inconsistent messaging', 'Diluted positioning', 'Lower conversion'] },
};

const DIMENSION_TAIL: Record<ImpactDimension, string> = {
  technical: 'technical reliability', seo: 'search visibility', accessibility: 'accessibility', content: 'content quality',
  lead: 'lead capture', conversion: 'conversion', authority: 'brand authority', marketing: 'marketing intelligence', revenue: 'revenue confidence',
};

export const WEBSITE_IMPACT_CONFIG: ImpactGraphConfig<ImpactDimension> = { graph: RELATIONSHIP_GRAPH, moduleDimensions: MODULE_DIMENSIONS, dimensionTail: DIMENSION_TAIL };

export function buildBusinessImpact(key: string, affectedModules: string[], level: 'high' | 'medium' | 'low'): BusinessImpact {
  return platformBuildBusinessImpact<ImpactDimension>(key, affectedModules, level, WEBSITE_IMPACT_CONFIG);
}

export const estimateROI = platformEstimateROI;

export function aggregateBusinessImpact(impacts: BusinessImpact[]): { dimensions: Partial<Record<ImpactDimension, number>>; topDimensions: ImpactDimension[]; summary: string } {
  return platformAggregate<ImpactDimension>(impacts, DIMENSION_TAIL);
}
