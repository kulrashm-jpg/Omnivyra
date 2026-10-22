// R28 (CPG_U1_PROTOCOL_004 §3) identity/authority validation, and the DR-12 normalisation of the
// UNASSIGNED sentinel. DEEPTECH-PARALLEL-013.
//
// WHAT THE FROZEN PROTOCOL MANDATES ABOUT IDENTIFIER SHAPE: nothing. §5.5.1 requires only that an
// accountable identity and a persistent identifier "(type and value recorded)" exist and that the
// tooling refuse while either is UNASSIGNED (exit 4). The protocol names no PID type, no syntax, no
// checksum and no registry resolution for any type. Every PID type therefore falls in the SECOND
// branch of §3 ("where no PID type-specific syntax is defined, require an explicit authoritative
// value rather than claiming syntactic validation proves identity"), so this module deliberately
// contains NO ORCID/ROR/DOI regex and no universal identifier regex. Inventing one here would be
// the exact error §3 forbids: dressing a shape check up as proof of identity.
//
// THE INVARIANT: "not obviously synthetic" is NOT "authoritative". Local screening can never PROMOTE:
// no screen, and no number of passed screens, raises a value above PLAUSIBLE_BUT_UNVERIFIED. Only a
// separately supplied attestation can. A value that survives every screen is PLAUSIBLE_BUT_UNVERIFIED —
// a distinct class from VALID_AUTHORITATIVE, and the verifier says so in its output.
//
// WHAT THE INVARIANT DOES *NOT* SAY (F4, the demotion-only contradiction). Earlier wording here read
// "local screening can only ever DEMOTE a value", which a reader could take as a promise that a screen
// never refuses a record. It does. lib/registration.mjs routes each class to a definite consequence, and
// this module is where that contract belongs, because a caller cannot infer it from a verdict alone:
//   EMPTY, RESERVED_UNASSIGNED       -> a named human prerequisite: `blockers`, exit 4, discharged by
//                                       supplying the value (appealable);
//   MALFORMED_*                      -> a record error: `errors`, exit 1. What the value identifies
//                                       cannot be read, so there is nothing to resolve;
//   PLACEHOLDER_TOKEN, ZERO_PATTERN  -> a record error: `errors`, exit 1. Wave-013 section 3 requires
//                                       these rejected; the record asserts an identity that the token
//                                       itself says does not exist;
//   SYNTHETIC_MARKER (this instrument's own marker) -> NOT a universal refusal: governed by
//                                       `--allow-synthetic`, refused only outside test mode;
//   PLAUSIBLE_BUT_UNVERIFIED, VALID_AUTHORITATIVE -> accepted, and reported with their class.
// F4 resolution: the CONTRACT was corrected here, not the wiring. Each disposition above is individually
// right — an unreadable identity is a defective record, an unsupplied one is a prerequisite — and the
// owner's ruling is to KEEP rejecting the tokens Wave-013 section 3 names, so re-routing those to exit 4
// would change a disposition the ruling preserves. What was dishonest was the prose. The dispositions
// above are now pinned by assertions in test/selftest.mjs ("F4 disposition"), so the contract and the
// wiring cannot drift apart silently again.
//
// WHAT "REQUIRE AN EXPLICIT AUTHORITATIVE VALUE" MEANS MECHANICALLY: a value reaches
// VALID_AUTHORITATIVE only when an attestation supplied SEPARATELY FROM THE RECORD UNDER CHECK binds
// that exact value to a named issuing authority, a named resolver, a stated method and an ISO-8601
// UTC instant. The binding is on the exact value, so an attestation cannot be moved onto another
// value. An attestation carried inside the registration record is self-assertion — the same defect
// R15 fixes for the provider-configuration hash — and is refused by the caller.

export const UNASSIGNED = 'UNASSIGNED';
export const ATTESTATION_SCHEMA = 'cpg-u1-identity-attestation/v1';

/** The six classes §3 requires the verifier to distinguish. */
export const IDENTITY_CLASS = Object.freeze({
  EMPTY: 'EMPTY',
  RESERVED: 'RESERVED_UNASSIGNED',
  SYNTHETIC: 'SYNTHETIC_PLACEHOLDER',
  MALFORMED: 'MALFORMED',
  PLAUSIBLE: 'PLAUSIBLE_BUT_UNVERIFIED',
  AUTHORITATIVE: 'VALID_AUTHORITATIVE',
});

