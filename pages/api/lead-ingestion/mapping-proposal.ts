import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { isLeadIngestionEnabled, resolveLeadIngestionGate } from '../../../backend/services/leadIngestion/orchestrator';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { fingerprintSchema, proposeFieldMappings } from '../../../backend/services/leadMapping/mappingEngine';
import { allowedTargets } from '../../../backend/services/leadMapping/canonicalFieldRegistry';
import { createGatewayMappingProposer } from '../../../backend/services/leadMapping/gatewayProposer';
import { loadProfileContext, type MappingProfileContext } from '../../../backend/services/leadMapping/mappingProfileStore';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import {
  isSubmittableTarget,
  nonSubmittableReason,
} from '../../../lib/prospects/import/submittableTargets';

/**
 * PI-LDB — the AI semantic mapping PROPOSAL endpoint.
 *
 *   POST /api/lead-ingestion/mapping-proposal?company_id=<uuid>
 *   body: { source, headers[], samples{}, fieldDescriptions? }
 *   →  { proposals[], requiresReview, profile, degraded, allowedTargets[], aiAssisted }
 *
 * ─── SERVER PROPOSES, CLIENT APPLIES ──────────────────────────────────────
 * This route owns mapping SEMANTICS and the canonical destination allowlist;
 * the browser owns the file. The response carries `allowedTargets` so the
 * review UI never holds its own copy of the vocabulary and structurally cannot
 * offer a destination this server would refuse. A field destination is never
 * accepted FROM the browser here — this endpoint is read-only and writes
 * nothing at all.
 *
 * ─── NO FILE AND NO ROWS REACH THIS ROUTE ─────────────────────────────────
 * Only headings and a handful of representative values per column. The rows
 * stay in the tab. That is what makes "correct a mapping" a recomputation
 * rather than a second upload, and it is also what keeps the blast radius of
 * this endpoint to a column heading.
 *
 * ─── REDACTION IS THE ENGINE'S, DELIBERATELY ──────────────────────────────
 * Samples are forwarded RAW to `proposeFieldMappings`, which calls
 * `redactSamples` and then `assertRedacted` before anything can reach a model
 * (see mappingEngine). Redacting here as well would mean redacting twice with
 * no second authority, and would hide a regression in the engine's own
 * assertion behind this route's good behaviour. What this route does instead is
 * BOUND the exposure: a capped number of headers, a capped number of samples
 * per column, and a capped length per sample.
 *
 * ─── THE TENANT IS NEVER TAKEN FROM THE BODY ──────────────────────────────
 * Same rule and same refusal as the CSV route: `company_id` comes from the
 * query string and is membership-verified; a body naming a tenant is REFUSED
 * rather than ignored.
 *
 * ─── WHY THIS ONE RATE-LIMITS WHEN THE CSV ROUTE DOES NOT ─────────────────
 * It can reach a billed model through the gateway. The CSV route's only cost
 * ceiling is MAX_BATCH_SIZE; this route's is a spend, so it needs its own.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body keys that would attempt to make the request body the tenant authority. */
const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A spreadsheet wider than this is a pivot table, not a prospect list. */
const MAX_HEADERS = 200;
/** The engine itself caps at 5; accepting more would only widen exposure. */
const MAX_SAMPLES_PER_COLUMN = 5;
/** A "sample" longer than this is a free-text cell, useless for type evidence. */
const MAX_SAMPLE_CHARS = 200;
/** Headings are identifiers, not prose. */
const MAX_HEADER_CHARS = 300;

/**
 * Only these channels may ask for a mapping. The source scopes the stored
 * profile, so free text here would silently fragment a tenant's profiles into
 * one per spelling.
 */
const ALLOWED_SOURCES = new Set(['csv']);

