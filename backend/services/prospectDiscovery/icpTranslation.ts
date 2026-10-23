/**
 * PI-ICP-DISCOVERY-001 — ratified ICP criteria → provider-neutral discovery filters.
 *
 * The missing link the PI audit found: `prospect_icp_versions.criteria` is the
 * canonical targeting decision, and the discovery executor took its filters
 * from a request body. Nothing connected the two, so discovery was
 * operator-driven rather than ICP-driven.
 *
 * ─── WHAT THIS MODULE IS ──────────────────────────────────────────────────
 * PURE. No I/O, no clock, no database, no provider, no credential. It takes a
 * `RatifiedIcp` and returns either the neutral `filters` object the executor
 * already accepts, or a structured refusal. The same discipline `mayContact`
 * and `planPersonErasure` follow, and for the same reason: a targeting decision
 * must be replayable and defensible months later.
 *
 * It does NOT fetch the ICP. The caller supplies a `RatifiedIcp`, which is the
 * narrowed type the evaluator already requires — so a draft or proposed version
 * cannot reach discovery by accident, and the ratification contract is enforced
 * by the type system rather than by a runtime check this module invents.
 *
 * ─── THE TRANSLATION SURFACE IS DELIBERATELY TINY ─────────────────────────
 * Two closed vocabularies have to meet, and they barely overlap:
 *
 *   ICP attributes   a closed list of columns on `prospect_accounts` /
 *                    `unified_persons` (criteria.ts)
 *   neutral filters  the 6-key allowlist the discovery adapters accept
 *                    (`APOLLO_DISCOVERY_FILTERS`)
 *
 * TWO pairings are evidenced today:
 *
 *   person.job_title + one_of  ->  titles        (PI-ICP-DISCOVERY-001)
 *   person.seniority + one_of  ->  seniorities   (PI-ICP-DISCOVERY-005)
 *
 * `job_title` is `exact_text` with no vocabulary — the operator typed the
 * labels — and Apollo's `person_titles` takes title strings. The values pass
 * through unchanged, so the translated search means what the ICP said.
 *
 * NOTE ON TITLE MATCHING. Apollo's `person_titles` is FUZZY by default and the
 * adapter now sends `include_similar_titles: false` so the provider is told not
 * to broaden it. Without that, this mapping would return similar titles the
 * ICP's exact `one_of` would not have counted as satisfied — a broadening of
 * the tenant's own target. The semantics live in the adapter because that is
 * where provider parameters belong; this module stays provider-neutral.
 *
 * `seniority` is a CLOSED vocabulary on both sides and eleven of the ICP's
 * twelve tokens are documented by the provider verbatim, so the mapping is an
 * identity over those eleven and a refusal for anything else.
 *
 * ─── WHAT IS NOT MAPPED, AND WHY NOT ──────────────────────────────────────
 * Each of these is a SEMANTIC question nobody has answered. Mapping one anyway
 * would silently change what a tenant's ratified ICP targets, so each refuses.
 * The tenant-facing wording lives in `UNMAPPED_ATTRIBUTE_NOTES`; what follows is
 * the architectural reason, which is not always the same thing.
 *
 *   account.employee_band -> companyHeadcount
 *     DIFFERENT MEASURES. This criterion compares an exact stored band-LABEL
 *     string, while the provider's documented filter matches a headcount
 *     NUMBER. Two boundaries that look alike do not make the comparison
 *     equivalent, and the provider's endpoint behaviour is independently
 *     unresolved (see below). No Apollo call has ever been made from this
 *     platform either, so the accepted ranges are a provider claim this
 *     repository cannot currently support.
 *
 *   account.employee_count -> companyHeadcount
 *     The provider documents a two-ended numeric range, so the FORM is not the
 *     obstacle — this is the one place where the two shapes line up. What is
 *     unproven is (a) whether the provider's endpoints include their own bounds,
 *     as this evaluator's `between` does; (b) what the provider does with a
 *     company whose headcount it does not record, where this evaluator ABSTAINS
 *     rather than excluding the record; and (c) how an open-ended `at_least` or
 *     `at_most` would be expressed at all. (c) must not be approximated:
 *     inventing the missing bound states a limit the tenant never did.
 *
 *   person.city -> locations
 *     The provider documents a bare city value, so the form is settled. Its
 *     MATCHING is not: whether it is exact and case-sensitive as this
 *     criterion's `one_of` is, how it resolves a city name that occurs in more
 *     than one country, and whether a person with no recorded city can be
 *     included at all.
 *
 *   person.region -> locations
 *     This criterion's region is UNCONSTRAINED text. The provider documents
 *     state-level values for a single country and says nothing about regions
 *     elsewhere, so for most values there is no documented provider form to
 *     compare against; and for the values it does document, the matching and
 *     missing-value questions above are still open.
 *
 *   person.country_code -> locations
 *     This criterion holds an ISO-3166-1 alpha-2 code. The provider's
 *     documentation shows country NAMES and never states that a standalone
 *     two-letter code is accepted, and its own examples are not consistent on
 *     the format. A name example is not evidence that a code is accepted, and
 *     converting one into the other needs a vocabulary the provider does not
 *     publish — a product decision, not a translation detail.
 *
 *   account.city / region / country_code -> locations
 *     WRONG SUBJECT. The only location filter this translator can emit
 *     describes where a PERSON lives; these criteria are about the account. The
 *     provider's organization-location filter is documented as matching a
 *     company's HEADQUARTERS only, which is a narrower claim than "the account
 *     is located here", and it is not in the adapter's allowlist. Headquarters
 *     must not be assumed to be the account's stored location.
 *
 *   MULTIPLE location criteria -> one `locations` list
 *     Separate ICP criteria are CONJUNCTIVE: a prospect satisfies the ICP by
 *     satisfying each of them. A provider location list need not combine its
 *     values the same way, and the provider does not document how it combines
 *     them — neither disjunctively nor conjunctively. So even once a single
 *     location attribute becomes mappable, two of them must not be folded into
 *     one list without that evidence and an explicit design decision. A list
 *     that combined them the other way would broaden the search, and breadth
 *     is spend.
 *
 *   companyDomains, nameQuery
 *     No ICP attribute holds either. Nothing to translate.
 *
 * These are recorded in `UNMAPPED_ATTRIBUTE_NOTES` so the refusal a tenant sees
 * explains itself, and so adding a mapping later is a visible, deliberate act.
 *
 * ─── FAIL CLOSED, AND WHAT THAT MEANS PRECISELY ───────────────────────────
 * A discovery request that silently omits a material ICP condition is worse
 * than no request: it spends a tenant's provider budget searching for something
 * other than their target, and the ledger would record it as an ICP-driven
 * search. So:
 *
 *   a MANDATORY criterion that cannot be translated  -> REFUSE
 *   a REQUIRED or OPTIONAL criterion                  -> never a filter;
 *                                                        recorded in `omitted`
 *   nothing translated at all                         -> REFUSE
 *   anything in `omitted` and no acknowledgement      -> REFUSE
 *
 * The third rule is the one that matters most: an empty filter object is an
 * UNRESTRICTED search. A translator that returned `{}` on a fully unmappable
 * ICP would turn "we cannot express your target" into "fetch everyone".
 *
 * ─── WHY SOFT CRITERIA ARE NOT FILTERS (PI-ICP-DISCOVERY-002) ─────────────
 * A provider filter EXCLUDES; the ICP's soft criteria do not. `evaluate.ts:246`
 * computes `satisfied / evaluable` and privileges exactly one kind:
 *
 *     value = mandatoryUnsatisfied ? 0 : satisfied / evaluable
 *
 * So `mandatory` is a hard gate, and `required` is indistinguishable from
 * `optional` to the evaluator — both merely move a ratio. Turning either into a
 * provider filter would convert a scoring input into a hard exclusion and
 * NARROW the search relative to what the tenant asked for. That is the mirror
 * image of the broadening this module already refuses, and just as wrong.
 *
 * The earlier revision of this file had `required` in `MATERIAL_KINDS`, which
 * blocked more ICPs than the ICP's own semantics require. Corrected.
 *
 * ─── THE ACKNOWLEDGEMENT ──────────────────────────────────────────────────
 * Because soft criteria are recorded rather than applied, a translated search
 * is routinely narrower than the ICP it came from. The caller must say so out
 * loud: `acknowledgeOmissions: true`, compared by strict identity. An
 * acknowledgement that a stray truthy value could satisfy is not consent.
 */

