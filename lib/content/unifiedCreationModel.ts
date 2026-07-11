/**
 * Unified Creation Model (CREATOR-057).
 *
 * One canonical model behind Writer + Creator + Campaign so users think only
 * "I want to create marketing content" and the system routes the workflow:
 *
 *   Creation Goal → Content Type → Creation Mode → AI Brief → Generation → Review → Publish
 *
 * This is the additive, generation-free FOUNDATION for unification: a single goal
 * taxonomy (reuses the outcome registry), one normalized content-type registry
 * across the three lanes, deterministic goal→content-type routing, ONE shared
 * MarketingBrief, and ONE CreationPlan. Existing editors/runtime are unchanged;
 * each lane CAN adopt these instead of its own duplicate brief/routing.
 */

import type { TemplateAssetFamily } from '../creator-templates/types';
import { CREATOR_OUTCOMES, getOutcome, type CreatorOutcome } from '../creator-outcomes/outcomeRegistry';

export type CreationLane = 'writer' | 'creator' | 'campaign';

/** A Creation Goal is a business outcome — reuses the canonical outcome registry. */
export type CreationGoal = CreatorOutcome;
export function listCreationGoals(): CreationGoal[] { return CREATOR_OUTCOMES; }
export function getCreationGoal(id: string): CreationGoal | null { return getOutcome(id); }

/* ── Canonical content types (STEP 3) — normalized, no duplicate terminology ── */

export interface ContentType {
  id: string;
  label: string;
  lane: CreationLane;
  family?: TemplateAssetFamily;     // creator lane only
  /** Entry route for this content type (existing routes — not changed here). */
  entryRoute: string;
}

export const CONTENT_TYPES: ContentType[] = [
  // Writer
  { id: 'blog', label: 'Blog', lane: 'writer', entryRoute: '/blogs/new' },
  { id: 'article', label: 'Article', lane: 'writer', entryRoute: '/articles/new' },
  { id: 'story', label: 'Story', lane: 'writer', entryRoute: '/stories/new' },
  { id: 'guide', label: 'Guide', lane: 'writer', entryRoute: '/guides/new' },
  { id: 'newsletter', label: 'Newsletter', lane: 'writer', entryRoute: '/newsletters/new' },
  { id: 'whitepaper', label: 'Whitepaper', lane: 'writer', entryRoute: '/whitepapers/new' },
  { id: 'case-study', label: 'Case Study', lane: 'writer', entryRoute: '/case-studies/new' },
  // Creator
  { id: 'image', label: 'Image', lane: 'creator', family: 'image', entryRoute: '/command-center/creator-content/image/templates' },
  { id: 'carousel', label: 'Carousel', lane: 'creator', family: 'carousel', entryRoute: '/command-center/creator-content/carousel/templates' },
  { id: 'infographic', label: 'Infographic', lane: 'creator', family: 'infographic', entryRoute: '/command-center/creator-content/infographic/templates' },
  { id: 'branded-card', label: 'Branded Card', lane: 'creator', family: 'image', entryRoute: '/command-center/creator-content/image/templates' },
  { id: 'post', label: 'Post', lane: 'creator', family: 'image', entryRoute: '/command-center/creator-content/image/templates' },
  // Campaign
  { id: 'bolt-creator-campaign', label: 'Creator Campaign', lane: 'campaign', entryRoute: '/command-center/bolt-creator-strategy' },
  { id: 'intelligent-mix-campaign', label: 'Intelligent Mix Campaign', lane: 'campaign', entryRoute: '/command-center/bolt-combined-strategy' },
  // Strategic Mix P0 (STRATEGIC-MIX-SPEC-001 §0, invariant I-12): the Campaign
  // Planner is THE canonical Strategic Mix shell. Previously this pointed at the
  // BOLT Combined single-form builder (Intelligent Mix's page), creating two
  // products under one name. Exactly one route may claim Strategic Mix.
  { id: 'strategic-mix-campaign', label: 'Strategic Mix Campaign', lane: 'campaign', entryRoute: '/campaign-planner?mode=direct' },
];

