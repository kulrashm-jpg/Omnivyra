/**
 * R3: the pre-import duplicate probe. BLOCK or PARK, NEVER MERGE.
 *
 * Owner decision R3 (2026-11-10), as ruled with the PI reviewer:
 *  - a provider record that is already in the tenant (its provider id is known)
 *    is SKIPPED: `already_imported`;
 *  - an exact match on a personal email, or on an E.164 phone whose holder's
 *    name ALSO agrees, is a duplicate and is SKIPPED (blocked): it is not imported;
 *  - a weak match is HELD for tenant review (`prospect_import_review_items`)
 *    and NOT imported: a first + last name match (`name_match`), a role-shaped
 *    address such as info@ (`role_contact`), or a phone match whose names do
 *    not agree, which looks like a shared or switchboard number (`shared_phone`);
 *    The PHONE RULE is OWNER-RATIFIED (2026-11-11, relayed by virality-e9):
 *    same phone + same name = duplicate, skipped; same phone + different name
 *    = held for review. Never imported or merged automatically.
 *  - a probe that cannot answer is `probe_unknown`: neither imported nor
 *    called a duplicate, reported per record, and reconsidered on the next run.
 *  - anything else is imported normally.
 *
 * WHY "BLOCK OR PARK" IS ENFORCED HERE AND NOT BY CONVENTION. This module
 * returns VERDICTS and has no write path of its own: it reads `unified_persons`
 * through ports that SELECT. Merging needs `resolveUnifiedPerson`,
 * `attachPerson` or an identity write, and none of them is reachable from here
 * (a test scans the source). Using one key to BLOCK an import is conservative;
 * using it to MERGE is what the founder's rule prohibits.
 *
 * NORMALISATION, stated (review F3, F12):
 *  - EMAIL: trimmed and case-folded WHOLE (local part included), exactly W1's
 *    `normalizeEmail`, so the probe and the resolver agree on what "the same
 *    email" is. No dot or plus stripping. `John.Smith@x.com` == `john.smith@x.com`.
 *  - PHONE: compared ONLY when the provider gave an E.164 number (`+` and 8-15
 *    digits after W1's `normalizePhone`). Any other phone is not compared at all.
 *  - EMPTY never equals EMPTY: absent/blank keys are never looked up.
 *  - NAME: `lib/names/personName.ts` (first + last tokens, folded).
 *
 * A NULL ERROR IS NOT AN ANSWER: a port that cannot prove it read rows returns
 * `unknown`, and an unknown on any probe makes the record `probe_unknown`.
 */

import { normalizeEmail, normalizePhone } from '../identityResolutionService';
import { nameTokens, personNamesAgree } from '../../../lib/names/personName';
import type { NormalizedIngestionRecord } from '../leadIngestion/contracts';

export type HoldReason = 'name_match' | 'role_contact' | 'shared_phone';

export type ProbeVerdict =
  | { kind: 'import' }
  | { kind: 'skip'; reason: 'already_imported' | 'email_match' | 'phone_match'; matchedPersonId: string }
  | { kind: 'hold'; reason: HoldReason; matchedPersonIds: string[] }
  | { kind: 'probe_unknown'; failed: 'external_key' | 'email' | 'phone' | 'name' };

export interface ProbePerson { readonly id: string; readonly fullName: string | null }

/** A lookup either answers with rows (possibly none) or admits it could not. */
export type Lookup = { ok: true; persons: ProbePerson[] } | { ok: false };

export interface ProbePorts {
  byExternalKey(organizationId: string, source: string, externalId: string): Promise<Lookup>;
  byEmail(organizationId: string, email: string): Promise<Lookup>;
  byPhone(organizationId: string, phone: string): Promise<Lookup>;
  /** Persons whose name contains `lastToken`; the caller applies the name rule. */
  byNameToken(organizationId: string, lastToken: string): Promise<Lookup>;
}

