import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '@/shared/contracts/security';
import {
  createOperatorTopic,
  renameOperatorTopic,
} from '@/backend/services/content/knowledgeGraph/topicCurationService';

/**
 * B7.9 — operator topic authoring (platform operator surface).
 *
 *   POST  { label }           → create a new platform topic identity
 *   PATCH { topicId, label }  → rename an inert topic (no alias, no embedding)
 *
 * ── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────
 * B7.8-C shipped a complete embedding/accounting/reporting chain, and the
 * production canary then had to insert its one topic with raw SQL because the
 * product offered no way to create one. This is the smallest surface that makes
 * the chain usable.
 *
 * ── AUTHORIZATION ──────────────────────────────────────────────────────────
 * INTELLIGENCE_OVERRIDE_MANAGE — the same platform-tier capability already
 * gating the B7.5 curation writer and the B7.6 review surface. No new
 * capability, role, or grant is introduced, and no company-scoped
 * authorization: platform_topic_node is tenant-less, so a company parameter
 * would invent an attribution that does not exist.
 *
 * ── DELEGATOR ONLY ─────────────────────────────────────────────────────────
 * Transport, validation of shape, and status mapping live here. Normalization,
 * uniqueness, race handling and every precondition live in the service. This
 * route holds no database client and names no table, so it cannot write
 * platform_topic_node except through the certified writer.
 *
 * Creating a topic performs NO provider call, writes NO platform_usage_events
 * row, touches NO customer billing, creates NO canonical relationship, and
 * synthesises NO angle_label (B7.3 owns extraction).
 */

/** Service failure → HTTP. `already_exists` is 409: an operator who believes
 *  they are creating something new must not be told they succeeded. */
const STATUS: Record<string, number> = {
  missing_label: 400,
  label_too_long: 400,
  already_exists: 409,
  topic_not_found: 404,
  topic_is_alias: 409,
  topic_is_embedded: 409,
  write_failed: 500,
  exception: 500,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method;
  if (method !== 'POST' && method !== 'PATCH') {
    res.setHeader('Allow', 'POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authorization BEFORE any mutation or lookup.
  const guard = await requireCapability(req, res, {
    capability: INTELLIGENCE_OVERRIDE_MANAGE,
    reason: `knowledge-graph operator topic authoring (${method})`,
  });
  if (guard.ok !== true) return; // denied; requireCapability responded + audited

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  // Only `label` (and `topicId` on PATCH) are read. Any embedding, canonical
  // mapping, hierarchy, provider, model, company, campaign or content field in
  // the body is ignored entirely — it has nowhere to go.
  const out = method === 'POST'
    ? await createOperatorTopic(body.label)
    : await renameOperatorTopic(body.topicId, body.label);

  if ('reason' in out) {
    // `'reason' in out` — NOT `!out.ok`. The repo compiles with `strict: false`,
    // under which boolean-literal discriminated unions do not narrow.
    return res.status(STATUS[out.reason] ?? 500).json({
      error: out.reason,
      code: out.reason.toUpperCase(),
      ...(out.detail ? { detail: out.detail } : {}),
      ...(out.topicId ? { topicId: out.topicId } : {}),
    });
  }

  return res.status(out.action === 'created' ? 201 : 200).json(out);
}

export default __createApiRoute(handler, { route: '/api/admin/knowledge-graph/topic' });