export const CONTENT_TYPE_BY_ID: Record<string, ContentType> = Object.fromEntries(CONTENT_TYPES.map((c) => [c.id, c]));
export function getContentType(id: string): ContentType | null { return CONTENT_TYPE_BY_ID[id] ?? null; }
export function listContentTypes(lane?: CreationLane): ContentType[] { return lane ? CONTENT_TYPES.filter((c) => c.lane === lane) : CONTENT_TYPES; }

/* ── Intelligent routing (STEP 5) — deterministic goal → content types ──────── */

/** Per-goal Writer + Campaign suggestions; Creator types derive from the goal's families. */
const GOAL_WRITER: Record<string, string[]> = {
  'industry-insight': ['article'], 'customer-success': ['case-study', 'blog'], 'educate-audience': ['guide'],
  'explain-process': ['guide'], 'present-framework': ['guide', 'whitepaper'], 'announce-news': ['blog'],
  'highlight-statistic': ['article'], 'compare-options': ['article'], 'company-update': ['newsletter'],
  'answer-faqs': ['guide'],
};
const GOAL_CAMPAIGN: Record<string, string[]> = {
  'launch-product': ['bolt-creator-campaign', 'strategic-mix-campaign'], 'generate-leads': ['intelligent-mix-campaign'],
  'promote-event': ['bolt-creator-campaign'], 'promote-offer': ['bolt-creator-campaign'], 'brand-awareness': ['strategic-mix-campaign'],
};

export interface CreationRoute { contentType: ContentType; lane: CreationLane; rationale: string }

/** Recommend content types across lanes for a goal (the user may override). */
export function routeGoalToContentTypes(goalId: string): CreationRoute[] {
  const goal = getCreationGoal(goalId);
  if (!goal) return [];
  const routes: CreationRoute[] = [];
  for (const wid of GOAL_WRITER[goalId] ?? []) { const ct = getContentType(wid); if (ct) routes.push({ contentType: ct, lane: 'writer', rationale: `${goal.label} reads well as long-form ${ct.label}.` }); }
  for (const fam of goal.supportedFamilies) { const ct = getContentType(fam); if (ct) routes.push({ contentType: ct, lane: 'creator', rationale: `${goal.label} works as a ${ct.label}.` }); }
  for (const cid of GOAL_CAMPAIGN[goalId] ?? []) { const ct = getContentType(cid); if (ct) routes.push({ contentType: ct, lane: 'campaign', rationale: `Scale ${goal.label} across channels with a ${ct.label}.` }); }
  return routes;
}

/* ── Shared AI Brief (STEP 6) — one object every module consumes ────────────── */

export interface MarketingBrief {
  goalId: string | null;
  business?: string;
  audience?: string;
  offer?: string;
  tone?: string;
  cta?: string;
  brand?: string;
  reference?: string;
  website?: string;
  voiceNotes?: string;
  files?: string[];
  competitors?: string[];
  freeText?: string;            // the conversational brief
}

export function emptyMarketingBrief(goalId: string | null = null): MarketingBrief {
  return { goalId, files: [], competitors: [] };
}
/** Merge a partial update into the shared brief (last-write-wins per field). */
export function mergeBrief(base: MarketingBrief, patch: Partial<MarketingBrief>): MarketingBrief {
  return { ...base, ...patch, files: patch.files ?? base.files, competitors: patch.competitors ?? base.competitors };
}

/* ── Shared Creation Plan (STEP 7) — approved once, fans out (STEP 8) ────────── */

export interface CreationPlan {
  goalId: string;
  brief: MarketingBrief;
  lanes: Record<CreationLane, ContentType[]>;
  approved: boolean;
}

/** Build the canonical plan from a goal + shared brief (selected content types optional). */
export function buildCreationPlan(goalId: string, brief: MarketingBrief, selected?: string[]): CreationPlan | null {
  const goal = getCreationGoal(goalId);
  if (!goal) return null;
  const chosen = routeGoalToContentTypes(goalId)
    .map((r) => r.contentType)
    .filter((ct) => !selected || selected.includes(ct.id));
  const lanes: Record<CreationLane, ContentType[]> = { writer: [], creator: [], campaign: [] };
  for (const ct of chosen) lanes[ct.lane].push(ct);
  return { goalId, brief: { ...brief, goalId }, lanes, approved: false };
}
