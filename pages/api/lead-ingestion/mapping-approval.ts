import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { isLeadIngestionEnabled, resolveLeadIngestionGate } from '../../../backend/services/leadIngestion/orchestrator';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { isCanonicalFieldKey } from '../../../backend/services/leadMapping/canonicalFieldRegistry';
import { isSubmittableTarget } from '../../../lib/prospects/import/submittableTargets';

/**
 * PI-LDB — the mapping APPROVAL endpoint.
 *
 *   POST /api/lead-ingestion/mapping-approval?company_id=<uuid>
 *   headers: Idempotency-Key
 *   body: { source, schemaFingerprint, headers[], entries[] }
 *   →  501 MAPPING_PROFILE_STORE_UNAVAILABLE  (until write ownership is settled)
 *
 * ─── WHY THIS EXISTS BEFORE IT CAN SUCCEED ────────────────────────────────
 * The versioned profile store DOES ship in this deliverable —
 * `backend/services/leadMapping/mappingProfileStore.ts`, its migration
 * `20270201000000_pi_ldb_source_mapping_profiles.sql`, a 39-test unit suite and
 * `backend/tests/realschema/ldb1_mapping_profiles.test.ts`. What is NOT settled
 * is which track may WRITE `source_mapping_profiles`: the store declares itself
 * that table's only writer, so calling it from here would make this route a
 * second writer of a table the ingestion track owns. That ownership question is
 * an OWNER DECISION and is unresolved. There were two options: leave the
 * endpoint out, or ship the validation boundary now and fail closed on the
 * unresolved ownership question rather than on a missing store.
 *
 * Shipping it is the safer of the two, and only because it FAILS CLOSED. The
 * value of this file today is that it is the place where a browser-supplied
 * destination is checked against the canonical registry — the check that stops
 * a client naming an arbitrary field. That boundary is worth having under test
 * before anything can write through it. What it must never do is answer 200 to
 * a tenant whose approval was not actually stored: a tenant told "mapping
 * saved" who then finds it was not is worse off than one told plainly that
 * saving is not available yet.
 *
 * So every request that passes validation ends in 501 with a machine-readable
 * code. The import flow is unaffected: approving a mapping for THIS import is
 * client-side state, and reuse across imports is the feature that waits.
 *
 * ─── EVERY DESTINATION IS CHECKED TWICE ───────────────────────────────────
 * `isCanonicalFieldKey` — is this a destination the registry knows at all?
 * `isSubmittableTarget` — can the ingestion contract actually carry it?
 * A browser-invented key fails the first. A real registry key with no field on
 * `CsvLeadInput` fails the second, and is refused rather than stored as an
 * approval that could never be honoured. There is NO such key at present —
 * `description`, which used to be the example here, is now carried end to end —
 * so the second guard currently refuses nothing. It stays because the next
 * registry key added will reach it before anyone teaches the adapter to read it.
 *
 * ─── IDEMPOTENT BECAUSE IT VERSIONS ───────────────────────────────────────
 * Approving a profile inserts a new version and supersedes the previous one. A
 * retried request must not create version 4 and version 5 from one decision,
 * so `withIdempotency` wraps the handler with its own scope. It covers POST by
 * default and does NOT cover GET — which is correct here, since there is no
 * GET on this route.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/;

const ALLOWED_SOURCES = new Set(['csv']);
const MAX_HEADERS = 200;

/** The decisions the profile-entry table accepts. */
const DECISIONS = new Set(['approved', 'rejected', 'ignored']);

/** The mapping methods the profile-entry table accepts. */
const METHODS = new Set([
  'approved_profile_match',
  'high_confidence_suggestion',
  'tenant_confirmed',
  'tenant_override',
]);

/** The closed transformation vocabulary the engine may propose. */
const TRANSFORMATIONS = new Set([
  'none',
  'trim',
  'lowercase_email',
  'digits_only_phone',
  'url_to_domain',
  'split_full_name',
  'parse_integer',
  'parse_date',
  'split_delimited_list',
  'match_enum_value',
]);

