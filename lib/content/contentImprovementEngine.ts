import { calculateQualityScore, type FormMeta } from '../blog/blogValidation';
import { computeSearchScores, type BlogPost } from '../blog/searchScoringEngine';
import { analyzeOptimization, type OptimizationAction, type InstructionCode } from '../blog/optimizationEngine';
import { applyOptimizationActions, type BlogForRegeneration } from '../blog/regenerationExecutor';
import type { ContentBlock } from '../blog/blockTypes';
import { buildFormattedStyleInstructions } from './writingStyleEngine';
import type { CompanyProfile } from '../../backend/services/companyProfileService';

export type ImprovementArea = 'structure' | 'depth' | 'seo' | 'geo' | 'linking';

export type ImproveBlogDraftInput = {
  companyId: string;
  area: ImprovementArea;
  draft: {
    title: string;
    excerpt?: string;
    seo_meta_title?: string;
    seo_meta_description?: string;
    tags?: string[];
    content_blocks: ContentBlock[];
  };
  context?: {
    contentType?: string;
    socialPlatform?: string;
    campaignContext?: string;
    trendContext?: string;
  };
  companyProfile?: CompanyProfile | null;
};

export type ImproveBlogDraftOutput = {
  updated: {
    title: string;
    excerpt: string;
    seo_meta_title: string;
    seo_meta_description: string;
    tags: string[];
    content_blocks: ContentBlock[];
  };
  beforeScore: number;
  afterScore: number;
  appliedActions: string[];
  scoreDelta: number;
};

const AREA_CODE_ALLOWLIST: Record<ImprovementArea, string[]> = {
  structure: ['ADD_SUMMARY', 'ADD_FAQ', 'ADD_REFERENCES', 'ADD_HEADINGS', 'EXPAND_SECTION'],
  depth: ['EXPAND_SECTION', 'ADD_FAQ', 'ADD_SUMMARY', 'ADD_HEADINGS'],
  seo: ['FIX_TITLE_KEYWORD', 'ADD_INTERNAL_LINKS', 'ADD_SUMMARY', 'ADD_REFERENCES'],
  geo: ['ADD_REFERENCES', 'ADD_FAQ', 'ADD_SUMMARY', 'ADD_HEADINGS'],
  linking: ['ADD_INTERNAL_LINKS'],
};

function toFormMeta(input: ImproveBlogDraftInput['draft']): FormMeta {
  return {
    title: input.title || '',
    excerpt: input.excerpt || '',
    seo_meta_title: input.seo_meta_title || '',
    seo_meta_description: input.seo_meta_description || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
}

function toBlogPost(input: ImproveBlogDraftInput['draft']): BlogPost {
  const blocks = Array.isArray(input.content_blocks) ? input.content_blocks : [];
  const internalLinks = blocks.filter((b) => b.type === 'internal_link').length;
  const referencesCount = blocks
    .filter((b) => b.type === 'references')
    .reduce((sum, b) => sum + (Array.isArray((b as { items?: unknown[] }).items) ? (b as { items: unknown[] }).items.length : 0), 0);

  return {
    title: input.title || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    internal_links: internalLinks,
    references_count: referencesCount,
    content_blocks: blocks,
  };
}

function findHeadingTargets(blocks: ContentBlock[], max = 2): OptimizationAction[] {
  const headings = blocks
    .filter((b) => b.type === 'heading')
    .slice(0, max)
    .map((b) => ({ id: b.id, text: (b as { text?: string }).text || 'Section' }));

  return headings.map((h): OptimizationAction => ({
    type: 'section_expand',
    instruction_code: 'EXPAND_SECTION',
    priority: 'medium',
    instruction: `Expand section "${h.text}" with more depth and practical examples.`,
    impact: 35,
    expected_score_gain: { seo: 4 },
    target: h.text,
    target_block_id: h.id,
  }));
}

function selectActions(
  area: ImprovementArea,
  actions: OptimizationAction[],
  blocks: ContentBlock[],
  depthMeta: { wordCount: number; h2Count: number; shortParaCount: number },
): OptimizationAction[] {
  const allow = new Set(AREA_CODE_ALLOWLIST[area]);
  const executable = new Set([
    'ADD_SUMMARY',
    'ADD_FAQ',
    'ADD_REFERENCES',
    'ADD_INTERNAL_LINKS',
    'FIX_TITLE_KEYWORD',
    'EXPAND_SECTION',
    'ADD_HEADINGS',
  ]);

  let picked = actions
    .filter((a) => allow.has(a.instruction_code))
    .filter((a) => executable.has(a.instruction_code))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);

  // If depth is low but there are no thin sections, add new sections instead of only expanding existing ones.
  if (area === 'depth' && depthMeta.wordCount < 800 && depthMeta.shortParaCount === 0 && depthMeta.h2Count < 4) {
    const hasAddHeadings = picked.some((a) => a.instruction_code === 'ADD_HEADINGS');
    if (!hasAddHeadings) {
      picked = [
        {
          type: 'structure_add_headings',
          instruction_code: 'ADD_HEADINGS' as InstructionCode,
          priority: 'high' as const,
          instruction: 'Add 2 strategic H2 sections to increase depth and narrative flow.',
          impact: 55,
          expected_score_gain: { seo: 10 },
        },
        ...picked,
      ].slice(0, 5);
    }
  }

  if (picked.length > 0) return picked;

  // Fallback strategy for drafts with sparse analyzer output
  if (area === 'linking') {
    return [{
      type: 'seo_add_internal_links',
      instruction_code: 'ADD_INTERNAL_LINKS' as InstructionCode,
      priority: 'high' as const,
      instruction: 'Add 2+ internal links to related company posts.',
      impact: 45,
      expected_score_gain: { seo: 6 },
    }];
  }

  if (area === 'seo') {
    return [{
      type: 'seo_title',
      instruction_code: 'FIX_TITLE_KEYWORD' as InstructionCode,
      priority: 'medium' as const,
      instruction: 'Rewrite title for keyword clarity.',
      impact: 30,
      expected_score_gain: { seo: 8 },
    }];
  }

  if (area === 'depth') {
    const expanders = findHeadingTargets(blocks, 2);
    if (depthMeta.wordCount < 800 && depthMeta.h2Count < 4) {
      return [{
        type: 'structure_add_headings',
        instruction_code: 'ADD_HEADINGS' as InstructionCode,
        priority: 'high' as const,
        instruction: 'Add 2 new H2 sections with practical detail to improve overall depth.',
        impact: 52,
        expected_score_gain: { seo: 10 },
      }, ...expanders].slice(0, 3);
    }
    if (expanders.length > 0) return expanders;
  }

  if (area === 'structure' || area === 'geo') {
    return [{
      type: 'add_summary',
      instruction_code: 'ADD_SUMMARY' as InstructionCode,
      priority: 'medium' as const,
      instruction: 'Add a concise summary block for structure and extraction readiness.',
      impact: 30,
      expected_score_gain: { seo: 5, aeo: 8 },
    }];
  }

  return [];
}

