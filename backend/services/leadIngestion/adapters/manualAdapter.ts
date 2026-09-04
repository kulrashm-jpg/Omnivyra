/**
 * LI-4E — the manual entry adapter. The first real adapter on the LI-4D
 * foundation, and deliberately the least capable one possible.
 *
 * A human types a prospect's details into a form. There is no provider, no
 * credential, no network call and no pagination — which is exactly why this is
 * the right first adapter: it exercises the entire chain (translate → identity →
 * employer → provenance → duplicate parking) with nothing that could fail for a
 * reason unrelated to the pipeline itself. If a record does not arrive
 * correctly, the pipeline is wrong, not the provider.
 *
 * ─── IT TRANSLATES. THAT IS ALL. ──────────────────────────────────────────
 * `translate` is synchronous by the LI-4D contract, so this module cannot await
 * a database, a fetch or a credential lookup even if someone tried. It creates
 * no person, no source record and no duplicate candidate; it returns data and
 * the orchestrator does the rest.
 *
 * ─── NORMALISATION IS BORROWED, NEVER REBUILT ─────────────────────────────
 * `normalizeEmail`, `normalizePhone`, `normalizeDisplayText` and
 * `normalizeCountryCode` are the platform's existing rules and are imported, not
 * reimplemented. A second spelling of "what is this address, really" is how two
 * layers come to disagree about whether two people are the same person.
 *
 * The employer DOMAIN is deliberately NOT normalised here: W4's account
 * resolver owns domain normalisation and accepts a bare host, a URL or an email
 * to take the domain from. Pre-chewing it would be the second normalizer this
 * comment exists to prevent.
 */

import { createHash } from 'node:crypto';
import { normalizeEmail, normalizePhone } from '../../identityResolutionService';
import { normalizeCountryCode, normalizeDisplayText } from '../../prospectIdentity/attributes';
import type { AdapterResult, LeadSourceAdapter, NormalizedAccount, NormalizedIngestionRecord } from '../contracts';

export const MANUAL_SOURCE = 'manual';

/** Metadata keys that would carry content rather than a note. */
const FORBIDDEN_METADATA_KEYS = new Set([
  'body', 'html', 'text', 'transcript', 'payload', 'message', 'messages',
  'raw', 'raw_email', 'email_body', 'content', 'attachment', 'attachments',
  'password', 'token', 'secret', 'api_key', 'apikey', 'authorization', 'credential',
]);

/** A note stays small. A backstop against a payload dump, not a tuning knob. */
const MAX_METADATA_BYTES = 2_048;

/** Deliberately permissive: enough to catch a typo, not a spec-compliance judge. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
/** E.164-ish: optional +, then 8–15 digits once separators are stripped. */
const PHONE_DIGITS = /^\+?\d{8,15}$/;

/** What a human may supply. Every field beyond the tenant is optional. */
export interface ManualLeadInput {
  organizationId: string;
  /** The operator's own reference, when they have one. */
  referenceId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyExternalId?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  /** When the operator learned this, if not now. */
  observedAt?: string | null;
  /** Short operator notes only — never a transcript or a payload. */
  metadata?: Record<string, unknown> | null;

  // ── P2D employer firmographics ────────────────────────────────────────────
  // All optional. A record without any of them behaves exactly as before, and
  // none of them can create an employer on its own — the account is still
  // identified by name/domain/externalId, because a revenue figure attached to
  // no identifiable company is a fact about nobody.
  //
  // NAMING: these are the canonical attribute names, unprefixed, so a provider
  // maps into the same vocabulary the rest of the platform uses. The three
  // exceptions carry a `company` prefix — `countryCode`, `region` and `city`
  // already exist above and describe the PERSON. Reusing those names for the
  // employer would silently overwrite one with the other, so the employer's
  // geography follows the prefix convention `companyName`/`companyDomain`
  // already established in this contract.
  industry?: string | null;
  employeeCount?: number | string | null;
  employeeBand?: string | null;
  annualRevenue?: number | string | null;
  revenueBand?: string | null;
  foundedYear?: number | string | null;
  /** Technology names. A JSON array string is accepted too — LI-2 normalises. */
  technologies?: string[] | string | null;
  fundingStage?: string | null;
  lastFundingAt?: string | null;
  /** The EMPLOYER's geography — distinct from the person's above. */
  companyCountryCode?: string | null;
  companyRegion?: string | null;
  companyCity?: string | null;
}

