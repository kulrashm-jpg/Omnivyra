import type { NextApiHandler } from 'next';
import { createApiRoute } from '../platform/routeFactory';

export function withContract(handler: NextApiHandler): NextApiHandler {
  // F-01 (Foundation Batch A): withContract now delegates to the canonical
  // route factory. Observable behavior is unchanged — the factory applies the
  // same withApiObservability wrapper this file applied directly (HARDEN-001),
  // and additionally seeds the F-03 request execution context (ALS only; no
  // header, status, or body change). The three existing withContract routes
  // are Batch A's validation surface.
  return createApiRoute(handler);
}
