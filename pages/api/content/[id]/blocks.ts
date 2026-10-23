import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enforceContentWriteRole } from '@/backend/services/content/contentWriteAuthz';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as collaborationService from '@/backend/services/content/collaborationService';
import type { ContentBlock } from '@/lib/content/quality/types';

/**
 * Canonical content section-Blocks endpoint (Writer Wave 4).
 *
 * THE SERVICE SIGNATURES, AS THEY ACTUALLY ARE. All three entries below were
 * wrong in an earlier version of this header — two omitted companyId entirely
 * and two inverted the meaning of the first argument — and a reviewer showed
 * that swapping the arguments at BOTH call sites left every existing test
 * passing. A maintainer following the old header would have introduced exactly
 * that. backend/tests/unit/contentBlocksRouteCallContract.test.ts now asserts
 * the order behaviourally and kills the swap.
 *
 *   GET  /api/content/:id/blocks
 *     → collaborationService.listBlocks(contentId, companyId) → 200 { blocks }
 *   POST /api/content/:id/blocks
 *     - { action: 'lock', blockId, locked }
 *         → collaborationService.setBlockLocked(blockId, companyId, locked)
 *           — note the FIRST argument is the BLOCK id, not the content id in
 *             the path, which this function never receives.
 *         → 200 { block: CollabBlock | null }  — SINGULAR, and nullable.
 *           `null` means no row matched in this company, which is what a lock
 *           naming another tenant's block produces. The status is still 200, so
 *           a client cannot tell "locked" from "matched nothing" by status
 *           alone; the shipped hook does not read the body at all. Whether this
 *           should be a 404 is an OPEN OWNER DECISION, pinned by a test either
 *           way. An earlier version of this header put `→ 200 { blocks }` at the
 *           POST level, which covered this branch and was simply wrong about it.
 *     - { blocks: BlockUpsertInput[] } (default)
 *         → collaborationService.upsertBlocks(companyId, contentId, blocks)
 *           — companyId FIRST.
 *         → 200 { blocks }
 *           The element shape is BlockUpsertInput, not ContentBlock: `text` and
 *           `locked` are OPTIONAL on input (see parseBlockUpserts below).
 *
 * TENANT SCOPING, PRECISELY. Company-scoped via enforceCompanyAccess, and the
 * CONTENT named in the path is proved to belong to the caller's company by
 * getContent(id, companyId) before any block read or write.
 *
 * READ THAT AS WRITTEN: it is a guarantee about the CONTENT. An earlier version
 * said the route is "tenant-isolated by loading the canonical content row …
 * before any block read / write", which reads as a guarantee about the BLOCK
 * too, and on the lock path it is not one. collaborationService.setBlockLocked
 * filters on (id, company_id) and NOT on content_id, so a writer holding one
 * document of their own company can lock a block belonging to a DIFFERENT
 * document of that company by naming it in the body. That is company-scoped
 * and not content-scoped. It is not cross-tenant. Whether this path SHOULD be
 * content-scoped is an OPEN OWNER DECISION, recorded here and pinned by a test
 * so the behaviour cannot drift either way unnoticed; nothing in this file
 * resolves it.
 *
 * The upsert path is different and does prove block ownership: every
 * caller-supplied block id must already belong to BOTH the company and the
 * content, validated inside collaborationService.upsertBlocks before any write.
 *
 * NEW route — additive, backward-compatible.
 */
const BLOCK_TYPES: ReadonlySet<string> = new Set(['hook', 'opening', 'body', 'cta', 'hashtags', 'other']);

/**
 * Validate the POST body's `blocks` array into the service's input shape.
 * Throws an Error whose message is safe to return as a 400. Shape only — this
 * says nothing about who owns a supplied id; upsertBlocks establishes that.
 */
function parseBlockUpserts(raw: unknown[]): collaborationService.BlockUpsertInput[] {
  const out: collaborationService.BlockUpsertInput[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`blocks[${i}] must be an object`);
    }
    const b = item as Record<string, unknown>;

    const blockType = typeof b.blockType === 'string' ? b.blockType.trim() : '';
    if (!BLOCK_TYPES.has(blockType)) {
      throw new Error(`blocks[${i}].blockType is invalid`);
    }
    if (typeof b.position !== 'number' || !Number.isInteger(b.position) || b.position < 0) {
      throw new Error(`blocks[${i}].position must be a non-negative integer`);
    }

    const entry: collaborationService.BlockUpsertInput = {
      blockType: blockType as collaborationService.BlockUpsertInput['blockType'],
      position: b.position,
    };
    if (b.id !== undefined && b.id !== null) {
      if (typeof b.id !== 'string' || !b.id.trim()) throw new Error(`blocks[${i}].id must be a non-empty string`);
      entry.id = b.id.trim();
    }
    if (b.text !== undefined) {
      if (b.text !== null && typeof b.text !== 'string') throw new Error(`blocks[${i}].text must be a string or null`);
      entry.text = b.text as string | null;
    }
    if (b.locked !== undefined) {
      if (typeof b.locked !== 'boolean') throw new Error(`blocks[${i}].locked must be a boolean`);
      entry.locked = b.locked;
    }
    out.push(entry);
  });
  return out;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  // SEC-91 W2-G (STEP 3AH-91, W2G-1) — writes require a content authoring role
  // (PERMISSIONS.CREATE_CAMPAIGN) in the company authorized above; VIEW_ONLY and
  // its aliases stay read-only. Reads are unchanged. See contentWriteAuthz.ts.
  if ((req.method === 'POST') && !(await enforceContentWriteRole({ req, res, companyId: scopedCompanyId }))) return;

  // Tenant isolation: prove the content belongs to the caller's company.
  const content = await getContent(id, scopedCompanyId);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  if (req.method === 'GET') {
    try {
      const blocks = await collaborationService.listBlocks(id, scopedCompanyId);
      return res.status(200).json({ blocks });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load blocks');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';

    try {
      if (action === 'lock') {
        const blockId = typeof body.blockId === 'string' ? body.blockId.trim() : '';
        if (!blockId) return res.status(400).json({ error: 'blockId required' });
        const locked = body.locked !== false; // default true; explicit false unlocks
        const result = await collaborationService.setBlockLocked(blockId, scopedCompanyId, locked);
        return res.status(200).json({ block: result });
      }

      // The request body was previously cast straight through (`as never`) with
      // no per-element validation, so a caller-supplied `blocks[i].id` reached
      // the service unchecked. The route proves the CONTENT belongs to the
      // caller (getContent above); it never proved the BLOCKS did. Shape is
      // validated here; OWNERSHIP of each supplied id is validated in
      // collaborationService.upsertBlocks, which is the single place that can
      // see the persisted rows.
      if (!Array.isArray(body.blocks)) return res.status(400).json({ error: 'blocks array required' });
      let parsed: collaborationService.BlockUpsertInput[];
      try {
        parsed = parseBlockUpserts(body.blocks);
      } catch (invalid) {
        return res.status(400).json({ error: (invalid as Error).message });
      }
      const saved = await collaborationService.upsertBlocks(scopedCompanyId, id, parsed);
      return res.status(200).json({ blocks: saved });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to update blocks');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/blocks' });
