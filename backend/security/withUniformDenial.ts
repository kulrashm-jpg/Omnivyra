/**
 * Run ANY access guard so that its DENIAL is answered with the uniform 404 (e1 S2, 2026-11-12).
 *
 * For a resource looked up by id, "another tenant's id" must be indistinguishable from "unknown id".
 * enforceCompanyAccessUniform and requireCapabilityUniform do this for their own guards; this is the
 * same rule for any other guard (e.g. TenantGuard.requireTenantAccess). The guard writes to the
 * shared capturing probe (createAccessProbe - which fails with a NAMED error if the guard touches a
 * response member it does not model):
 *   - the guard grants   -> its result is returned, nothing is written to `res`;
 *   - 403 / 404 denial   -> `res` gets the byte-identical UNIFORM_NOT_FOUND 404;
 *   - anything else      -> replayed verbatim with its headers (401 unauthenticated / step-up,
 *                           503 lookup failure stay visible).
 */
import type { NextApiResponse } from 'next';
import { createAccessProbe, UNIFORM_NOT_FOUND } from '../services/userContextService';

export async function withUniformDenial<T>(
  res: NextApiResponse,
  guard: (probeRes: NextApiResponse) => Promise<T | null>,
): Promise<T | null> {
  const probe = createAccessProbe();
  const granted = await guard(probe.res);
  if (granted) return granted;
  const status = probe.captured.status ?? 403;
  if (status === 403 || status === 404) {
    res.status(404).json(UNIFORM_NOT_FOUND);
    return null;
  }
  for (const [name, value] of Object.entries(probe.captured.headers)) res.setHeader(name, value as string);
  res.status(status).json(probe.captured.body ?? { error: 'Access check failed' });
  return null;
}
