/**
 * POST /api/market-pulse/findings/[id]/action
 *
 * Phase 1B: per-finding lifecycle actions for the new feed UX.
 *   - resolve   → user_action_state='resolved', resolved_at=now()
 *   - reopen    → user_action_state='open',    resolved_at=null
 *   - snooze    → user_action_state='snoozed', snoozed_until=<payload.until>
 *   - escalate  → user_action_state='escalated', escalation_tracking=true
 *   - promote   → user_action_state='promoted' (Phase 2 will wire to campaign builder)
 *   - share     → no state change; logs the share intent (URL is built client-side)
 *   - feedback  → no state change; persists feedback payload for learning loops
 *
 * Every action is appended to `market_pulse_finding_actions` so the
 * lifecycle is auditable. The current state on `market_pulse_findings`
 * always reflects the latest applied action.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { ownedDbTable } from '../../../../../backend/db/writeOwner';
import { recordActionAsFeedback } from '../../../../../backend/services/marketPulse/learningFeedbackService';

type ActionType = 'resolve' | 'reopen' | 'snooze' | 'unsnooze' | 'escalate' | 'promote' | 'share' | 'feedback';

const ALLOWED_ACTIONS = new Set<ActionType>([
  'resolve', 'reopen', 'snooze', 'unsnooze', 'escalate', 'promote', 'share', 'feedback',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const findingId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!findingId) {
    return res.status(400).json({ error: 'finding id is required' });
  }

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;

  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  if (!ALLOWED_ACTIONS.has(action as ActionType)) {
    return res.status(400).json({ error: `unsupported action: ${action}` });
  }

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  // Verify finding belongs to this company before mutating — otherwise an
  // attacker with a leaked id from another tenant could close it.
  const { data: finding, error: lookupError } = await ownedDbTable('market_pulse_findings')
    .select('id, run_id, company_id, user_action_state')
    .eq('id', findingId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (lookupError || !finding) {
    return res.status(404).json({ error: 'finding not found' });
  }

  const updates: Record<string, unknown> = {};
  switch (action as ActionType) {
    case 'resolve':
      updates.user_action_state = 'resolved';
      updates.resolved_at = new Date().toISOString();
      updates.snoozed_until = null;
      break;
    case 'reopen':
      updates.user_action_state = 'open';
      updates.resolved_at = null;
      updates.snoozed_until = null;
      break;
    case 'snooze': {
      const untilRaw = typeof payload.until === 'string' ? payload.until : null;
      const days = typeof payload.days === 'number' ? payload.days : null;
      const until = untilRaw
        ? new Date(untilRaw)
        : new Date(Date.now() + (days ? days : 7) * 24 * 60 * 60 * 1000);
      if (!Number.isFinite(until.getTime())) {
        return res.status(400).json({ error: 'invalid snooze "until" or "days"' });
      }
      updates.user_action_state = 'snoozed';
      updates.snoozed_until = until.toISOString();
      break;
    }
    case 'unsnooze':
      updates.user_action_state = 'open';
      updates.snoozed_until = null;
      break;
    case 'escalate':
      updates.user_action_state = 'escalated';
      updates.escalation_tracking = true;
      break;
    case 'promote':
      // Phase 1B persists the intent; Phase 2 will hand off to campaign
      // creation. The frontend already navigates to the campaign builder
      // separately so the intent + state change here is the audit anchor.
      updates.user_action_state = 'promoted';
      break;
    case 'share':
    case 'feedback':
      // No state mutation — append to the audit log only.
      break;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await ownedDbTable('market_pulse_findings')
      .update(updates)
      .eq('id', findingId)
      .eq('company_id', companyId);
    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
  }

  // Append to audit log (best-effort — finding state is the source of truth).
  try {
    await ownedDbTable('market_pulse_finding_actions').insert({
      finding_id: findingId,
      company_id: companyId,
      run_id: finding.run_id ?? null,
      action_type: action,
      payload: Object.keys(payload).length > 0 ? payload : null,
      performed_by: typeof body.performed_by === 'string' ? body.performed_by : null,
    });
  } catch {
    // Audit failure is non-blocking.
  }

  // ── Phase 2: pipe action into the recommendation lifecycle + feedback table ─
  // Non-blocking — if the recommendation row doesn't exist yet (the finding
  // was never explicitly "shown"), the helper just no-ops gracefully.
  recordActionAsFeedback({
    finding_id: findingId,
    company_id: companyId,
    action: action as Parameters<typeof recordActionAsFeedback>[0]['action'],
    user_id: typeof body.user_id === 'string' ? body.user_id : null,
  }).catch(() => {/* non-blocking */});

  return res.status(200).json({ ok: true, finding_id: findingId, action, applied: updates });
}