import { ICP_CRITERION_KINDS } from '../prospectIcp/types';
import type { IcpCriterion, IcpSubject, RatifiedIcp } from '../prospectIcp/types';

/** The neutral filter keys this translator is allowed to produce. */
export const TRANSLATABLE_FILTER_KEYS = ['titles', 'seniorities'] as const;
export type TranslatableFilterKey = typeof TRANSLATABLE_FILTER_KEYS[number];

/**
 * The seniority tokens the ICP and the provider genuinely SHARE.
 *
 * Apollo's People Search documents `person_seniorities` as accepting exactly
 * `owner, founder, c_suite, partner, vp, head, director, manager, senior,
 * entry, intern` (docs.apollo.io/reference/people-api-search, accessed
 * 2026-10-16). The ICP's own `SENIORITY_VALUES` is that list plus `other`, so
 * eleven of twelve correspond token-for-token and the mapping is an IDENTITY —
 * no translation table, nothing invented.
 *
 * `other` is the twelfth and has NO counterpart. It is deliberately absent
 * here: see the refusal rule on `allowedValues` below.
 *
 * Both sides are disjunctive — the ICP's `one_of` is exact membership
 * (`evaluate.ts:177`) and Apollo states "a person needs to match only one of
 * the seniorities added" — so passing the set through unchanged preserves the
 * criterion's meaning exactly.
 */