export class ManualInputError extends Error {
  constructor(message: string, readonly field: string) {
    super(message);
    this.name = 'ManualInputError';
  }
}

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

function assertMetadata(metadata: Record<string, unknown>): void {
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      throw new ManualInputError(
        `metadata key '${key}' carries content or a credential — manual notes are summaries`,
        'metadata',
      );
    }
  }
  const size = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (size > MAX_METADATA_BYTES) {
    throw new ManualInputError(
      `metadata is ${size} bytes, over the ${MAX_METADATA_BYTES}-byte limit`,
      'metadata',
    );
  }
}

/**
 * Validate manual input and fail on the FIRST problem, naming the field.
 *
 * Validation is not normalisation: shape is checked here, values are normalised
 * by the platform's existing rules. An operator typing `a@@b` should be told
 * which field is wrong, not have it silently lowercased into the database.
 */
export function validateManualInput(input: ManualLeadInput): void {
  if (!input || typeof input !== 'object') {
    throw new ManualInputError('manual input must be an object', 'input');
  }
  if (!trimmed(input.organizationId)) {
    throw new ManualInputError('organizationId is required — ingestion is never tenant-less', 'organizationId');
  }

  const rawEmail = trimmed(input.email);
  if (rawEmail && !EMAIL_SHAPE.test(rawEmail)) {
    throw new ManualInputError(`'${rawEmail}' is not a usable email address`, 'email');
  }

  const rawPhone = trimmed(input.phone);
  if (rawPhone) {
    const normalized = normalizePhone(rawPhone);
    if (!normalized || !PHONE_DIGITS.test(normalized)) {
      throw new ManualInputError(`'${rawPhone}' is not a usable phone number`, 'phone');
    }
  }

  // A person with no identifier can never be resolved or matched again. The
  // operator's own reference counts: it becomes a provider identifier.
  if (!rawEmail && !rawPhone && !trimmed(input.referenceId)) {
    throw new ManualInputError(
      'a manual person needs an email, a phone or a reference id — otherwise it can never be found again',
      'identity',
    );
  }

  const ref = input.referenceId;
  if (ref !== undefined && ref !== null && !trimmed(ref)) {
    throw new ManualInputError('referenceId was supplied but is blank', 'referenceId');
  }

  if (input.observedAt != null) {
    const at = trimmed(input.observedAt);
    if (!at || Number.isNaN(Date.parse(at))) {
      throw new ManualInputError(`'${String(input.observedAt)}' is not a parseable timestamp`, 'observedAt');
    }
  }

  if (input.metadata != null) {
    if (typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      throw new ManualInputError('metadata must be an object', 'metadata');
    }
    assertMetadata(input.metadata);
  }

  if (input.countryCode != null && trimmed(input.countryCode) && !normalizeCountryCode(input.countryCode)) {
    throw new ManualInputError(`'${String(input.countryCode)}' is not an ISO 3166-1 alpha-2 country code`, 'countryCode');
  }
}

/**
 * The record's stable identity.
 *
 * The operator's reference wins when they gave one, so two deliberate entries
 * stay two records. With no reference, a deterministic hash of the tenant and
 * the identity signals is used — so re-typing the same person is idempotent
 * rather than accumulating duplicates. It is a row identity, not an email: the
 * shape LI-2's contract asks of a file-like source.
 */
export function manualExternalId(input: ManualLeadInput): string {
  const ref = trimmed(input.referenceId);
  if (ref) return ref;
  const email = normalizeEmail(input.email) ?? '';
  const phone = normalizePhone(input.phone) ?? '';
  const digest = createHash('sha256')
    .update(`${input.organizationId}|${email}|${phone}`)
    .digest('hex')
    .slice(0, 32);
  return `manual:${digest}`;
}