// ── DR-12: normalisation of the reserved sentinel ────────────────────────────
// The resolved rule: trim surrounding whitespace; compare the sentinel case-insensitively; empty or
// whitespace-only stays unassigned; an INTERNAL space ("UN ASSIGNED") stays ASSIGNED, because the
// protocol does not define it as the sentinel and the owner resolved it that way; legitimate values
// stay assigned. Whitespace is removed only from the ENDS — never from the middle.

/** DR-12 clause 1: every sentinel and emptiness comparison is made on the trimmed value. */
export const trimmedFor = (v) => (typeof v === 'string' ? v.trim() : '');
/** DR-12 clause 2: the reserved sentinel is matched case-insensitively (and trimmed, never squashed). */
export const isReservedSentinel = (v) => trimmedFor(v).toUpperCase() === UNASSIGNED;
/** DR-12 clause 3: empty or whitespace-only is unassigned. */
export const isEmptyValue = (v) => trimmedFor(v) === '';
/** DR-12: assigned = a string, non-empty after trimming, and not the reserved sentinel. */
export const assignedValue = (v) => typeof v === 'string' && !isEmptyValue(v) && !isReservedSentinel(v);

// ── R28: local screens. Each one can only refuse; none can confer authority. ──

// The instrument's OWN fixture marker (lib/bitcoin.mjs, lib/schema.mjs). It is the only marker a caller
// may tolerate, and then only in explicit test mode (`allowSynthetic`), which is why it carries its own code.
const TEST_FIXTURE_MARKER = 'SYNTHETIC';
//
// F4 — WHICH TOKENS MAY BE HARD-REFUSED, AND WHY `TBD` IS AND `Test` IS NOT.
// A hard refusal is a claim about the WORLD: "no identity can be this string." Only a written rule can
// support such a claim, so the only tokens refused here are the ones a governing document explicitly
// defines as unauthorised or reserved. There are exactly four such rules, and they are this whole list:
//   UNASSIGNED    — CPG_U1_PROTOCOL_004 section 5.5.1 defines it as the reserved not-yet-supplied value
//                   and requires the tooling to refuse while an identity holds it; it is also one of the
//                   tooling's own PROTOCOL_MARKERS. Handled above as the sentinel, not as a token.
//   TBD           — Wave-013 section 3, explicitly.
//   PLACEHOLDER   — Wave-013 section 3, explicitly.
//   zero pattern  — Wave-013 section 3, explicitly (`isZeroPattern`, below).
// Everything else that used to sit in these lists was an ORDINARY LEXICAL COLLISION dressed up as a rule.
// `NA` is a legitimate abbreviation and name fragment; `None` and `Test` are real surnames and real
// organisation names; `Mock` is a real surname. No document forbids any of them, so refusing them
// asserted something this instrument cannot know. Worse, the marker list matched as a SUBSTRING, so
// `MOCK` refused "Mocksville Chamber of Commerce" and `FAKE` refused "Fakenham Medical Practice": real
// organisations rejected for containing four letters of an unrelated word.
// This change does NOT make those values authoritative. They are simply not refused HERE, and continue
// through the existing identity-resolution and admissibility logic, where an unattested value is
// classified PLAUSIBLE_BUT_UNVERIFIED and says so. The distinction is refusal versus resolution:
//   TBD   -> refused, because a document says that string is not an identity;
//   Test  -> not refused, because no document says so. It is resolved, or left explicitly unverified,
//            like any other value. "It looks like a placeholder to me" is not a finding this module may
//            make, and a substring of a longer name is not a finding at all.
const PLACEHOLDER_TOKENS = Object.freeze(['TBD', 'PLACEHOLDER']);
// C0/C1 controls plus the Unicode Cf/ZW set: bytes that render as nothing never identify anyone, and
// a bidi override can make two different strings look identical to a human reader. Written as numeric
// code-point ranges so this source file contains no raw control or zero-width byte of its own.
//
// F4 — U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER ARE EXCLUDED. The single range
// [200b, 200f] swallowed both. Neither is decoration. ZWNJ is ORTHOGRAPHICALLY REQUIRED in Persian and
// other Arabic-script languages, where it is what stops two letters joining into a different word, and
// both ZWNJ and ZWJ are required in Indic scripts to select conjunct versus half-form spellings. A name
// carrying one is correctly spelled, so classifying it MALFORMED — with no override anywhere — refused
// legitimate identities outright. 200b (zero-width SPACE) and 200e/200f (LRM/RLM) stay refused: those
// carry no orthographic meaning inside a name and are exactly the confusable-injection characters this
// screen exists for. Hence two ranges, [200b, 200b] and [200e, 200f], in place of one. Nothing else
// changes: C0/C1, 00ad SOFT HYPHEN, 061c ARABIC LETTER MARK, 180e, 202a-202e bidi overrides, 2060-2064,
// 206a-206f, feff BOM and fff9-fffb interlinear annotation are all still refused.
const INVISIBLE_RANGES = Object.freeze([[0x0000, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c],
  [0x180e, 0x180e], [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x206a, 0x206f],
  [0xfeff, 0xfeff], [0xfff9, 0xfffb]]);
