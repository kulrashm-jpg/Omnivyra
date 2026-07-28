/**
 * V-B201 — Behavioral Intelligence Engine (deterministic contributor). Expands behavioral understanding
 * from evidence: content categories, engagement diversity, interaction diversity, navigation, search,
 * downloads, repeat behaviors. Descriptive only — NO prediction, NO intent. Abstains without behavior.
 */

import type { VisitorEngineOutput, VisitorIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runBehavioral(ctx: VisitorIntelligenceContext): VisitorEngineOutput {
  const r = ctx.raw; if (!r) return emptyOutput('behavioral');
  const src = r.source ?? 'visitor_capture', at = r.asOf ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v: string[] | undefined) => { if (v && v.length) ev.push(mkEvidence('behavioral', { label: l, value: v.join('; '), source: src, observedAt: at, kind: 'observed' })); };
  add('pages', r.pagesViewed); add('content', r.contentConsumed); add('search', r.searchActivity);
  add('downloads', r.downloads); add('events', r.engagementEvents); add('categories', r.interactionCategories);
  if (!ev.length) return emptyOutput('behavioral');

  const o: VisitorEngineOutput = { ...emptyOutput('behavioral'), abstained: false, evidence: ev };
  const categoryDiversity = new Set(r.interactionCategories ?? []).size;
  const eventDiversity = new Set(r.engagementEvents ?? []).size;
  const repeatBehaviors = (r.pagesViewed ?? []).length - new Set(r.pagesViewed ?? []).size; // repeats = views - distinct

  o.facets.behavioral = facet({
    pagesViewed: r.pagesViewed, contentConsumed: r.contentConsumed, searchActivity: r.searchActivity,
    downloads: r.downloads, engagementEvents: r.engagementEvents, interactionCategories: r.interactionCategories,
  }, ev);

  // reach = breadth of content/pages/categories consumed (descriptive)
  const breadth = clamp01(((r.pagesViewed?.length ?? 0) + (r.contentConsumed?.length ?? 0) + categoryDiversity) / 12);
  o.contributions.push({ dimension: 'reach', contributor: 'behavioral', method: 'deterministic', value: breadth, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  // engagement = interaction + event diversity + downloads/search activity
  const activity = clamp01((eventDiversity + (r.downloads?.length ?? 0) + (r.searchActivity?.length ?? 0)) / 8);
  o.contributions.push({ dimension: 'engagement', contributor: 'behavioral', method: 'deterministic', value: activity, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });

  o.reasoning.push(reasoningTrace({ claim: 'behavioral_breadth', conclusion: breadth, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`categories=${categoryDiversity}, events=${eventDiversity}, repeats=${repeatBehaviors}`], unknowns: [] }));
  return o;
}
