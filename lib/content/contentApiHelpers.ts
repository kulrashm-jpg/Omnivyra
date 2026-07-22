/**
 * Wave 1 — canonical content REST endpoints: shared handler helpers.
 *
 * These are thin, transport-only helpers for the `pages/api/content/*`
 * routes. They do NOT make authorization decisions — company-scoping and
 * tenant authorization stay in `enforceCompanyAccess`
 * (backend/services/userContextService). Kept in `lib/` (not `pages/api/`)
 * so Next.js does not treat this file as a route.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Resolve the caller-supplied companyId from either casing, in query or
 * body. The canonical content endpoints accept `companyId` (camelCase, as
 * used by /api/content/list) and `company_id` (snake_case, as used by
 * /api/creator-assets/attachments and /api/block-templates) so existing
 * clients on either convention work unchanged.
 */
export function resolveCompanyId(req: NextApiRequest): string | undefined {
  const candidates = [
    req.query?.companyId,
    req.query?.company_id,
    (req.body as Record<string, unknown> | undefined)?.companyId,
    (req.body as Record<string, unknown> | undefined)?.company_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

/** Read a single-valued string route/query param (Next.js may hand back string[]). */
export function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Map a service-layer error to an HTTP status + JSON envelope. The canonical
 * content service surfaces errors as thrown Error instances; where it attaches
 * a `.status` or `.code`, we honor it, otherwise we infer a status from the
 * message so validation / not-found / authorization failures map to 400 / 404 /
 * 403 respectively and everything else to 500.
 */
export function respondServiceError(
  res: NextApiResponse,
  error: unknown,
  fallbackMessage = 'Request failed',
): void {
  const message = error instanceof Error && error.message ? error.message : String(error || fallbackMessage);
  const bag = (error && typeof error === 'object') ? (error as Record<string, unknown>) : {};
  const explicitStatus = typeof bag.status === 'number' ? bag.status
    : typeof bag.statusCode === 'number' ? bag.statusCode
    : null;
  const code = typeof bag.code === 'string' ? bag.code : '';

  if (explicitStatus && explicitStatus >= 400 && explicitStatus <= 599) {
    res.status(explicitStatus).json({ error: message, ...(code ? { code } : {}) });
    return;
  }

  const lower = message.toLowerCase();
  const upperCode = code.toUpperCase();
  if (lower.includes('not found') || upperCode === 'NOT_FOUND') {
    res.status(404).json({ error: message });
    return;
  }
  if (lower.includes('access denied') || lower.includes('forbidden') || upperCode === 'FORBIDDEN') {
    res.status(403).json({ error: message });
    return;
  }
  if (
    lower.includes('required') ||
    lower.includes('invalid') ||
    lower.includes('unsupported') ||
    lower.includes('must be') ||
    upperCode === 'VALIDATION' ||
    upperCode === 'BAD_REQUEST'
  ) {
    res.status(400).json({ error: message });
    return;
  }
  res.status(500).json({ error: message });
}
