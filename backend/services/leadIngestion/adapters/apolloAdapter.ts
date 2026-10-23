/**
 * PHASE 4 — the Apollo source adapter: the PURE translation half.
 *
 * ─── PURE BY CONTRACT, AND THAT IS THE POINT ──────────────────────────────
 * `translate` receives one Apollo person record and returns data. It performs no
 * I/O, holds no credential, and reaches no database — fetching is the discovery
 * adapter's job and is governed by the attempt ledger. This file is what lets
 * Apollo's results enter the SAME canonical path as a CSV row.
 *
 * It creates no prospect. It writes nothing. Identity resolution, duplicate
 * detection, account resolution, `source_records`, `source_assertions` and B1b
 * arbitration all happen downstream, in the existing ingestion boundary, exactly
 * as they do for every other source.
 *
 * ─── SOURCE IDENTITY IS THE APOLLO PERSON ID. NOTHING ELSE. ───────────────
 * `externalId` is Apollo's own `id`, and it is REQUIRED: a record without one
 * throws, which the orchestrator reports as a per-record normalisation failure
 * rather than aborting the batch. That strictness is deliberate and it is a
 * replay-safety property, not fussiness — `findPersonByExternalKeys` returns null
 * on an empty key map, so a record carrying no stable provider id would mint a
 * NEW all-null person on every replay. Unbounded duplicates.
 *
 * Email, phone and name are NEVER used as Apollo's source identity. They are
 * attributes; the provider id is identity. The same id also goes into
 * `person.externalKeys` as `{ apollo: { external_id } }`, which is the hard
 * identity signal W1's resolver reads after email and phone.
 *
 * ─── A PERSON WITHOUT CONTACT DETAILS IS STILL A PROSPECT ─────────────────
 * Apollo's free tier is documented to withhold email and obfuscate `last_name`.
 * Such a record is translated and ingested anyway: contactability is a separate
 * attribute from prospect identity, and discarding a prospect because it cannot
 * currently be emailed would make the canonical spine a contactability index.
 * Outreach eligibility is decided elsewhere, by code that is not touched here.
 *
 * ─── NOTHING IS INVENTED ──────────────────────────────────────────────────
 * An absent field stays absent. `observedAt` is NULL because Apollo's search
 * payload carries no per-record observation date, and substituting fetch time
 * would assert a freshness nobody stated — B1b's ratified
 * `COALESCE(observed_at, recorded_at)` then does the right thing. `confidence` is
 * NULL because Apollo states none, and cross-provider confidence is not
 * comparable anyway.
 */

import type { AdapterResult, LeadSourceAdapter, NormalizedIngestionRecord } from '../contracts';

/** The source key. Shared with the discovery adapter — one provider identity. */
export const APOLLO_SOURCE = 'apollo';

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

/** Apollo's nested employer object, when it supplies one. */
function employerOf(raw: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['organization', 'account']) {
    const value = raw[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Translate ONE Apollo person record.
 *
 * Exported so the mapping can be exercised without a transport or a database.
 */
export function translateApolloPerson(
  raw: Record<string, unknown>,
  organizationId: string,
): AdapterResult {
  const personId = str(raw.id);
  if (!personId) {
    // See the header: without a stable provider id, replay is not safe. Refusing
    // one record is far cheaper than duplicating people on every run.
    throw new Error('apollo record has no `id`; Apollo person id is the source identity and is required');
  }

  const employer = employerOf(raw);
  const employerName = employer ? str(employer.name) : null;
  // Apollo supplies the employer domain under either key depending on the shape.
  const employerDomain = employer
    ? (str(employer.primary_domain) ?? str(employer.website_url) ?? str(employer.domain))
    : null;
  const employerId = employer ? str(employer.id) : null;

  const normalized: NormalizedIngestionRecord = {
    organizationId,
    source: APOLLO_SOURCE,
    entityType: 'person',
    // SOURCE IDENTITY. Apollo's own id, never an email or a name.
    externalId: personId,
    person: {
      // Present only when Apollo actually returned them. `email_status` is
      // deliberately ignored: it is Apollo's deliverability opinion, not an
      // address, and PI has no verification flag anywhere to put it in.
      email: str(raw.email),
      phone: str(raw.sanitized_phone) ?? str(raw.phone_number),
      fullName: str(raw.name),
      firstName: str(raw.first_name),
      lastName: str(raw.last_name),
      jobTitle: str(raw.title),
      city: str(raw.city),
      countryCode: null,     // Apollo returns a country NAME; PI stores a code.
      region: str(raw.state),
      // The hard identity signal, in the shape `unified_persons.external_keys`
      // expects. This is what makes a replay resolve to the same person.
      externalKeys: { [APOLLO_SOURCE]: { external_id: personId } },
    },
    // The employer, only when Apollo said something about one. `externalId` here
    // is Apollo's organization id — account source identity, same principle.
    account: employer
      ? {
          externalId: employerId,
          name: employerName,
          domain: employerDomain,
          employeeCount: num(employer.estimated_num_employees),
        }
      : null,
    // Apollo's search payload carries no per-record observation date, and
    // inventing one would assert a freshness nobody stated.
    observedAt: null,
    // Apollo states no per-record confidence.
    confidence: null,
  };

  // `raw` is passed VERBATIM: LI-2 redacts and hashes it, so pre-stripping here
  // would destroy evidence the provenance layer is meant to keep.
  return { raw, normalized };
}

export const apolloLeadSourceAdapter: LeadSourceAdapter = {
  source: APOLLO_SOURCE,
  label: 'Apollo',
  // Only what this adapter actually implements. `enrichment` is NOT claimed:
  // Apollo enrichment is a different capability served by a different adapter,
  // and claiming it here would conflate the two.
  capabilities: ['person_discovery', 'search'],
  translate: translateApolloPerson,
};
