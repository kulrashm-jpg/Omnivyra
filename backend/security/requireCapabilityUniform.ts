/**
 * requireCapability for a resource LOOKED UP BY ID (e9, 2026-11-12) - the capability counterpart of
 * enforceCompanyAccessUniform (backend/services/userContextService.ts).
 *
 * A route that loads a row by id and then authorizes on the row's OWN company used to answer
 * "unknown id" with 404 but "another tenant's id" with requireCapability's 403: an existence
 * oracle. Here a capability DENIAL (403) is answered with the same byte-identical 404 a missing
 * resource gets (UNIFORM_NOT_FOUND). Every other outcome passes through unchanged:
 *   - 401 NOT_AUTHENTICATED / STEP_UP_REQUIRED (a step-up challenge must stay visible),
 *   - any other status requireCapability may add later.
 * The DECISION is requireCapability's, with all of its principals, step-up and audit logging; only
 * the denial's wording changes. Callers answer a missing row with UNIFORM_NOT_FOUND themselves, so
 * missing and foreign are indistinguishable.
 *
 * The capturing probe is the SAME one enforceCompanyAccessUniform uses (createAccessProbe): it
 * states which response members the check may touch and fails with a NAMED error otherwise.
 * Shared on purpose: routes reuse this; nobody re-implements it inline.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability, type RequireCapabilityOptions, type RequireCapabilityResult } from './requireCapability';
import { createAccessProbe, UNIFORM_NOT_FOUND } from '../services/userContextService';

export async function requireCapabilityUniform(
  req: NextApiRequest,
  res: NextApiResponse,
  options: RequireCapabilityOptions,
): Promise<RequireCapabilityResult> {
  const probe = createAccessProbe();
  const result = await requireCapability(req, probe.res, options);
  if (result.ok === true) return result;
  const status = probe.captured.status ?? 403;
  if (status === 403 || status === 404) {
    res.status(404).json(UNIFORM_NOT_FOUND);
    return { ok: false, sent: true };
  }
  // Pass-through (401 / anything else): replay what the check said, headers included.
  for (const [name, value] of Object.entries(probe.captured.headers)) res.setHeader(name, value as string);
  res.status(status).json(probe.captured.body ?? { error: 'Access check failed' });
  return { ok: false, sent: true };
}
