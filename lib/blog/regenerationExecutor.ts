/**
 * Regeneration Executor
 *
 * Applies targeted OptimizationActions to a blog post's content_blocks.
 *
 * Design rules:
 *   - Surgical updates only — never replaces the entire content_blocks array.
 *   - Each action targets a specific block or appends to a specific position.
 *   - AI is only used for text generation; block structure is deterministic.
 *   - Actions are applied sequentially so each action sees the prior result.
 *   - A failed action records an error in changes[] and execution continues.
 *
 * Supported instruction codes:
 *   ADD_SUMMARY        — Insert a summary block near the top.
 *   ADD_FAQ            — Append a FAQ section (heading + callout pairs).
 *   EXPAND_SECTION     — Replace paragraph(s) in a target section with AI-expanded text.
 *   ADD_REFERENCES     — Append (or merge) a references block.
 *   ADD_INTERNAL_LINKS — Insert internal_link blocks from other company posts.
 *   ADD_HEADINGS       — Add 2 strategic H2 sections with paragraph content.
 *   FIX_TITLE_KEYWORD  — Rewrite the post title to lead with its primary keyword.
 */

import { newId } from './blockUtils';
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { supabase } from '../../backend/db/supabaseClient';
import type {
  ContentBlock,
  SummaryBlock,
  HeadingBlock,
  ParagraphBlock,
  CalloutBlock,
  ReferencesBlock,
  InternalLinkBlock,
} from './blockTypes';
import type { OptimizationAction } from './optimizationEngine';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RegenerationChange {
  instruction_code: string;
  status: 'applied' | 'failed' | 'skipped';
  reason?: string;
}

export interface RegenerationResult {
  updated_blocks: ContentBlock[];
  /** Present only when FIX_TITLE_KEYWORD was applied. */
  title_change?: string;
  changes: RegenerationChange[];
}

export interface BlogForRegeneration {
  id: string;
  title: string;
  content_blocks: ContentBlock[];
  company_id: string;
}

export interface RegenerationOptions {
  /**
   * Extra context appended to each AI instruction.
   * Use this for company voice, campaign objective, platform constraints,
   * and trend signals so targeted improvements stay aligned.
   */
  additionalContext?: string;
  /**
   * Blog Regeneration Governance Parity — optional governance prompt
   * context. When present and the resolved industry is regulated,
   * EVERY regeneration system prompt is prepended with the canonical
   * compliance preamble (parity with initial blog generation, image
   * composer, text orchestrator, theme treatment).
   *
   * When omitted, `applyOptimizationActions` resolves it once from
   * `blog.company_id` using the existing
   * `buildGovernancePromptContext` helper — same path used by the
   * blog runner and the post / thread / theme-treatment paths. Null
   * / `industry='none'` → strict no-op (byte-identical system prompts
   * to legacy callers).
   */
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null;
}

// ── AI system prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a professional content editor optimizing blog content for SEO, AEO, and GEO. ' +
  'Rules: do not change tone drastically; preserve meaning; improve clarity, depth, and structure. ' +
  'Always respond with valid JSON only — no markdown fences, no prose outside the JSON object.';

/**
 * Blog Regeneration Governance Parity — wraps the editor SYSTEM_PROMPT
 * with the canonical compliance preamble when governance is present.
 * Returns `SYSTEM_PROMPT` unchanged when `options.governance` is null
 * / undefined / `industry='none'` — preserving byte-identical legacy
 * behavior. Reuses the canonical
 * `applyGovernancePreambleToSystemPrompt` helper (no second
 * governance path).
 */
export function effectiveSystemPrompt(options?: RegenerationOptions): string {
  const { applyGovernancePreambleToSystemPrompt } =
    require('../../backend/services/creator/strategyGovernancePromptContext') as typeof import('../../backend/services/creator/strategyGovernancePromptContext');
  return applyGovernancePreambleToSystemPrompt(SYSTEM_PROMPT, options?.governance ?? null);
}


