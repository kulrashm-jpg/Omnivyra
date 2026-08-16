/**
 * LI-5E.4 — the CRM-namespace entry adapter. The SECOND platform, and the
 * reason it exists is narrow: LI-5C requires observations from ≥2 platforms,
 * and `manual` can only ever produce one.
 *
 * ─── THIS IS NOT A CRM INTEGRATION ────────────────────────────────────────
 * It does not talk to HubSpot, Salesforce, Zoho or any provider, and it is
 * unrelated to `crmIngestionService`, `crmActivationService` and the ingestion
 * scheduler — none of which this phase touches. Records are operator-supplied,
 * exactly like manual entry. What differs is ONLY the namespace the external
 * identity lands in: `crm` rather than `manual`.
 *
 * Choosing `crm` rather than inventing a namespace matters. It is the key
 * `crmIngestionService` already writes (`{ crm: { external_id } }`), so if that
 * path is ever activated the two agree about what a CRM identity is instead of
 * quietly creating two populations of the same person.
 *
 * ─── NORMALISATION IS BORROWED, NEVER REBUILT ─────────────────────────────
 * Everything except the namespace is manual entry's problem, already solved and
 * already proven, so `toNormalizedManualRecord` does the work and this module
 * re-keys the result. A second spelling of "what is this email, really" is how
 * two adapters come to disagree about whether two people are the same person —
 * the same reason the manual adapter borrows its own rules rather than writing
 * them.
 *
 * ─── IT TRANSLATES. THAT IS ALL. ──────────────────────────────────────────
 * `translate` is synchronous by the LI-4D contract, so this module cannot await
 * a database, a fetch or a credential lookup even if someone tried. Identity
 * resolution, provenance, duplicate parking, the LI-5D dual-write and the LI-5E
 * observation all remain where they are — inside the orchestrator and the
 * resolver — and are reached because this adapter goes through the registry
 * like any other source.
 */

import {
  ManualInputError,
  toNormalizedManualRecord,
  type ManualLeadInput,
} from './manualAdapter';
import type { AdapterResult, LeadSourceAdapter, NormalizedIngestionRecord } from '../contracts';

export const CRM_SOURCE = 'crm';

/**
 * What an operator may supply for a CRM-sourced person.
 *
 * The field vocabulary is `ManualLeadInput`'s, reused rather than redeclared —
 * there is no second DTO here. The ONE semantic difference is the identity
 * field: manual entry accepts an email, a phone OR a reference, whereas a CRM
 * record is defined by the CRM's own id, so `externalId` is REQUIRED and
 * `referenceId` is not part of this contract.
 *
 * Everything else stays optional, including email and phone — that is
 * deliberate, not an oversight. A record carrying only an external id is the
 * case that reaches the external identity stage, and refusing it would make the
 * external stage unreachable through this adapter.
 */
export type CrmLeadInput = Omit<ManualLeadInput, 'referenceId'> & { externalId: string };

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * The CRM's own identifier for this record.
 *
 * Required, and required to be a string: unlike manual entry there is no
 * deterministic fallback, because a CRM record with no CRM id is not a CRM
 * record. Fabricating an id from the email would defeat the purpose — the whole
 * point of this adapter is to carry an identity that is NOT an email.
 */
export function crmExternalId(input: CrmLeadInput): string {
  const externalId = trimmed(input?.externalId);
  if (!externalId) {
    throw new ManualInputError(
      'externalId is required — a CRM record is identified by the CRM’s own id',
      'externalId',
    );
  }
  return externalId;
}

/**
 * Translate CRM input into the LI-4D normalized record.
 *
 * The manual normalizer produces everything, then the source and the external
 * identity namespace are re-keyed to `crm`. `referenceId` is set to the CRM id
 * so the record's `externalId` — its provenance identity — is the CRM id and
 * not a hash, which is what makes re-submitting the same record idempotent.
 */
export function toNormalizedCrmRecord(input: CrmLeadInput): NormalizedIngestionRecord {
  const externalId = crmExternalId(input);

  const base = toNormalizedManualRecord({
    ...(input as unknown as ManualLeadInput),
    referenceId: externalId,
  });

  return {
    ...base,
    source: CRM_SOURCE,
    person: {
      ...base.person,
      // The namespace, and the only thing this adapter really decides. Set
      // unconditionally: `externalId` is required, so unlike manual entry there
      // is no case where a person arrives without a provider identifier.
      externalKeys: { [CRM_SOURCE]: { external_id: externalId } },
    },
  };
}

/**
 * The adapter. Registered through the LI-4D registry so the orchestrator can
 * discover and invoke it without knowing it exists.
 *
 * CAPABILITIES, stated honestly: an operator entering CRM records introduces
 * people and employers the platform did not have, so it discovers both. It
 * fetches nothing, searches nothing and enriches nothing, so it claims none of
 * those — this adapter cannot reach a CRM even in principle.
 */
export const crmAdapter: LeadSourceAdapter = {
  source: CRM_SOURCE,
  label: 'CRM record (operator-supplied)',
  capabilities: ['person_discovery', 'account_discovery'],

  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    // The batch's tenant is authoritative; a record naming another is refused by
    // the orchestrator, and is not silently rewritten here.
    const input = { ...(raw as unknown as CrmLeadInput), organizationId };
    const normalized = toNormalizedCrmRecord(input);
    return { raw, normalized };
  },
};
