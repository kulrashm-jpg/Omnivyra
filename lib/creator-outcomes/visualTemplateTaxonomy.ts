/**
 * Visual Template Taxonomy + business-language titles (CREATOR-049, STEP 2/3/11).
 *
 * A pure presentation layer over the EXISTING template + outcome registries — no
 * duplicate engine, no new registry, no deletion. It provides:
 *   • templateVisualFamily(id) — the canonical VISUAL/format family a template
 *     belongs to (derived from its single outcome → exactly one family).
 *   • templateBusinessTitle(id) — a business-language title that replaces the
 *     implementation name ("Bold Headline" → "Bold Statement").
 *
 * The recommendation engine is reused unchanged; only the labels it surfaces
 * change (STEP 11). Pure visual-STYLE families (3D / watercolour / photography)
 * are properties of the RENDERED creative, not the layout template, so they live
 * on showcase assets (ShowcaseKind), not here.
 */

import { CREATOR_OUTCOMES } from './outcomeRegistry';

export type VisualFamily =
  | 'product-launch' | 'offer' | 'event' | 'lead-capture' | 'announcement'
  | 'educational' | 'process' | 'comparison' | 'checklist' | 'faq' | 'framework'
  | 'thought-leadership' | 'myth-fact' | 'statistics' | 'brand'
  | 'testimonial' | 'case-study' | 'before-after' | 'milestone'
  | 'hiring' | 'behind-the-scenes' | 'company-update' | 'timeline';

export const VISUAL_FAMILY_LABELS: Record<VisualFamily, string> = {
  'product-launch': 'Product Launch', offer: 'Offers & Promotions', event: 'Event Promotion',
  'lead-capture': 'Lead Capture', announcement: 'Announcements', educational: 'Educational',
  process: 'Process & How-To', comparison: 'Comparison', checklist: 'Checklists & Tips',
  faq: 'FAQ', framework: 'Frameworks & Diagrams', 'thought-leadership': 'Thought Leadership',
  'myth-fact': 'Myth vs Fact', statistics: 'Statistics', brand: 'Brand & Identity',
  testimonial: 'Testimonials', 'case-study': 'Case Studies', 'before-after': 'Before / After',
  milestone: 'Milestones', hiring: 'Hiring', 'behind-the-scenes': 'Behind the Scenes',
  'company-update': 'Company Updates', timeline: 'Timelines & Roadmaps',
};

/** Each business outcome maps to exactly one visual/format family. */
const OUTCOME_TO_VISUAL: Record<string, VisualFamily> = {
  'launch-product': 'product-launch', 'promote-offer': 'offer', 'promote-event': 'event',
  'generate-leads': 'lead-capture', 'announce-news': 'announcement', 'educate-audience': 'educational',
  'explain-process': 'process', 'compare-options': 'comparison', 'tips-and-mistakes': 'checklist',
  'answer-faqs': 'faq', 'present-framework': 'framework', 'industry-insight': 'thought-leadership',
  'bust-a-myth': 'myth-fact', 'highlight-statistic': 'statistics', 'brand-awareness': 'brand',
  'increase-trust': 'testimonial', 'customer-success': 'case-study', 'show-transformation': 'before-after',
  'celebrate-milestone': 'milestone', 'hiring': 'hiring', 'behind-the-scenes': 'behind-the-scenes',
  'company-update': 'company-update', 'timeline-roadmap': 'timeline',
};

/** Reverse index: template id → its single outcome (reuses the 044 registry). */
const TEMPLATE_TO_OUTCOME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const o of CREATOR_OUTCOMES) {
    for (const fam of ['image', 'carousel', 'infographic'] as const) {
      for (const id of o.templateIds[fam] ?? []) m[id] = o.id;
    }
  }
  return m;
})();

/** The canonical visual family for a template (exactly one). */
export function templateVisualFamily(templateId: string): VisualFamily | null {
  const outcomeId = TEMPLATE_TO_OUTCOME[templateId];
  return outcomeId ? OUTCOME_TO_VISUAL[outcomeId] ?? null : null;
}

/** Business-language titles for implementation-named templates (STEP 3). */
const BUSINESS_TITLE: Record<string, string> = {
  'sys-image-headline': 'Bold Statement', 'sys-image-headline-sub-cta': 'Product Announcement',
  'sys-image-quote-author': 'Expert Quote', 'sys-image-logo-only': 'Brand Mark',
  'sys-image-statistic': 'Key Statistic', 'sys-image-checklist': 'Action Checklist',
  'sys-image-promotion': 'Special Offer', 'sys-image-event': 'Event Promotion',
  'sys-image-feature-highlight': 'Feature Spotlight', 'sys-image-comparison': 'Side-by-Side Comparison',
  'sys-image-before-after': 'Product Transformation', 'sys-image-tip-card': 'Quick Tip',
  'sys-image-hero-announcement': 'Big Announcement', 'sys-image-minimal-brand-card': 'Minimal Brand Card',
  'sys-banner-website-hero': 'Website Hero', 'sys-banner-webinar': 'Webinar Promotion',
  'sys-banner-event': 'Event Banner', 'sys-banner-sale': 'Sale Banner',
  'sys-banner-product-launch': 'Product Launch Banner', 'sys-banner-hiring': 'Hiring Banner',
  'sys-banner-newsletter': 'Newsletter Signup', 'sys-banner-cta': 'Call to Action',
  'sys-carousel-educational-5': 'Educational Explainer', 'sys-carousel-storytelling-7': 'Brand Story',
  'sys-carousel-checklist-10': 'Action Checklist', 'sys-carousel-step-by-step': 'Step-by-Step Guide',
  'sys-carousel-mistakes': 'Common Mistakes', 'sys-carousel-tips': 'Quick Tips',
  'sys-carousel-faq': 'Frequently Asked Questions', 'sys-carousel-listicle': 'Top List',
  'sys-carousel-process': 'Process Walkthrough', 'sys-carousel-product-walkthrough': 'Product Walkthrough',
  'sys-carousel-marketing-funnel': 'Marketing Funnel', 'sys-carousel-customer-journey': 'Customer Journey',
  'sys-carousel-problem-solution': 'Problem & Solution', 'sys-carousel-transformation': 'Transformation Story',
  'sys-infographic-statistics': 'Statistics Highlight', 'sys-infographic-process': 'Process Flow',
  'sys-infographic-pyramid': 'Priority Pyramid', 'sys-infographic-funnel': 'Conversion Funnel',
  'sys-infographic-lifecycle': 'Lifecycle Diagram', 'sys-infographic-roadmap': 'Roadmap',
  'sys-infographic-matrix': 'Decision Matrix', 'sys-infographic-decision-tree': 'Decision Flow',
  'sys-infographic-cycle': 'Cycle Diagram', 'sys-infographic-workflow': 'Workflow',
  'sys-infographic-kpi-dashboard': 'KPI Snapshot', 'sys-infographic-org-structure': 'Org Chart',
};

/**
 * Business-language title for a template. Uses the curated override, else the
 * template's own name (many are already business language, e.g. "Customer
 * Testimonial"). `templateName` is passed by the caller (which already holds the
 * CreatorTemplate) so this module stays dependency-light.
 */
export function templateBusinessTitle(templateId: string, templateName?: string): string {
  return BUSINESS_TITLE[templateId] ?? templateName ?? templateId;
}

/** Has the template been given an explicit business title (vs. falling back)? */
export function hasBusinessTitleOverride(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUSINESS_TITLE, templateId);
}
