import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '@/shared/contracts/security';
import { requestTopicEmbedding } from '@/backend/services/content/knowledgeGraph/topicEmbeddingTrigger';

/**
 * B7.8-C.4 — request embedding generation for one platform topic.
 *
 *   POST { topicId }  →  202 accepted | 200 already_embedded | 202 in_flight
 *                        503 disabled | 404 not_found | 400 bad input
 *
 * ── ROUTE SHAPE (documented deviation) ─────────────────────────────────────
 * The brief's preferred shape was POST /topics/[topicId]/embedding. Both
 * existing knowledge-graph admin routes — canonical-topic.ts (B7.5) and
 * topics.ts (B7.6) — are FLAT and take identifiers in the body, so this follows
 * that convention instead. A nested topics/[topicId]/ directory would also sit
 * confusingly beside the existing topics.ts collection route.
 *
 * ── THIS ROUTE IS A DELEGATOR, NOTHING MORE ────────────────────────────────
 * It performs authorization and input validation, then calls exactly one
 * function. It has no OpenAI import, no ledger import, and no database client:
 * provider access, cost accounting, embedding persistence, candidate warming,
 * idempotency, the in-flight guard and the feature flag all live in the
 * already-certified B7.8-C.3 trigger and are NOT re-implemented here.
 *
 * ── TENANT-LESS BY CONSTRUCTION ────────────────────────────────────────────
 * platform_topic_node has no owning company, so this route accepts no
 * companyId/organizationId and adds no company-scoped authorization — doing so
 * would invent the tenant attribution this whole design exists to avoid.
 * INTELLIGENCE_OVERRIDE_MANAGE is the same platform-tier capability B7.5 and
 * B7.6 already use; no new capability, role or permission is introduced.
 */

/**
 * Trigger state → HTTP.
 *
 * `accepted` and `in_flight` are BOTH 202: work was accepted for asynchronous
 * processing. Neither claims an embedding exists yet — only `already_embedded`
 * (200) asserts a completed state.
 */
const STATUS: Record<string, number> = {
  accepted: 202,
  in_flight: 202,
  already_embedded: 200,
  disabled: 503,
  not_found: 404,
  missing_topic_id: 400,
  error: 500,
};

/** Mirrors the UUID shape used across the knowledge-graph surface. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authorization BEFORE any topic lookup, provider call or ledger write.
  const guard = await requireCapability(req, res, {
    capability: INTELLIGENCE_OVERRIDE_MANAGE,
    reason: 'knowledge-graph platform topic embedding (POST)',
  });
  if (guard.ok !== true) return; // denied; requireCapability responded + audited

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const topicId = String(body.topicId ?? '').trim();

  if (!topicId) {
    return res.status(400).json({ error: 'topicId is required', code: 'MISSING_TOPIC_ID' });
  }
  if (!UUID_RE.test(topicId)) {
    // Rejected here so a malformed id never reaches the trigger's DB query.
    return res.status(400).json({ error: 'topicId must be a uuid', code: 'MALFORMED_TOPIC_ID' });
  }

  // The ONLY argument passed on. Any other body field — provider, model, text,
  // companyId, cost — is ignored entirely: it has nowhere to go, because the
  // provider input is read from the stored canonical label inside B7.8-C.2.
  const out = await requestTopicEmbedding(topicId);

  return res.status(STATUS[out.status] ?? 500).json({
    ...out,
    // Make the asynchronous contract explicit so a 202 is never read as "done".
    ...(out.status === 'accepted' || out.status === 'in_flight'
      ? { note: 'accepted for asynchronous processing; poll candidates for completion' }
      : {}),
  });
}

export default __createApiRoute(handler, { route: '/api/admin/knowledge-graph/embed-topic' });
