import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '@/shared/contracts/security';
import {
  confirmCanonicalTopic,
  reverseCanonicalTopic,
} from '@/backend/services/content/knowledgeGraph/topicCurationService';

/**
 * B7.5 — canonical topic curation (platform operator surface).
 *
 *   POST   { topicId, canonicalTopicId }  → confirm topicId is an alias of canonicalTopicId
 *   DELETE { topicId }                    → reverse it (canonical_topic_id = NULL)
 *
 * AUTHORIZATION — `INTELLIGENCE_OVERRIDE_MANAGE`, the existing platform-tier
 * capability already gating operator overrides of derived intelligence under
 * /api/admin (config/[type], experiment/toggle, intelligence/scheduler-boost).
 * No new role model is introduced. `requireCapability` resolves the principal,
 * audits the attempt via logSecurityEvent, and writes the denial response
 * itself — which is also this route's auditability story (see the report).
 *
 * PLATFORM SCOPE — platform_topic_node is tenant-less, so this route takes no
 * companyId and touches no company-scoped table. A company-scoped caller
 * cannot reach tenant data through it because there is none behind it.
 *
 * The route only validates transport and maps typed service failures to status
 * codes; every identity rule (self-reference, cycle, alias-of-alias,
 * idempotency) lives in the service so it is testable without HTTP.
 */

const FAILURE_STATUS: Record<string, number> = {
  missing_topic_id: 400,
  missing_canonical_topic_id: 400,
  self_reference: 400,
  canonical_is_alias: 400,
  would_create_cycle: 409,
  chain_too_deep: 409,
  source_not_found: 404,
  canonical_not_found: 404,
  write_failed: 500,
  exception: 500,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: INTELLIGENCE_OVERRIDE_MANAGE,
    reason: `knowledge-graph canonical topic curation (${req.method})`,
  });
  if (guard.ok !== true) return; // denied; requireCapability already responded + audited

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const topicId = String(body.topicId ?? '').trim();

  const result = req.method === 'POST'
    ? await confirmCanonicalTopic(topicId, String(body.canonicalTopicId ?? '').trim())
    : await reverseCanonicalTopic(topicId);

  // `'reason' in result` rather than `!result.ok`: this repo compiles with
  // `strict: false`, under which discriminated-union narrowing on a boolean
  // literal does not apply. The `in` operator narrows regardless.
  if ('reason' in result) {
    return res.status(FAILURE_STATUS[result.reason] ?? 500).json({
      error: result.reason,
      code: result.reason.toUpperCase(),
      ...(result.detail ? { detail: result.detail } : {}),
    });
  }

  return res.status(200).json(result);
}

export default __createApiRoute(handler, { route: '/api/admin/knowledge-graph/canonical-topic' });