export const SHARED_SENIORITY_VALUES: readonly string[] = Object.freeze([
  'owner', 'founder', 'c_suite', 'partner', 'vp', 'head',
  'director', 'manager', 'senior', 'entry', 'intern',
]);

/**
 * The ONLY mappings that exist. Keyed `subject.attribute`, so a person and an
 * account attribute of the same name can never be confused for one another.
 *
 * `predicate` names the single predicate operator the mapping accepts. A
 * criterion using any other operator on a mapped attribute is UNSUPPORTED, not
 * coerced: `at_least` on a title set is not a thing this can honestly express.
 *
 * `allowedValues`, when present, is a CLOSED value contract: every value in the
 * criterion must appear in it. A mapping without one passes values through
 * (job titles are free text on both sides).
 */
export const ICP_TO_DISCOVERY_FILTER: Readonly<Record<string, {
  readonly filterKey: TranslatableFilterKey;
  readonly predicate: 'one_of';
  readonly allowedValues?: readonly string[];
}>> = Object.freeze({
  'person.job_title': { filterKey: 'titles', predicate: 'one_of' },
  'person.seniority': {
    filterKey: 'seniorities', predicate: 'one_of', allowedValues: SHARED_SENIORITY_VALUES,
  },
});

/**
 * Every account-side location attribute is refused for the SAME reason, so the
 * text is written once. The blocker is the SUBJECT, not the value format: the
 * only location filter this translator can emit is a person's, and an account
 * criterion asked about the account.
 *
 * Deliberately NOT a reason to reach for the provider's organization-location
 * filter instead: that filter is documented as matching a company's
 * headquarters only, which is a narrower claim than "this account is located
 * here", and it is not in the adapter's allowlist.
 */