/**
 * Per-tenant ceiling. A mapping proposal is an interactive action — a tenant
 * reviewing one file re-proposes a handful of times — so 30 in five minutes
 * leaves correction loops unaffected while bounding a scripted caller's spend.
 *
 * Note the fail-open property of `checkRateLimit`: when Redis is unavailable it
 * returns `allowed: true, bypassed: true`. That is the repository's existing
 * behaviour and is correct here — a Redis outage must not make importing
 * impossible — but it does mean this is a spend ceiling, not a security
 * control. The security controls are the capability and the two gates above.
 */
const MAPPING_PROPOSAL_LIMIT = {
  keyPrefix: 'rl:lead-mapping-proposal',
  limit: 30,
  windowSecs: 300,
} as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Feature gate FIRST, exactly as the CSV route orders it: free, and it tells
  // an unauthorised caller nothing about tenancy.
  if (!isLeadIngestionEnabled()) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
    });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'propose a semantic attribute mapping for a spreadsheet import',
  });
  if (guard.ok !== true) return;

  // Tenant gate AFTER authorization — only a verified admin of THIS tenant
  // learns its state.
  const gate = await resolveLeadIngestionGate(companyId);
  if (!gate.allowed) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
      reason: gate.reason,
    });
  }

  // Rate limit keyed on the TENANT, after authorization: an unauthenticated
  // caller must not be able to consume a tenant's budget, and the limit is
  // about protecting that tenant's spend.
  const limited = await checkRateLimit(companyId, MAPPING_PROPOSAL_LIMIT);
  if (!limited.allowed) {
    const retryAfter = Math.max(1, limited.resetAt - Math.ceil(Date.now() / 1_000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many mapping requests for this company. Please wait and try again.',
      code: 'MAPPING_RATE_LIMITED',
    });
  }

  const body = isRecord(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ error: 'a JSON object body is required' });

  for (const key of TENANT_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json({
        error: `'${key}' is not accepted in the body — the tenant comes from the authenticated company_id`,
      });
    }
  }

  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!ALLOWED_SOURCES.has(source)) {
    return res.status(400).json({
      error: `source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
    });
  }

  if (!Array.isArray(body.headers)) {
    return res.status(400).json({ error: 'headers must be an array' });
  }
  if (body.headers.length === 0) {
    return res.status(400).json({ error: 'headers must not be empty' });
  }
  if (body.headers.length > MAX_HEADERS) {
    return res.status(413).json({ error: `headers exceeds the ${MAX_HEADERS} column limit` });
  }
  if (!body.headers.every((h) => typeof h === 'string' && h.trim() !== '')) {
    return res.status(400).json({ error: 'every header must be a non-empty string' });
  }

  const headers = (body.headers as string[]).map((h) => h.slice(0, MAX_HEADER_CHARS));

  // A duplicate heading cannot be mapped — the profile is keyed on the
  // normalised heading and two identical ones are indistinguishable. The parser
  // already treats this as blocking; refusing here too means a client that
  // skipped that check cannot produce an unusable profile.
  if (new Set(headers.map((h) => h.trim().toLowerCase())).size !== headers.length) {
    return res.status(400).json({
      error: 'headers contains duplicates — a duplicate heading cannot be mapped',
      code: 'DUPLICATE_HEADERS',
    });
  }

  if (body.samples !== undefined && !isRecord(body.samples)) {
    return res.status(400).json({ error: 'samples must be an object keyed by header' });
  }

  // Bound the exposure: known headers only, capped count, capped length.
  const knownHeaders = new Set(headers);
  const samples: Record<string, string[]> = {};
  for (const [header, values] of Object.entries((body.samples ?? {}) as Record<string, unknown>)) {
    if (!knownHeaders.has(header) || !Array.isArray(values)) continue;
    samples[header] = values
      .filter((v): v is string => typeof v === 'string')
      .slice(0, MAX_SAMPLES_PER_COLUMN)
      .map((v) => v.slice(0, MAX_SAMPLE_CHARS));
  }

  const fieldDescriptions: Record<string, string> = {};
  if (isRecord(body.fieldDescriptions)) {
    for (const [header, text] of Object.entries(body.fieldDescriptions)) {
      if (knownHeaders.has(header) && typeof text === 'string') {
        fieldDescriptions[header] = text.slice(0, MAX_SAMPLE_CHARS);
      }
    }
  }

  const schemaFingerprint = fingerprintSchema(headers);

  // ── STORED PROFILE (PI-LDB D, 2026-11-11) ─────────────────────────────
  // Approvals are now stored (mapping-approval -> mappingProfileStore, the
  // single writer), so the READ is enabled with them, as planned. The profile
  // and the tenant's past refusals come from ONE pair of reads, so they cannot
  // straddle two versions. The lookup is keyed by the exact schema
  // fingerprint: a file whose header set changed finds no profile and gets a
  // fresh proposal that needs approval, so drift is never auto-applied.
  //
  // A READ FAILURE IS NOT "NO SAVED MAPPING". The proposal still runs (the
  // import is not blocked by a reuse feature), but the response says
  // `profileRead: 'unavailable'` so the UI never tells a tenant they have no
  // saved mapping when it simply could not look.
  let context: MappingProfileContext = { profile: null, rejectedTargets: {}, rejectionSource: null };
  let profileRead: 'loaded' | 'none' | 'unavailable' = 'none';
  try {
    context = await loadProfileContext({ organizationId: companyId, source, schemaFingerprint }, headers);
    profileRead = context.profile ? 'loaded' : 'none';
  } catch {
    profileRead = 'unavailable';
  }
  const storedProfile = context.profile;

  const proposer = createGatewayMappingProposer({
    tenantId: companyId,
    actorUserId: guard.principal.userId,
    sourceType: source,
    schemaFingerprint,
  });

  try {
    const result = await proposeFieldMappings(
      {
        sourceType: source,
        tenantId: companyId,
        headers,
        samples,
        fieldDescriptions: Object.keys(fieldDescriptions).length ? fieldDescriptions : undefined,
        storedProfile,
        rejectedTargets: context.rejectedTargets,
      },
      proposer,
    );

    // ── AI ASSISTANCE IS REPORTED, NEVER ASSUMED ──────────────────────────
    // The gateway is dark until the action-pricing row exists; the engine
    // catches that and records ONE degraded entry for the whole call
    // (`sourceField: '*'`), then completes deterministically. So the only
    // honest way to answer "was this AI-assisted" is to look. Telling a tenant
    // their mapping was AI-assisted when the model was never reached is the
    // precise failure this field exists to prevent.
    const proposerFailed = result.degraded.some(
      (d) => d.sourceField === '*' || d.cause.startsWith('proposer_unavailable'),
    );
    const aiAssisted =
      !proposerFailed && result.proposals.some((p) => p.model !== null);

    return res.status(200).json({
      version: 'pi-ldb.mapping.1',
      sourceSchemaFingerprint: result.sourceSchemaFingerprint,
      proposals: result.proposals,
      requiresReview: result.requiresReview,
      profile: result.profile,
      profileRead,
      // Whose refusals were applied (step E): a platform source means a Super
      // Admin's vendor rule, not the tenant's own.
      rejectionSource: context.rejectionSource,
      degraded: result.degraded,
      allowedTargets: allowedTargets().map((t) => {
        const submittable = isSubmittableTarget(t.key);
        const blockedReason = submittable ? null : nonSubmittableReason(t.key);
        return {
          ...t,
          submittable,
          ...(blockedReason ? { blockedReason } : {}),
        };
      }),
      aiAssisted,
    });
  } catch (error) {
    // `proposeFieldMappings` degrades rather than throwing for a model
    // failure, so reaching here means the ENGINE itself could not run — a
    // malformed schema or a registry problem. Reported as a client error with
    // nothing altered, because this endpoint writes nothing.
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'mapping proposal failed',
      code: 'MAPPING_PROPOSAL_FAILED',
    });
  }
}

export default __createApiRoute(handler, { route: '/api/lead-ingestion/mapping-proposal' });