/** Shared mailboxes. A match on one of these says nothing about WHICH person. */
const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'info', 'sales', 'contact', 'contactus', 'hello', 'hi', 'support', 'help', 'admin', 'office',
  'careers', 'jobs', 'hr', 'recruiting', 'talent', 'marketing', 'team', 'enquiries', 'enquiry',
  'inquiries', 'inquiry', 'billing', 'accounts', 'finance', 'noreply', 'no-reply', 'press', 'media',
  'partners', 'partnerships', 'bizdev', 'reception', 'service', 'customerservice', 'webmaster',
  'postmaster', 'abuse', 'privacy', 'legal', 'security', 'founders', 'general', 'mail',
]);

export function isRoleAddress(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  return ROLE_LOCAL_PARTS.has(local.replace(/[._-]/g, '')) || ROLE_LOCAL_PARTS.has(local);
}

/** E.164 or nothing: `+` then 8-15 digits, after W1's own normalisation. */
export function e164(phone: unknown): string | null {
  const n = normalizePhone(typeof phone === 'string' ? phone : null);
  return n && /^\+\d{8,15}$/.test(n) ? n : null;
}

/** The provider's own key for this record under its source (`external_keys`). */
function providerKeyOf(record: NormalizedIngestionRecord): string | null {
  const keys = record.person?.externalKeys;
  if (!keys || typeof keys !== 'object') return null;
  const entry = (keys as Record<string, unknown>)[record.source];
  if (!entry || typeof entry !== 'object') return null;
  const id = (entry as Record<string, unknown>).external_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function displayName(record: NormalizedIngestionRecord): string | null {
  const p = record.person;
  if (!p) return null;
  if (p.fullName && p.fullName.trim()) return p.fullName;
  const joined = [p.firstName, p.lastName].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  return joined || null;
}

const MAX_HELD_MATCHES = 10;

/**
 * Probe ONE translated record. Reads only. The order is strongest first, and
 * the first conclusive answer wins.
 */
export async function probeRecord(record: NormalizedIngestionRecord, ports: ProbePorts): Promise<ProbeVerdict> {
  const org = record.organizationId;
  const name = displayName(record);

  // 1. Already imported: the provider's own id is known to this tenant.
  const providerKey = providerKeyOf(record);
  if (providerKey) {
    const r = await ports.byExternalKey(org, record.source, providerKey);
    if (!('persons' in r)) return { kind: 'probe_unknown', failed: 'external_key' };
    if (r.persons.length) return { kind: 'skip', reason: 'already_imported', matchedPersonId: r.persons[0].id };
  }

  // 2. Email. A personal address blocks; a role address holds.
  const email = normalizeEmail(record.person?.email ?? null);
  if (email) {
    const r = await ports.byEmail(org, email);
    if (!('persons' in r)) return { kind: 'probe_unknown', failed: 'email' };
    if (r.persons.length) {
      return isRoleAddress(email)
        ? { kind: 'hold', reason: 'role_contact', matchedPersonIds: r.persons.slice(0, MAX_HELD_MATCHES).map((p) => p.id) }
        : { kind: 'skip', reason: 'email_match', matchedPersonId: r.persons[0].id };
    }
  }

  // 3. Phone, E.164 only. It blocks only when the holder's name agrees too;
  //    otherwise it may be a switchboard shared by different people: hold.
  const phone = e164(record.person?.phone ?? null);
  if (phone) {
    const r = await ports.byPhone(org, phone);
    if (!('persons' in r)) return { kind: 'probe_unknown', failed: 'phone' };
    if (r.persons.length) {
      const same = r.persons.find((p) => personNamesAgree(p.fullName, name));
      return same
        ? { kind: 'skip', reason: 'phone_match', matchedPersonId: same.id }
        : { kind: 'hold', reason: 'shared_phone', matchedPersonIds: r.persons.slice(0, MAX_HELD_MATCHES).map((p) => p.id) };
    }
  }

  // 4. Name: first + last agreement holds for review. Never a block, never a merge.
  const tokens = nameTokens(name);
  if (tokens.length >= 2) {
    const r = await ports.byNameToken(org, tokens[tokens.length - 1]);
    if (!('persons' in r)) return { kind: 'probe_unknown', failed: 'name' };
    const matches = r.persons.filter((p) => personNamesAgree(p.fullName, name));
    if (matches.length) {
      return { kind: 'hold', reason: 'name_match', matchedPersonIds: matches.slice(0, MAX_HELD_MATCHES).map((p) => p.id) };
    }
  }

  return { kind: 'import' };
}