const ACCOUNT_LOCATION_SUBJECT_MISMATCH = 'the one location filter available to this translator describes where a PERSON lives, and this criterion is about the account, so applying it would search on the wrong subject. The provider’s organization-location filter is documented as matching a company’s headquarters only, which is not necessarily what an account’s recorded location means, and that filter is not available here';

/**
 * Why a known attribute is deliberately not mapped. Shown in refusals.
 *
 * These strings are TENANT-FACING VERBATIM — the discovery route returns each
 * one as `blocking[].reason` in its 400 body. Two consequences:
 *
 *   they must be ACCURATE. A reason that names a difficulty which does not
 *   exist, or omits the one that does, misinforms a tenant about their own ICP
 *   at the moment their search is refused.
 *
 *   they must contain NO EXAMPLE VALUES. A static band, place name or country
 *   code inside one of these would be echoed back to a tenant who happened to
 *   submit that very value, which defeats the guarantee that a refusal never
 *   repeats a criterion's values and makes "did this leak?" unanswerable.
 *   This is why the region note below does not name the country whose states
 *   the provider documents: that country's code is itself a legal criterion
 *   value.
 */
export const UNMAPPED_ATTRIBUTE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  'account.employee_band': 'the band FORM differs from the provider’s and no provider call has ever confirmed the accepted ranges',
  'account.employee_count': 'the provider documents a two-ended numeric range form, so the SHAPE of a two-ended criterion is not the obstacle; what is unproven is whether the provider’s range endpoints include their own bounds as this criterion’s do, how the provider treats a company whose headcount it does not record while this criterion abstains on a missing value rather than excluding the record, and how an open-ended minimum or maximum would be expressed at all. Mapping stays refused until the provider documents these',
  'account.city': ACCOUNT_LOCATION_SUBJECT_MISMATCH,
  'account.region': ACCOUNT_LOCATION_SUBJECT_MISMATCH,
  'account.country_code': ACCOUNT_LOCATION_SUBJECT_MISMATCH,
  'person.city': 'the provider documents a bare city value, so the FORM is no longer the obstacle; what is undocumented is whether its city matching is exact and case-sensitive as this criterion’s is, how it resolves a city name that exists in more than one country, whether several city values widen or narrow the search, and whether a person with no recorded city can be included at all, since this criterion abstains on a missing value rather than excluding the record',
  'person.region': 'this criterion’s region is UNCONSTRAINED text, while the provider documents only state-level values within a single country and says nothing about provinces or regions elsewhere, so for most values there is no documented provider form to compare against. Where a value is such a state, the remaining gaps match the city case: whether matching is exact and case-sensitive, whether several values widen or narrow the search, and whether a person with no recorded region can be included, since this criterion abstains on a missing value',
  'person.country_code': 'this criterion holds an ISO-3166-1 alpha-2 code, and the provider’s documentation shows country NAMES as location values without ever stating that a standalone two-letter code is accepted; its own retrieved examples are not consistent in their location value format, and it publishes no country vocabulary, so converting a code into the name it expects would mean guessing that vocabulary. A conversion table is a separate owner decision and is not in place',
});

export type IcpTranslationRefusal =
  /** The ICP belongs to a different tenant than the request. */
  | 'tenant_mismatch'
  /** A mandatory/required criterion has no honest provider expression. */
  | 'unsupported_mandatory_criterion'
  /** A mapped attribute was used with a predicate the mapping cannot express. */
  | 'unsupported_predicate'
  /** A criterion is structurally malformed. */
  | 'malformed_criterion'
  /** Nothing could be translated, so the search would be unrestricted. */
  | 'no_translatable_criteria'
  /** Criteria were left out of the filters and the caller did not acknowledge it. */
  | 'omissions_unacknowledged'
  /**
   * A mapped attribute carried a value outside the provider's documented
   * vocabulary. Distinct from `unsupported_mandatory_criterion`, which is about
   * the ATTRIBUTE having no expression at all: here the attribute maps and one
   * of its values does not.
   */
  | 'unsupported_criterion_value';