// Agent-B split: private helpers live in ./regenerationExecutorHelpersA + B (behavior-preserving).
import { applyAddFaq, applyAddSummary, applyExpandSection, blockToText, extractSectionText, insertAt, insertionIndex, stripHtml, withAdditionalContext } from './regenerationExecutorHelpersA';
import { applyAddHeadings, applyAddInternalLinks, applyAddReferences, applyFixTitleKeyword } from './regenerationExecutorHelpersB';

// ── Main executor ─────────────────────────────────────────────────────────────

/**
 * Applies a list of OptimizationActions to a blog post sequentially.
 *
 * Each action sees the blocks as modified by prior actions.
 * A failed action records the error in changes[] and execution continues.
 * Blocks outside the target of each action are never touched.
 */
export async function applyOptimizationActions(
  blog: BlogForRegeneration,
  actions: OptimizationAction[],
  options?: RegenerationOptions,
): Promise<RegenerationResult> {
  let blocks: ContentBlock[]        = [...blog.content_blocks];
  const changes: RegenerationChange[] = [];
  let titleChange: string | undefined;

  // Blog Regeneration Governance Parity — resolve governance ONCE per
  // regeneration call. When the caller already supplied `governance`
  // in options, it is preserved verbatim. Otherwise resolved from the
  // blog's company_id using the same buildGovernancePromptContext
  // helper the rest of the platform uses. Best-effort: failures leave
  // governance=null and behavior is byte-identical to legacy callers.
  let effectiveOptions: RegenerationOptions | undefined = options;
  if (!options?.governance) {
    try {
      const { getCanonicalProfile: getProfile } = await import('@/backend/services/context/canonicalProfileAdapter');
      const { buildGovernancePromptContext } = await import('../../backend/services/creator/strategyGovernancePromptContext');
      const profile = await getProfile(blog.company_id, { autoRefine: false });
      if (profile) {
        const ctx = buildGovernancePromptContext({
          companyContext: {
            industry: (profile as any).industry ?? null,
            industry_list: (profile as any).industry_list ?? null,
            category: (profile as any).category ?? null,
            category_list: (profile as any).category_list ?? null,
          },
          // Long-form regeneration shares the image-lane policy by
          // convention — same as initial blog generation, post,
          // thread, theme treatment.
          contentType: 'image',
          selectedStrategy: null,
        });
        // Reuse the canonical restricted-strategy audit hook so the
        // compliance trail captures regeneration paths too.
        try {
          const { maybeAuditRestrictedStrategySelection } =
            await import('../../backend/services/creator/governanceItemEnricher');
          maybeAuditRestrictedStrategySelection({
            context: ctx,
            companyId: blog.company_id,
            contentType: 'blog',
            actorUserId: null,
          });
        } catch {
          // Best-effort.
        }
        effectiveOptions = { ...(options ?? {}), governance: ctx };
      }
    } catch {
      // Best-effort — fall through with the original options.
    }
  }

  for (const action of actions) {
    try {
      switch (action.instruction_code) {
        case 'ADD_SUMMARY': {
          const r = await applyAddSummary(blog, blocks, effectiveOptions);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_FAQ': {
          const r = await applyAddFaq(blog, blocks, effectiveOptions);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'EXPAND_SECTION': {
          const r = await applyExpandSection(blog, blocks, action, effectiveOptions);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_REFERENCES': {
          const r = await applyAddReferences(blog, blocks, effectiveOptions);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_INTERNAL_LINKS': {
          const r = await applyAddInternalLinks(blog, blocks);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_HEADINGS': {
          const r = await applyAddHeadings(blog, blocks, effectiveOptions);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'FIX_TITLE_KEYWORD': {
          const r = await applyFixTitleKeyword(blog, blocks, effectiveOptions);
          blocks      = r.blocks;
          titleChange = r.titleChange;
          changes.push(r.change);
          break;
        }
        default: {
          changes.push({
            instruction_code: action.instruction_code,
            status:           'skipped',
            reason:           `"${action.instruction_code}" is not handled by the regeneration executor`,
          });
        }
      }
    } catch (err) {
      changes.push({
        instruction_code: action.instruction_code,
        status:           'failed',
        reason:           err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    updated_blocks: blocks,
    ...(titleChange !== undefined ? { title_change: titleChange } : {}),
    changes,
  };
}
