/**
 * POST /api/blogs/optimize
 *
 * Targeted regeneration engine — applies a list of OptimizationActions to
 * specific parts of a blog post without overwriting the entire content_blocks.
 *
 * Auth:   COMPANY_ADMIN only + enforceCompanyAccess
 * Table:  blogs (company-owned posts only)
 *
 * Body:
 * {
 *   company_id: string,
 *   blog_id:    string,
 *   actions:    OptimizationAction[],
 *   save?:      boolean   // default true — set false for preview mode
 * }
 *
 * Response:
 * {
 *   updated_blocks: ContentBlock[],
 *   title_change?:  string,          // present only when FIX_TITLE_KEYWORD applied
 *   changes: [{ instruction_code, status, reason? }],
 *   saved:   boolean
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  applyOptimizationActions,
  type BlogForRegeneration,
} from '../../../lib/blog/regenerationExecutor';
import type { ContentBlock } from '../../../lib/blog/blockTypes';
import type { OptimizationAction } from '../../../lib/blog/optimizationEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    blog_id,
    actions,
    save = true,
  } = req.body ?? {};

  // ── Input validation ─────────────────────────────────────────────────────────

  if (!company_id || typeof company_id !== 'string')
    return res.status(400).json({ error: 'company_id required' });

  if (!blog_id || typeof blog_id !== 'string')
    return res.status(400).json({ error: 'blog_id required' });

  if (!Array.isArray(actions) || actions.length === 0)
    return res.status(400).json({ error: 'actions array is required and must not be empty' });

  // Validate each action has an instruction_code at minimum.
  for (const a of actions) {
    if (!a || typeof a.instruction_code !== 'string') {
      return res.status(400).json({ error: 'Each action must have an instruction_code string' });
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId:    company_id,
    allowedRoles: [Role.COMPANY_ADMIN],
  });
  if (!roleGate) return;

  // ── Fetch blog ────────────────────────────────────────────────────────────────

  const { data: blog, error: blogError } = await supabase
    .from('blogs')
    .select('id, title, content_blocks, seo_meta_title, company_id')
    .eq('id', blog_id)
    .single();

  if (blogError || !blog) {
    return res.status(404).json({ error: 'Blog not found' });
  }

  // Verify the blog belongs to the requesting company.
  if (blog.company_id !== company_id) {
    return res.status(403).json({ error: 'Access denied: blog does not belong to this company' });
  }

  // ── Execute actions ───────────────────────────────────────────────────────────

  const blogForRegen: BlogForRegeneration = {
    id:             blog.id as string,
    title:          (blog.title as string | null) ?? '',
    content_blocks: Array.isArray(blog.content_blocks)
      ? (blog.content_blocks as ContentBlock[])
      : [],
    company_id:     blog.company_id as string,
  };

  const result = await applyOptimizationActions(
    blogForRegen,
    actions as OptimizationAction[],
  );

  // ── Optional save ─────────────────────────────────────────────────────────────

  if (save) {
    const patch: Record<string, unknown> = {
      content_blocks: result.updated_blocks,
      updated_at:     new Date().toISOString(),
    };

    if (result.title_change) {
      patch.title          = result.title_change;
      patch.seo_meta_title = result.title_change;
    }

    const { error: updateError } = await supabase
      .from('blogs')
      .update(patch)
      .eq('id', blog_id);

    if (updateError) {
      console.error('[POST /api/blogs/optimize] DB update failed', updateError);
      return res.status(500).json({ error: 'Failed to persist optimized content' });
    }
  }

  // ── Response ──────────────────────────────────────────────────────────────────

  return res.status(200).json({
    updated_blocks: result.updated_blocks,
    ...(result.title_change ? { title_change: result.title_change } : {}),
    changes:        result.changes,
    saved:          save,
  });
}
