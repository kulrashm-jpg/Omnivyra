/**
 * PI-P1-W02 — the CSV / spreadsheet entry adapter. The THIRD source namespace,
 * after `manual` and `crm`.
 *
 * ─── THE FILE NEVER REACHES THE SERVER ────────────────────────────────────
 * By the approved W02 design (option A) the client parses the CSV/XLSX and
 * POSTs the resulting rows as the existing `records[]` array. There is no
 * upload, no blob, no parser dependency and no storage anywhere in this path —
 * a "CSV row" arriving here is already a plain object keyed by column header.
 * That is why this module adds no dependency: the parsing problem is solved
 * where the file already is.
 *
 * ─── NORMALISATION IS BORROWED, NEVER REBUILT ─────────────────────────────
 * Everything except the namespace is manual entry's problem, already solved and
 * already proven, so `toNormalizedManualRecord` does the work and this module
 * re-keys the result — the same posture `crmAdapter` takes and for the same
 * reason. A second spelling of "what is this email, really" is how two adapters
 * come to disagree about whether two people are the same person.
 *
 * ─── IDENTITY: LIKE MANUAL, NOT LIKE CRM ──────────────────────────────────
 * A CRM record is defined by the CRM's own id, so `crmAdapter` requires one. A
 * spreadsheet row is not: an export may carry a source-system id, or it may be
 * nothing but a name, an email and a job title. So this adapter keeps manual's
 * rule — email, phone OR a reference — rather than inventing a stricter one
 * that would refuse the ordinary case this source exists to serve.
 *
 * ─── A HASH IS A ROW IDENTITY, NOT AN EXTERNAL IDENTITY ───────────────────
 * The one place this adapter must not follow `crmAdapter` is `externalKeys`.
 * When no reference is supplied, `csvExternalId` synthesises a deterministic
 * digest so re-uploading the same file is idempotent rather than duplicating
 * people. That digest is PROVENANCE — the `source_records.source_record_id` for
 * this row — and it is deliberately NOT written into `person.externalKeys`.
 * Doing so would publish a hash the platform invented as though a real system
 * had issued it, and `identity_claims` would then carry an external identity
 * that exists nowhere outside this codebase. `externalKeys` is set only when
 * the operator actually supplied an id.
 *
 * ─── IT TRANSLATES. THAT IS ALL. ──────────────────────────────────────────
 * `translate` is synchronous by the LI-4D contract, so this module cannot await
 * a database, a fetch or a credential lookup even if someone tried. Identity
 * resolution, account resolution, provenance, duplicate parking and governance
 * all remain inside the orchestrator, and are reached because this adapter goes
 * through the registry like any other source.
 */

import { createHash } from 'node:crypto';
import { normalizeEmail, normalizePhone } from '../../identityResolutionService';
import {
  toNormalizedManualRecord,
  type ManualLeadInput,
} from './manualAdapter';
import type { AdapterResult, LeadSourceAdapter, NormalizedIngestionRecord } from '../contracts';

export const CSV_SOURCE = 'csv';

/**
 * One already-parsed spreadsheet row.
 *
 * The field vocabulary is `ManualLeadInput`'s, reused rather than redeclared —
 * there is no second DTO here, and no CSV-specific column vocabulary. Mapping a
 * spreadsheet's own headers onto these names is the client's job, which is what
 * keeps arbitrary columns out of the canonical model: a column this contract
 * does not name is simply not submitted, and can never become a database field.
 *
 * `referenceId` carries the source system's row id when the export has one.
 */
export type CsvLeadInput = ManualLeadInput;

const trimmed = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * The row's stable provenance identity.
 *
 * The operator's reference wins when the export carried one, so a re-upload
 * matches the same row. With no reference, a deterministic digest of the tenant
 * and the identity signals is used, so uploading the same file twice is
 * idempotent rather than accumulating duplicates.
 *
 * Deliberately parallel to `manualExternalId` rather than delegating to it: the
 * `csv:` prefix is part of the identity this source records, and reusing
 * manual's function would stamp `manual:` onto rows whose provider is `csv`.
 * Re-prefixing another module's output by string surgery would couple this
 * adapter to a format it does not own, which is worse than eight explicit lines.
 */
export function csvExternalId(input: CsvLeadInput): string {
  const ref = trimmed(input?.referenceId);
  if (ref) return ref;
  const email = normalizeEmail(input?.email) ?? '';
  const phone = normalizePhone(input?.phone) ?? '';
  const digest = createHash('sha256')
    .update(`${input?.organizationId ?? ''}|${email}|${phone}`)
    .digest('hex')
    .slice(0, 32);
  return `${CSV_SOURCE}:${digest}`;
}

/**
 * Translate one parsed row into the LI-4D normalized record.
 *
 * The manual normaliser validates and produces everything — including the
 * identity rule, which throws `ManualInputError` for a row that carries no
 * email, phone or reference. Only the namespace is decided here.
 */
export function toNormalizedCsvRecord(input: CsvLeadInput): NormalizedIngestionRecord {
  const base = toNormalizedManualRecord(input);
  const reference = trimmed(input?.referenceId);

  return {
    ...base,
    source: CSV_SOURCE,
    externalId: csvExternalId(input),
    person: {
      ...base.person,
      // Only a real, operator-supplied id is an external identity. A synthesised
      // digest is provenance and stays out of `externalKeys` — see the header.
      externalKeys: reference ? { [CSV_SOURCE]: { external_id: reference } } : null,
    },
  };
}

/**
 * The adapter. Registered through the LI-4D registry so the orchestrator can
 * discover and invoke it without knowing it exists.
 *
 * CAPABILITIES, stated honestly: an operator uploading their own export
 * introduces people and employers the platform did not have, so it discovers
 * both. It fetches nothing, searches nothing and enriches nothing, so it claims
 * none of those — this adapter cannot reach a network even in principle.
 */
export const csvAdapter: LeadSourceAdapter = {
  source: CSV_SOURCE,
  label: 'CSV / Excel import',
  capabilities: ['person_discovery', 'account_discovery'],

  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    // The batch's tenant is authoritative; a record naming another is refused by
    // the orchestrator, and is not silently rewritten here.
    const input = { ...(raw as unknown as CsvLeadInput), organizationId };
    const normalized = toNormalizedCsvRecord(input);
    return { raw, normalized };
  },
};