/**
 * Translate manual input into the LI-4D normalized record.
 *
 * Exported for direct use by a future entry API; the adapter below wraps it so
 * the orchestrator reaches it through the registry like any other source.
 */
export function toNormalizedManualRecord(input: ManualLeadInput): NormalizedIngestionRecord {
  validateManualInput(input);

  const externalId = manualExternalId(input);
  const email = trimmed(input.email);
  const phone = trimmed(input.phone);

  return {
    organizationId: input.organizationId.trim(),
    source: MANUAL_SOURCE,
    entityType: 'person',
    externalId,
    person: {
      email,
      phone,
      fullName: normalizeDisplayText(input.fullName)
        ?? normalizeDisplayText([trimmed(input.firstName), trimmed(input.lastName)].filter(Boolean).join(' ')),
      firstName: normalizeDisplayText(input.firstName),
      lastName: normalizeDisplayText(input.lastName),
      jobTitle: normalizeDisplayText(input.jobTitle),
      department: normalizeDisplayText(input.department),
      countryCode: normalizeCountryCode(input.countryCode),
      region: normalizeDisplayText(input.region),
      city: normalizeDisplayText(input.city),
      // The operator's reference is a provider identifier for this person, so a
      // later entry carrying the same reference resolves to the same person.
      externalKeys: trimmed(input.referenceId)
        ? { [MANUAL_SOURCE]: { external_id: trimmed(input.referenceId) } }
        : null,
    },
    // The employer, when the operator named one. `domain` is passed through
    // UNNORMALISED on purpose — W4 owns domain normalisation.
    account: (trimmed(input.companyName) || trimmed(input.companyDomain) || trimmed(input.companyExternalId))
      ? {
        externalId: trimmed(input.companyExternalId),
        name: normalizeDisplayText(input.companyName),
        domain: trimmed(input.companyDomain),
        // ── Firmographics, PASSED THROUGH UNNORMALISED ──────────────────────
        // Deliberate. `toAccountAttributes` owns every one of these rules —
        // the numeric coercions, the founded-year bounds, the JSON-array
        // serialisation for jsonb, the UTC instant. Normalising here would be
        // a second spelling of rules LI-2 already applies, and the two would
        // eventually disagree. `NormalizedAccount` accepts the provider forms
        // (`'250'`, a JSON string) for exactly this reason — the same posture
        // `domain` already takes, where W4 owns normalisation.
        industry: input.industry ?? null,
        employeeCount: input.employeeCount ?? null,
        employeeBand: (input.employeeBand ?? null) as NormalizedAccount['employeeBand'],
        countryCode: input.companyCountryCode ?? null,
        region: input.companyRegion ?? null,
        city: input.companyCity ?? null,
        annualRevenue: input.annualRevenue ?? null,
        revenueBand: input.revenueBand ?? null,
        foundedYear: input.foundedYear ?? null,
        technologies: input.technologies ?? null,
        fundingStage: input.fundingStage ?? null,
        lastFundingAt: input.lastFundingAt ?? null,
      }
      : null,
    observedAt: trimmed(input.observedAt),
  };
}

/**
 * The adapter. Registered through the LI-4D registry so the orchestrator can
 * discover and invoke it without knowing it exists.
 *
 * CAPABILITIES, stated honestly: manual entry introduces people and employers
 * the platform did not have, so it discovers both. It fetches nothing, searches
 * nothing and enriches nothing, so it claims none of those.
 */
export const manualAdapter: LeadSourceAdapter = {
  source: MANUAL_SOURCE,
  label: 'Manual entry',
  capabilities: ['person_discovery', 'account_discovery'],

  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    // The batch's tenant is authoritative; a record naming another is refused by
    // the orchestrator, and is not silently rewritten here.
    const input = { ...(raw as unknown as ManualLeadInput), organizationId };
    const normalized = toNormalizedManualRecord(input);
    return { raw, normalized };
  },
};
