/**
 * /api/creator-intelligence/variant-experiment
 *
 * Variant experiment lifecycle endpoint.
 *
 *   GET    — list experiments in scope
 *            ?company_id&campaign_id?&strategy_id?&state?
 *
 *   POST   — register an experiment OR transition an asset
 *            Body shapes:
 *
 *            Register:
 *            { action: 'register', company_id, campaign_id?, strategy_id,
 *              mode: 'experiment' | 'top_3_variants',
 *              variant_ids: [{ variant_id, variant_family }, ...],
 *              correlation_id? }
 *
 *            Transition:
 *            { action: 'transition', company_id, experiment_id,
 *              variant_id, state: 'created' | 'generated' | 'published'
 *                | 'engaged' | 'completed',
 *              asset_id?, scheduled_post_id? }
 *
 *            Complete:
 *            { action: 'complete', company_id, experiment_id }
 *
 * Phases addressed:
 *   - PHASE 9 — experiment tracking
 *   - PHASE 13 — experiment results surface
 *
 * Does NOT persist to a DB; the tracker is an in-memory bounded
 * LRU (PHASE 17 — no DB migration required).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  completeExperiment,
  getExperiment,
  listExperiments,
  registerExperiment,
  transitionExperimentAsset,
  type ExperimentLifecycleState,
} from '../../../backend/services/creator/variantExperimentTracker';
import { resolveVariant } from '../../../backend/services/creator/variantRegistry';

const VALID_STATES: ReadonlyArray<ExperimentLifecycleState> = [
  'created', 'generated', 'published', 'engaged', 'completed',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const experimentId = req.query.experiment_id ? String(req.query.experiment_id) : null;
  if (experimentId) {
    const exp = getExperiment({ companyId, experimentId });
    if (!exp) return res.status(404).json({ success: false, error: 'experiment not found', code: 'NOT_FOUND' });
    return res.status(200).json({ success: true, experiment: exp });
  }

  const campaignId = req.query.campaign_id ? String(req.query.campaign_id) : null;
  const strategyId = req.query.strategy_id ? String(req.query.strategy_id) : null;
  const stateRaw = req.query.state ? String(req.query.state) : 'all';
  const state =
    stateRaw === 'all'
    || stateRaw === 'active'
    || (VALID_STATES as ReadonlyArray<string>).includes(stateRaw)
      ? stateRaw as ExperimentLifecycleState | 'active' | 'all'
      : 'all';

  const experiments = listExperiments({ companyId, campaignId, strategyId, state });
  return res.status(200).json({
    success: true,
    scope: { companyId, campaignId, strategyId, state },
    experiments,
  });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String(body.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const action = String(body.action || '').trim();
  switch (action) {
    case 'register': {
      const strategyId = String(body.strategy_id || '').trim();
      if (!strategyId) {
        return res.status(400).json({ success: false, error: 'strategy_id required', code: 'STRATEGY_ID_REQUIRED' });
      }
      const variantIdsRaw = Array.isArray(body.variant_ids) ? body.variant_ids : [];
      const variantIds: Array<{ variant_id: string; variant_family: string }> = [];
      for (const raw of variantIdsRaw) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as Record<string, unknown>;
        const variantId = typeof entry.variant_id === 'string' ? entry.variant_id : null;
        if (!variantId) continue;
        const v = resolveVariant(variantId);
        if (!v || v.strategy_id !== strategyId) continue;
        variantIds.push({ variant_id: v.variant_id, variant_family: v.variant_family });
      }
      if (variantIds.length === 0) {
        return res.status(400).json({ success: false, error: 'no valid variants for strategy', code: 'INVALID_VARIANTS' });
      }
      const mode = body.mode === 'experiment' || body.mode === 'top_3_variants'
        ? body.mode
        : 'experiment';
      const exp = registerExperiment({
        companyId,
        campaignId: typeof body.campaign_id === 'string' ? body.campaign_id : null,
        strategyId,
        mode,
        variantIds,
        correlationId: typeof body.correlation_id === 'string' ? body.correlation_id : null,
      });
      return res.status(200).json({ success: true, experiment: exp });
    }
    case 'transition': {
      const experimentId = String(body.experiment_id || '').trim();
      const variantId = String(body.variant_id || '').trim();
      const state = String(body.state || '').trim();
      if (!experimentId || !variantId) {
        return res.status(400).json({ success: false, error: 'experiment_id + variant_id required', code: 'IDS_REQUIRED' });
      }
      if (!(VALID_STATES as ReadonlyArray<string>).includes(state)) {
        return res.status(400).json({ success: false, error: `state must be one of ${VALID_STATES.join(', ')}`, code: 'INVALID_STATE' });
      }
      const updated = transitionExperimentAsset({
        companyId,
        experimentId,
        variantId,
        state: state as ExperimentLifecycleState,
        assetId: typeof body.asset_id === 'string' ? body.asset_id : null,
        scheduledPostId: typeof body.scheduled_post_id === 'string' ? body.scheduled_post_id : null,
      });
      if (!updated) {
        return res.status(404).json({ success: false, error: 'experiment or variant not found', code: 'NOT_FOUND' });
      }
      return res.status(200).json({ success: true, experiment: updated });
    }
    case 'transition_batch': {
      // P2-6 — batched transitions. Body: { transitions: Array<{
      //   experiment_id, variant_id, state, asset_id?, scheduled_post_id?
      // }> }. Applied serially in tracker (which is in-memory) and
      // returns per-transition outcome so the caller knows which ones
      // landed. One HTTP round-trip per fan-out instead of N.
      const rawTransitions = Array.isArray(body.transitions) ? body.transitions : [];
      if (rawTransitions.length === 0) {
        return res.status(400).json({ success: false, error: 'transitions array required', code: 'TRANSITIONS_REQUIRED' });
      }
      const outcomes: Array<{
        experiment_id: string;
        variant_id: string;
        ok: boolean;
        experiment?: unknown;
        error?: string;
      }> = [];
      for (const raw of rawTransitions) {
        if (!raw || typeof raw !== 'object') {
          outcomes.push({ experiment_id: '', variant_id: '', ok: false, error: 'invalid transition entry' });
          continue;
        }
        const entry = raw as Record<string, unknown>;
        const experimentId = String(entry.experiment_id || '').trim();
        const variantId = String(entry.variant_id || '').trim();
        const state = String(entry.state || '').trim();
        if (!experimentId || !variantId || !(VALID_STATES as ReadonlyArray<string>).includes(state)) {
          outcomes.push({ experiment_id: experimentId, variant_id: variantId, ok: false, error: 'invalid experiment_id / variant_id / state' });
          continue;
        }
        const updated = transitionExperimentAsset({
          companyId,
          experimentId,
          variantId,
          state: state as ExperimentLifecycleState,
          assetId: typeof entry.asset_id === 'string' ? entry.asset_id : null,
          scheduledPostId: typeof entry.scheduled_post_id === 'string' ? entry.scheduled_post_id : null,
        });
        if (!updated) {
          outcomes.push({ experiment_id: experimentId, variant_id: variantId, ok: false, error: 'experiment or variant not found' });
          continue;
        }
        outcomes.push({ experiment_id: experimentId, variant_id: variantId, ok: true, experiment: updated });
      }
      const successCount = outcomes.filter((o) => o.ok).length;
      return res.status(200).json({
        success: successCount > 0,
        outcomes,
        successCount,
        failureCount: outcomes.length - successCount,
      });
    }
    case 'complete': {
      const experimentId = String(body.experiment_id || '').trim();
      if (!experimentId) {
        return res.status(400).json({ success: false, error: 'experiment_id required', code: 'EXPERIMENT_ID_REQUIRED' });
      }
      const updated = completeExperiment({ companyId, experimentId });
      if (!updated) {
        return res.status(404).json({ success: false, error: 'experiment not found', code: 'NOT_FOUND' });
      }
      return res.status(200).json({ success: true, experiment: updated });
    }
    default:
      return res.status(400).json({ success: false, error: `unknown action '${action}'`, code: 'INVALID_ACTION' });
  }
}