/** True when the value carries any control, zero-width, soft-hyphen or bidi-override code point. */
export const hasInvisibleCharacter = (v) => [...String(v)].some((ch) => { const c = ch.codePointAt(0); return INVISIBLE_RANGES.some(([a, b]) => c >= a && c <= b); });
// The instrument joins hashed and logged fields with "|" (seed derivation, commitment digest,
// registration_id). A value containing it is ambiguous under those constructions.
const DELIMITER = '|';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// Separators an identifier may carry between its groups. Stripped ONLY to test the zero pattern.
const GROUP_SEPARATORS = /[\s\-_.:/\\()[\]]/g;

const verdict = (cls, code, message, marker = null) => ({ class: cls, code, message, marker });

/** A zero-pattern identifier: after group separators are removed, nothing is left but 0 / X placeholders. */
export const isZeroPattern = (v) => {
  const core = String(v).replace(GROUP_SEPARATORS, '');
  return core.length > 0 && /^[0Xx]+$/.test(core) && core.includes('0');
};

const squash = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Every local screen, in order. Returns a refusing verdict, or null when nothing local refuses the
 * value — which means only "nothing here refuses it", never "it is real".
 */
export function screenIdentityValue(raw) {
  if (typeof raw !== 'string') return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_NOT_A_STRING', `value is ${raw === null ? 'null' : typeof raw}, not a string`);
  if (isEmptyValue(raw)) return verdict(IDENTITY_CLASS.EMPTY, 'EMPTY', 'value is empty or whitespace only');
  if (isReservedSentinel(raw)) return verdict(IDENTITY_CLASS.RESERVED, 'RESERVED_UNASSIGNED', `value is the reserved ${UNASSIGNED} sentinel (compared trimmed and case-insensitively, DR-12)`);
  if (hasInvisibleCharacter(raw)) return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_INVISIBLE_CHARACTER', 'value contains a control, zero-width or bidi character, so what it identifies cannot be read');
  if (raw !== raw.trim()) return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_SURROUNDING_WHITESPACE', 'value carries surrounding whitespace; an identity is not silently canonicalised');
  if (raw.includes(DELIMITER)) return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_DELIMITER', `value contains "${DELIMITER}", the instrument's field separator in hashed and logged constructions`);
  if (raw.toUpperCase().includes(TEST_FIXTURE_MARKER)) return verdict(IDENTITY_CLASS.SYNTHETIC, 'SYNTHETIC_MARKER', `value carries the instrument's test-fixture marker ${TEST_FIXTURE_MARKER}`, TEST_FIXTURE_MARKER);
  // F4: a foreign-marker screen (FIXTURE/MOCK/FAKE/SPECIMEN/DONOTUSE/SAMPLEDATA/LOREMIPSUM) stood here and
  // matched as a SUBSTRING. It is gone: no document defines those words as forbidden identity tokens, and
  // as substrings they refused real organisations ("Mocksville...", "Fakenham..."). See the note above.
  if (PLACEHOLDER_TOKENS.includes(squash(raw))) return verdict(IDENTITY_CLASS.SYNTHETIC, 'PLACEHOLDER_TOKEN', `value is the reserved placeholder ${squash(raw)}, not an identity`, squash(raw));
  if (isZeroPattern(raw)) return verdict(IDENTITY_CLASS.SYNTHETIC, 'ZERO_PATTERN', 'value is a zero-pattern placeholder identifier (only 0/X once group separators are removed)', 'ZERO_PATTERN');
  return null;
}