function buildContextLine(input: ImproveBlogDraftInput): string {
  const chunks: string[] = [];

  if (input.context?.contentType) chunks.push(`Content type: ${input.context.contentType}`);
  if (input.context?.socialPlatform) chunks.push(`Platform: ${input.context.socialPlatform}`);
  if (input.context?.campaignContext) chunks.push(`Campaign context: ${input.context.campaignContext}`);
  if (input.context?.trendContext) chunks.push(`Trend context: ${input.context.trendContext}`);

  if (input.companyProfile) {
    chunks.push(buildFormattedStyleInstructions(input.companyProfile));
  }

  return chunks.join('\n');
}

export async function improveBlogDraft(input: ImproveBlogDraftInput): Promise<ImproveBlogDraftOutput> {
  const safeDraft = {
    title: input.draft.title || '',
    excerpt: input.draft.excerpt || '',
    seo_meta_title: input.draft.seo_meta_title || '',
    seo_meta_description: input.draft.seo_meta_description || '',
    tags: Array.isArray(input.draft.tags) ? input.draft.tags : [],
    content_blocks: Array.isArray(input.draft.content_blocks) ? input.draft.content_blocks : [],
  };

  const before = calculateQualityScore(safeDraft.content_blocks, toFormMeta(safeDraft));
  const post = toBlogPost(safeDraft);
  const scores = computeSearchScores(post);
  const analysis = analyzeOptimization(post, scores);
  const selectedActions = selectActions(input.area, analysis.actions, safeDraft.content_blocks, {
    wordCount: before.meta.wordCount,
    h2Count: before.meta.h2Count,
    shortParaCount: before.meta.shortParaCount,
  });

  const blogForRegen: BlogForRegeneration = {
    id: 'draft',
    title: safeDraft.title,
    content_blocks: safeDraft.content_blocks,
    company_id: input.companyId,
  };

  const regen = await applyOptimizationActions(blogForRegen, selectedActions, {
    additionalContext: buildContextLine(input),
  });

  const updated = {
    ...safeDraft,
    title: regen.title_change || safeDraft.title,
    content_blocks: regen.updated_blocks,
  };

  const after = calculateQualityScore(updated.content_blocks, toFormMeta(updated));

  return {
    updated,
    beforeScore: before.total,
    afterScore: after.total,
    scoreDelta: after.total - before.total,
    appliedActions: regen.changes
      .filter((c) => c.status === 'applied')
      .map((c) => c.instruction_code),
  };
}
