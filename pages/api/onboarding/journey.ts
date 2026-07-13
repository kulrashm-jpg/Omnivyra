/**
 * /api/onboarding/journey — the canonical onboarding journey (ONBOARD-001 §5/§12).
 *
 * GET  → the full derived journey (stages, statuses, current step, platformReady).
 *        Works at ANY point in the flow, including before email verification,
 *        so the client always resumes from the server-derived truth rather than
 *        frontend routing. Deterministic, retry/refresh/replay safe.
 *
 * POST → apply a stage action { stage, action: 'skip'|'dismiss'|'complete'|'reopen' }.
 *        Requires a verified session + a company. Idempotent. Returns the
 *        refreshed journey so the client re-renders from one round-trip.
 *
 * Auth: Bearer / Supabase cookie via the canonical resolver.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import {
  buildOnboardingJourney,
  applyJourneyStageAction,
  emitPlatformReadyOnce,
  type OnboardingJourney,
  type JourneyStageAction,
} from '../../../backend/services/onboardingJourneyService';

type ErrorResponse = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OnboardingJourney | ErrorResponse>,
) {
  seedRequestContextFromRequest(req);

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    const status = authResult.error === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: authResult.error ?? 'Invalid session', code: authResult.error ?? undefined });
  }
  const user = authResult.user;
  seedRequestContextFromRequest(req, { userId: user.id });

  if (req.method === 'GET') {
    const journey = await buildOnboardingJourney(user.id);
    return res.status(200).json(journey);
  }

  if (req.method === 'POST') {
    // Verification gate (AUTH-001 §1) — stage actions mutate company state.
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const stage = String(body.stage ?? '');
    const action = String(body.action ?? '') as JourneyStageAction;
    if (!['complete', 'skip', 'dismiss', 'reopen'].includes(action)) {
      return res.status(400).json({ error: 'action must be one of: complete, skip, dismiss, reopen' });
    }

    // The company the action applies to is derived server-side (never trusted
    // from the client) — the journey's companyId.
    const journey = await buildOnboardingJourney(user.id);
    if (!journey.companyId) {
      return res.status(409).json({ error: 'Create your company before adjusting onboarding steps.', code: 'NO_COMPANY' });
    }

    const result = await applyJourneyStageAction({
      companyId: journey.companyId,
      userId: user.id,
      stage,
      action,
    });
    if (!result.ok) {
      const status = result.code === 'ACTION_NOT_ALLOWED' ? 409 : result.code === 'UNKNOWN_STAGE' ? 400 : 500;
      return res.status(status).json({ error: result.error ?? 'Action failed', code: result.code });
    }

    // Return the refreshed journey (post-action) in the same round-trip.
    const refreshed = await buildOnboardingJourney(user.id);
    // §5 — emit PlatformReady/JourneyCompleted once if this action tipped the
    // journey to ready (idempotent via the _milestones marker).
    void emitPlatformReadyOnce({ companyId: journey.companyId, userId: user.id, journey: refreshed });
    return res.status(200).json(refreshed);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