// F4 — ATTESTATION FIELDS ARE SCREENED BY KIND, BECAUSE THEY ARE NOT ALL IDENTIFIERS.
// `authority` and `resolved_by` NAME the issuing authority and the person who resolved the value: each
// identifies something, so each keeps the full identifier screen and a placeholder there still cannot
// confer authority. `method` is FREE PROSE — a sentence describing how the resolution was performed.
// Identifier-screening prose is a category error, and it had a concrete cost: the truthful method
// "ROR REST API v2 lookup; no mock or specimen records used" was refused for containing the word "mock",
// so the honest answer was rejected and the incentive was to write a vaguer one. Prose is screened only
// for what prose must be in order to be readable and unambiguous: a non-empty string, not the reserved
// sentinel, and free of control / zero-width / bidi characters. It is NOT token-screened: inside a
// sentence, "mock" is a word. Any future prose-valued attestation field belongs in ATTESTATION_PROSE_FIELDS.
const ATTESTATION_IDENTIFIER_FIELDS = Object.freeze(['authority', 'resolved_by']);
const ATTESTATION_PROSE_FIELDS = Object.freeze(['method']);

/** The prose screen: readability and unambiguity only — never token, marker or shape matching. */
export function screenProseValue(text) {
  if (typeof text !== 'string') return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_NOT_A_STRING', `prose value is ${text === null ? 'null' : typeof text}, not a string`);
  if (isEmptyValue(text)) return verdict(IDENTITY_CLASS.EMPTY, 'EMPTY', 'prose value is empty or whitespace only');
  if (isReservedSentinel(text)) return verdict(IDENTITY_CLASS.RESERVED, 'RESERVED_UNASSIGNED', `prose value is the reserved ${UNASSIGNED} sentinel (compared trimmed and case-insensitively, DR-12)`);
  if (hasInvisibleCharacter(text)) return verdict(IDENTITY_CLASS.MALFORMED, 'MALFORMED_INVISIBLE_CHARACTER', 'prose value contains a control, zero-width or bidi character, so what it states cannot be read');
  return null;
}

/**
 * What an explicit authoritative value requires. The attestation must bind THIS exact value, name the
 * authority that issued or resolved it, name who resolved it, state the method, and carry a UTC instant.
 * Each named field is itself screened — BY ITS KIND (see above) — so a placeholder authority cannot
 * confer authority, and a truthful method sentence is not refused for the words it happens to contain.
 */
export function attestationErrors(att, value) {
  if (!att || typeof att !== 'object' || Array.isArray(att)) return ['attestation is absent or is not an object'];
  const e = [];
  if (att.schema !== ATTESTATION_SCHEMA) e.push(`attestation.schema must be ${ATTESTATION_SCHEMA}`);
  if (att.resolved_value !== value) e.push('attestation.resolved_value is not the value under check — an attestation binds exactly one value and is not transferable');
  const screened = [
    ...ATTESTATION_IDENTIFIER_FIELDS.map((k) => [k, screenIdentityValue(att[k])]),
    ...ATTESTATION_PROSE_FIELDS.map((k) => [k, screenProseValue(att[k])]),
  ];
  for (const [k, bad] of screened) {
    if (bad) e.push(`attestation.${k} is not an explicit value (${bad.code})`);
  }
  if (!ISO_UTC.test(att.resolved_at ?? '')) e.push('attestation.resolved_at must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ');
  return e;
}

/**
 * The §3 classification of one identity value. `attestation` MUST come from outside the record being
 * checked; passing one read off that record reproduces the defect R15 fixes.
 */
export function classifyIdentityValue(raw, { attestation = null } = {}) {
  const refused = screenIdentityValue(raw);
  if (refused) return refused;
  if (attestation === null || attestation === undefined) {
    return verdict(IDENTITY_CLASS.PLAUSIBLE, 'NO_AUTHORITY_ATTESTATION',
      'no separate authority attestation was supplied. The protocol defines no syntax or checksum for any persistent-identifier type (§5.5.1), so nothing local establishes that this value identifies anyone');
  }
  const errs = attestationErrors(attestation, raw);
  if (errs.length) return verdict(IDENTITY_CLASS.PLAUSIBLE, 'ATTESTATION_INSUFFICIENT', errs.join('; '));
  return verdict(IDENTITY_CLASS.AUTHORITATIVE, 'ATTESTED', `resolved against ${attestation.authority} by ${attestation.resolved_by} at ${attestation.resolved_at} (${attestation.method})`);
}

/** True only for the class §3 lets a verifier call established. Nothing else may be reported as authority. */
export const isAuthoritative = (c) => c?.class === IDENTITY_CLASS.AUTHORITATIVE;
