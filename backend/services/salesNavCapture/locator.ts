/**
 * D7(i): the person's LinkedIn profile URL as a NON-MERGING LOCATOR.
 *
 * Owner decision D7=(a) with the binding constraint (2026-11-10): the profile
 * URL is used ONLY to select an enrichment match at Apollo. It is never an
 * identity claim, never an `external_keys` entry, never input to W1, the
 * verified-identity predicate, `attachPerson` or reconciliation. Nothing here
 * writes.
 *
 * It is read from the person's OWN Sales Navigator evidence, the latest
 * `source_records` row for this tenant + person + provider, and returned
 * AS CAPTURED. Normalisation and slug classification happen later, at the
 * selector, so the stored evidence never depends on the normaliser (PI review F1).
 */
import { ownedDbTable } from '../../db/writeOwner';
import { SALESNAV_SOURCE } from './contract';

export interface PersonLocators {
  /** The captured public profile URL, verbatim, or null when none was captured. */
  readonly linkedinProfileUrl: string | null;
}

export const NO_LOCATORS: PersonLocators = Object.freeze({ linkedinProfileUrl: null });

/**
 * Read the locator. Tenant-scoped on every query.
 *
 * A read ERROR throws (the caller's snapshot read fails, as for every other
 * snapshot table): a locator we could not read is not "no locator". An empty
 * result IS a real answer here, because absence only means fewer selectors,
 * and fewer selectors can only refuse before egress, never spend.
 */
export async function readPersonLocators(organizationId: string, personId: string | null): Promise<PersonLocators> {
  const org = String(organizationId ?? '').trim();
  const person = String(personId ?? '').trim();
  if (!org || !person) return NO_LOCATORS;
  const { data, error } = await ownedDbTable('source_records')
    .select('raw_payload, last_seen_at')
    .eq('organization_id', org)          // tenant boundary — never optional
    .eq('person_id', person)
    .eq('provider', SALESNAV_SOURCE)
    .order('last_seen_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`source_records locator read failed: ${error.message}`);
  const raw = (Array.isArray(data) && data[0] ? (data[0] as { raw_payload?: unknown }).raw_payload : null) as
    Record<string, unknown> | null;
  const url = raw && typeof raw.public_profile_url === 'string' && raw.public_profile_url.trim()
    ? raw.public_profile_url
    : null;
  return { linkedinProfileUrl: url };
}
