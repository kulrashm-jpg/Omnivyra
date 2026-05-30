/**
 * POST /api/creator-intelligence/restricted-strategy-audit
 *
 * Creator Compliance-Aware Strategy Governance — Phase 6.
 *
 * Records an audit event when a picker operator selects a restricted
 * strategy OR reveals the restricted list. Selection is ALLOWED; the
 * audit trail is the compliance record.
 *
 * Read-only from a billing / generation perspective. The endpoint
 * does not return anything except an acknowledgement. The actual
 * write goes through the existing `recordAuditEvent` infrastructure.
 *
 * Body:
 *   {
 *     event: 'selected' | 'revealed',
 *     company_id: string,
 *     industry: 'healthcare' | 'finance' | 'insurance' | 'legal' | 'none',
 *     risk_level: 'none' | 'low' | 'medium' | 'high',
 *     content_type: 'image' | 'carousel' | 'infographic',
 *     strategy_id?: string,           // required when event === 'selected'
 *     restriction_reason?: string,    // required when event === 'selected'
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  auditRestrictedStrategySelected,
  auditRestrictedStrategiesRevealed,
} from '../../../backend/services/creator/strategyGovernanceAuditEvents';
import type {
  GovernedIndustry,
  GovernanceRiskLevel,
} from '../../../backend/services/creator/strategyGovernancePolicyRegistry';

const KNOWN_INDUSTRIES: ReadonlyArray<GovernedIndustry> = ['healthcare', 'finance', 'insurance', 'legal', 'none'];
const KNOWN_RISK: ReadonlyArray<GovernanceRiskLevel> = ['none', 'low', 'medium', 'high'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String(body.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const user = await resolveUserContext(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const event = String(body.event || '').trim();
  if (event !== 'selected' && event !== 'revealed') {
    return res.status(400).json({ success: false, error: 'invalid event', code: 'INVALID_EVENT' });
  }
  const industry = String(body.industry || 'none') as GovernedIndustry;
  if (!(KNOWN_INDUSTRIES as ReadonlyArray<string>).includes(industry)) {
    return res.status(400).json({ success: false, error: 'invalid industry', code: 'INVALID_INDUSTRY' });
  }
  const riskLevel = String(body.risk_level || 'none') as GovernanceRiskLevel;
  if (!(KNOWN_RISK as ReadonlyArray<string>).includes(riskLevel)) {
    return res.status(400).json({ success: false, error: 'invalid risk_level', code: 'INVALID_RISK_LEVEL' });
  }
  const contentType = String(body.content_type || '').trim();
  if (contentType !== 'image' && contentType !== 'carousel' && contentType !== 'infographic') {
    return res.status(400).json({ success: false, error: 'invalid content_type', code: 'INVALID_CONTENT_TYPE' });
  }

  try {
    if (event === 'selected') {
      const strategyId = String(body.strategy_id || '').trim();
      const restrictionReason = String(body.restriction_reason || '').trim();
      if (!strategyId) {
        return res.status(400).json({ success: false, error: 'strategy_id required', code: 'STRATEGY_ID_REQUIRED' });
      }
      if (!restrictionReason) {
        return res.status(400).json({ success: false, error: 'restriction_reason required', code: 'RESTRICTION_REASON_REQUIRED' });
      }
      auditRestrictedStrategySelected({
        companyId,
        industry,
        riskLevel,
        strategyId,
        contentType,
        restrictionReason,
        actorUserId: user.userId ?? null,
      });
    } else {
      auditRestrictedStrategiesRevealed({
        companyId,
        industry,
        riskLevel,
        contentType,
        actorUserId: user.userId ?? null,
      });
    }
    return res.status(200).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Audit write failed',
      code: 'AUDIT_WRITE_FAILED',
      message: err?.message || String(err),
    });
  }
}