interface ValidatedEntry {
  sourceField: string;
  target: string | null;
  transformation: string;
  decision: string;
  mappingMethod: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    reason: 'approve a tenant attribute-mapping profile for spreadsheet imports',
  });
  if (guard.ok !== true) return;

  const gate = await resolveLeadIngestionGate(companyId);
  if (!gate.allowed) {
    return res.status(404).json({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
      reason: gate.reason,
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

  const schemaFingerprint =
    typeof body.schemaFingerprint === 'string' ? body.schemaFingerprint.trim() : '';
  if (!FINGERPRINT.test(schemaFingerprint)) {
    return res.status(400).json({
      error: 'schemaFingerprint must be a 64-character hex digest',
    });
  }

  if (!Array.isArray(body.headers) || body.headers.length === 0) {
    return res.status(400).json({ error: 'headers must be a non-empty array' });
  }
  if (body.headers.length > MAX_HEADERS) {
    return res.status(413).json({ error: `headers exceeds the ${MAX_HEADERS} column limit` });
  }
  if (!body.headers.every((h) => typeof h === 'string' && h.trim() !== '')) {
    return res.status(400).json({ error: 'every header must be a non-empty string' });
  }
  const headers = body.headers as string[];

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array' });
  }
  if (body.entries.length > MAX_HEADERS) {
    return res.status(413).json({ error: `entries exceeds the ${MAX_HEADERS} column limit` });
  }

  const knownHeaders = new Set(headers);
  const seen = new Set<string>();
  const entries: ValidatedEntry[] = [];

  for (const raw of body.entries) {
    if (!isRecord(raw)) {
      return res.status(400).json({ error: 'every entry must be an object' });
    }

    const sourceField = typeof raw.sourceField === 'string' ? raw.sourceField : '';
    if (!knownHeaders.has(sourceField)) {
      return res.status(400).json({
        error: 'every entry.sourceField must be one of the submitted headers',
        code: 'UNKNOWN_SOURCE_FIELD',
      });
    }
    // One decision per column. Two entries for one heading is a client bug, and
    // the table's unique indexes would refuse it anyway — better a clear 400.
    if (seen.has(sourceField)) {
      return res.status(400).json({
        error: `entries contains more than one decision for '${sourceField}'`,
        code: 'DUPLICATE_ENTRY',
      });
    }
    seen.add(sourceField);

    const decision = typeof raw.decision === 'string' ? raw.decision : '';
    if (!DECISIONS.has(decision)) {
      return res.status(400).json({
        error: `entry.decision must be one of: ${[...DECISIONS].join(', ')}`,
      });
    }

    const mappingMethod = typeof raw.mappingMethod === 'string' ? raw.mappingMethod : '';
    if (!METHODS.has(mappingMethod)) {
      return res.status(400).json({
        error: `entry.mappingMethod must be one of: ${[...METHODS].join(', ')}`,
      });
    }

    const transformation = typeof raw.transformation === 'string' ? raw.transformation : 'none';
    if (!TRANSFORMATIONS.has(transformation)) {
      return res.status(400).json({
        error: 'entry.transformation is not a recognised transformation',
        code: 'UNKNOWN_TRANSFORMATION',
      });
    }

    // ── THE BOUNDARY THAT MATTERS ─────────────────────────────────────────
    // `target: null` is a legitimate, first-class decision — it records an
    // approved IGNORE. Anything else must be a destination the registry knows
    // AND the ingestion contract can carry.
    const target = raw.target === null || raw.target === undefined ? null : raw.target;
    if (target !== null) {
      if (typeof target !== 'string' || !isCanonicalFieldKey(target)) {
        return res.status(400).json({
          error: 'entry.target is not a canonical destination',
          code: 'UNKNOWN_TARGET',
        });
      }
      if (!isSubmittableTarget(target)) {
        return res.status(400).json({
          error: `'${target}' is a recognised destination but imports cannot write to it yet`,
          code: 'TARGET_NOT_SUBMITTABLE',
        });
      }
    }

    // An ignore decision must not carry a destination, and an approval must.
    if (decision === 'ignored' && target !== null) {
      return res.status(400).json({
        error: "an 'ignored' decision cannot name a target",
        code: 'INCONSISTENT_DECISION',
      });
    }
    if (decision === 'approved' && target === null) {
      return res.status(400).json({
        error: "an 'approved' decision must name a target — use 'ignored' to skip a column",
        code: 'INCONSISTENT_DECISION',
      });
    }

    entries.push({
      sourceField,
      target: target as string | null,
      transformation,
      decision,
      mappingMethod,
    });
  }

  // ── FAIL CLOSED ─────────────────────────────────────────────────────────
  // Everything above validated. The one thing missing is the store, and there
  // is no safe stand-in for it: writing to `source_mapping_profiles` from this
  // route would duplicate ownership of a table the ingestion track owns, and
  // answering 200 without writing would tell a tenant their approval was
  // saved when it was not.
  //
  // TODO(PI-LDB, ingestion track): replace this refusal with
  //   const saved = await saveProfileVersion({
  //     organizationId: companyId,
  //     source,
  //     schemaFingerprint,
  //     headers,
  //     approvedBy: guard.principal.userId,
  //     entries,
  //   });
  //   return res.status(201).json({ profileId: saved.profileId, version: saved.version });
  // against `backend/services/leadMapping/mappingProfileStore.ts`.
  return res.status(501).json({
    error:
      'Saving a mapping for reuse is not available yet. Your mapping still applies to this import.',
    code: 'MAPPING_PROFILE_STORE_UNAVAILABLE',
    // Echoed so a client can show WHAT would have been saved, and so the
    // contract is observable under test before the store exists.
    validated: { source, schemaFingerprint, entryCount: entries.length },
  });
}

export default __createApiRoute(
  withIdempotency(handler, { scope: 'lead-mapping-approval' }),
  { route: '/api/lead-ingestion/mapping-approval' },
);