/** A criterion that was not translated, and why. Never silent. */
export interface OmittedCriterion {
  readonly criterionId: string;
  readonly subject: IcpSubject;
  readonly attribute: string;
  readonly kind: IcpCriterion['kind'];
  readonly reason: string;
}

export interface IcpTranslationSuccess {
  readonly ok: true;
  /** Exactly the shape `DiscoverySearchRequest.filters` expects. */
  readonly filters: Readonly<Record<string, unknown>>;
  /** Which criteria produced the filters, for the audit trail. */
  readonly translated: readonly { readonly criterionId: string; readonly filterKey: string }[];
  /**
   * Every criterion that did NOT become a filter, with the reason. Non-empty
   * means the discovery search is narrower than the ICP it came from, so it is
   * only ever returned alongside an explicit acknowledgement.
   *
   * These criteria were NOT applied to discovery. Nothing here may be read as
   * "also filtered on".
   */
  readonly omitted: readonly OmittedCriterion[];
  /** True when the caller acknowledged `omitted`. False only when it is empty. */
  readonly omissionsAcknowledged: boolean;
  /** The ICP this search represents, so the ledger can cite it. */
  readonly icp: { readonly icpId: string; readonly version: number };
}

export interface IcpTranslationFailure {
  readonly ok: false;
  readonly refusal: IcpTranslationRefusal;
  readonly detail: string;
  /** Every criterion that blocked the translation. */
  readonly blocking: readonly OmittedCriterion[];
}

export type IcpTranslationResult = IcpTranslationSuccess | IcpTranslationFailure;

/**
 * The ONLY kind that may become a hard provider filter.
 *
 * PI-ICP-DISCOVERY-002 corrected this. `required` was here, which was stricter
 * than the ICP's own semantics: `evaluate.ts:245-246` computes
 * `satisfied / evaluable` and privileges exactly one kind —
 *
 *     value = mandatoryUnsatisfied ? 0 : satisfied / evaluable
 *
 * so `mandatory` is the hard gate and `required` is indistinguishable from
 * `optional` to the evaluator. Both are RATIO CONTRIBUTORS.
 */
const MATERIAL_KINDS = new Set<IcpCriterion['kind']>(['mandatory']);

/**
 * The ICP's OWN kind vocabulary, imported rather than restated.
 *
 * Kept separate from `MATERIAL_KINDS` deliberately. An earlier revision
 * validated `kind` against the material set, so narrowing that set to
 * `mandatory` alone made every `required` criterion read as MALFORMED. "Which
 * kinds exist" and "which kinds filter" are different questions and must not
 * share one list.
 */
const VALID_KINDS = new Set<string>(ICP_CRITERION_KINDS);

const key = (subject: string, attribute: string): string => `${subject}.${attribute}`;

const cleanValues = (values: unknown): string[] | null => {
  if (!Array.isArray(values)) return null;
  const out = [...new Set(
    values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v !== ''),
  )];
  return out.length > 0 ? out : null;
};

const omission = (c: IcpCriterion, reason: string): OmittedCriterion => ({
  criterionId: String(c.id ?? ''),
  subject: c.subject,
  attribute: String(c.attribute ?? ''),
  kind: c.kind,
  reason,
});

/**
 * Translate a ratified ICP into the neutral discovery filters.
 *
 * `organizationId` is the VERIFIED tenant of the request, passed separately on
 * purpose: comparing it against the ICP's own tenant is what stops one tenant's
 * ratified targeting being used to build another tenant's provider search. The
 * ICP document is not trusted to be self-describing about whose it is.
 *
 * Returns a structured result and throws nothing — a refusal is data the caller
 * records, not an exception it might swallow.
 */
export function translateRatifiedIcpToDiscoveryFilters(input: {
  readonly organizationId: string;
  readonly ratifiedIcp: RatifiedIcp;
  /**
   * The caller states, explicitly, that it accepts a search narrower than the
   * ICP. Required whenever any criterion did not become a filter.
   *
   * STRICTLY `true`. `undefined`, `false`, `'true'`, `1` and every other
   * truthy-looking value are refusals, because an acknowledgement that can be
   * produced by accident is not an acknowledgement.
   */
  readonly acknowledgeOmissions?: boolean;
}): IcpTranslationResult {
  const requestedOrg = String(input.organizationId ?? '').trim();
  const icp = input.ratifiedIcp;

  if (!requestedOrg) {
    return {
      ok: false,
      refusal: 'tenant_mismatch',
      detail: 'a discovery translation is never performed without a verified tenant',
      blocking: [],
    };
  }
  // TENANT FIRST, always. An ICP from another tenant is refused before a single
  // criterion is read, so no part of it can influence the outcome.
  if (String(icp?.organizationId ?? '').trim() !== requestedOrg) {
    return {
      ok: false,
      refusal: 'tenant_mismatch',
      detail: 'the ratified ICP belongs to a different tenant than this discovery request',
      blocking: [],
    };
  }

  const criteria = Array.isArray(icp?.criteria) ? icp.criteria : [];
  const filters: Record<string, unknown> = {};
  const translated: Array<{ criterionId: string; filterKey: string }> = [];
  const omitted: OmittedCriterion[] = [];
  const blocking: OmittedCriterion[] = [];
  /** Kept apart from `blocking` only so the refusal CODE can be precise. */
  const valueBlocked: OmittedCriterion[] = [];

  for (const c of criteria) {
    const subject = c?.subject;
    const attribute = typeof c?.attribute === 'string' ? c.attribute.trim() : '';
    const kind = c?.kind;

    if (subject !== 'account' && subject !== 'person') {
      return {
        ok: false,
        refusal: 'malformed_criterion',
        detail: `criterion ${String(c?.id)} names no valid subject`,
        blocking: [omission(c, 'the criterion has no valid subject')],
      };
    }
    if (!attribute || !kind || !VALID_KINDS.has(kind)) {
      return {
        ok: false,
        refusal: 'malformed_criterion',
        detail: `criterion ${String(c?.id)} is missing an attribute or a valid kind`,
        blocking: [omission(c, 'the criterion is missing an attribute or a valid kind')],
      };
    }

    // ── ONLY `mandatory` MAY BECOME A HARD FILTER ───────────────────────
    // A provider filter EXCLUDES. The ICP's soft criteria do not exclude —
    // they move a ratio (`evaluate.ts:246`). Translating one would convert a
    // scoring input into a hard exclusion and NARROW the search relative to
    // what the tenant actually asked for, which is the mirror image of the
    // broadening this module already refuses to do.
    //
    // They are recorded, never applied, and never silently dropped.
    if (!MATERIAL_KINDS.has(kind)) {
      omitted.push(omission(
        c,
        `${kind} criteria are scoring inputs, not discovery filters, so this criterion was NOT applied to the search`,
      ));
      continue;
    }

    const mapping = ICP_TO_DISCOVERY_FILTER[key(subject, attribute)];

    if (!mapping) {
      const note = UNMAPPED_ATTRIBUTE_NOTES[key(subject, attribute)]
        ?? 'no provider-neutral discovery filter expresses this attribute';
      // Only a MANDATORY criterion reaches here, and a mandatory criterion
      // that cannot be expressed always BLOCKS: it is the ICP's hard gate, and
      // a search that ignores it is a search for something else.
      blocking.push(omission(c, note));
      continue;
    }

    const predicate = c?.predicate as { op?: string; values?: unknown } | undefined;
    if (predicate?.op !== mapping.predicate) {
      const record = omission(
        c,
        `${attribute} can only be translated with the \`${mapping.predicate}\` predicate, not \`${String(predicate?.op)}\``,
      );
      // A predicate mismatch on a MAPPED attribute is always blocking,
      // regardless of kind: the attribute is expressible and the criterion
      // asked for something else, which is a request this cannot honestly fill.
      blocking.push(record);
      continue;
    }

    const values = cleanValues(predicate.values);
    if (values === null) {
      blocking.push(omission(c, `${attribute} supplied no usable values`));
      continue;
    }

    // THE CLOSED VALUE CONTRACT. Every value must be one the provider documents.
    //
    // The whole criterion is refused — the unsupported values are NOT filtered
    // out so the rest can proceed. `one_of` is disjunctive, so dropping an
    // alternative removes a way for a prospect to qualify and NARROWS the
    // search: the tenant would get results for a target they did not define,
    // and the ledger would record it as their ICP. This is the rule that keeps
    // `other` honest, since `other` has no provider counterpart at all.
    if (mapping.allowedValues) {
      const unsupported = values.filter((v) => !mapping.allowedValues!.includes(v.toLowerCase()));
      if (unsupported.length > 0) {
        valueBlocked.push(omission(
          c,
          `${attribute} carries ${unsupported.length} value(s) the provider does not document; `
          + 'the criterion is refused whole, because dropping an alternative would narrow the search',
        ));
        continue;
      }
    }

    // Union, not replace: §10 of the ICP contract is explicit that selected
    // titles form ONE union, so two title criteria widen the same filter rather
    // than the later one silently winning.
    const existing = Array.isArray(filters[mapping.filterKey])
      ? (filters[mapping.filterKey] as string[])
      : [];
    filters[mapping.filterKey] = [...new Set([...existing, ...values])];
    translated.push({ criterionId: String(c.id), filterKey: mapping.filterKey });
  }

  if (valueBlocked.length > 0) {
    return {
      ok: false,
      refusal: 'unsupported_criterion_value',
      detail: `${valueBlocked.length} criterion(s) carry a value outside the provider's documented vocabulary`,
      blocking: [...valueBlocked, ...blocking],
    };
  }

  if (blocking.length > 0) {
    const first = blocking[0];
    const refusal: IcpTranslationRefusal = first.reason.includes('predicate')
      ? 'unsupported_predicate'
      : 'unsupported_mandatory_criterion';
    return {
      ok: false,
      refusal,
      detail: `${blocking.length} criterion(s) cannot be expressed as a discovery filter without changing what the ICP targets`,
      blocking,
    };
  }

  // THE UNRESTRICTED-SEARCH GUARD. An empty filter object is "fetch everyone",
  // so it is never a successful translation of a target definition.
  if (translated.length === 0 || Object.keys(filters).length === 0) {
    return {
      ok: false,
      refusal: 'no_translatable_criteria',
      detail: 'no criterion could be translated, and an empty filter set would be an unrestricted search',
      blocking: omitted.length > 0 ? omitted : [],
    };
  }

  // THE ACKNOWLEDGEMENT GATE. Checked AFTER the unrestricted-search guard,
  // because "nothing could be translated" is the more fundamental answer and
  // acknowledging it would not make an empty filter set safe.
  //
  // Strict identity against `true`: anything else is a refusal. An
  // acknowledgement a caller can satisfy by passing a stray truthy value is not
  // informed consent to a narrower search.
  if (omitted.length > 0 && input.acknowledgeOmissions !== true) {
    return {
      ok: false,
      refusal: 'omissions_unacknowledged',
      detail: `${omitted.length} criterion(s) did not become discovery filters; the caller must acknowledge that this search is narrower than the ICP`,
      blocking: omitted,
    };
  }

  return {
    ok: true,
    filters: Object.freeze({ ...filters }),
    translated,
    omitted,
    omissionsAcknowledged: omitted.length > 0,
    icp: { icpId: String(icp.icpId), version: Number(icp.version) },
  };
}
