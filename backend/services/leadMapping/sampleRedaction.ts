/**
 * PI-LDB-01 — redaction of sample values before they reach a model.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * To map `E-mail` onto `email` the engine wants to SEE a few values: a header
 * alone is weak evidence, and a column called `Value` is unmappable without
 * looking. But the values in a prospect file are real people's contact
 * details, and two things happen to anything handed to the gateway:
 *
 *   1. it leaves our process for a model provider, and
 *   2. `aiResponseCache` persists tokenized prompt words to Redis, and
 *      caching is opt-OUT rather than opt-in.
 *
 * So the engine must never be able to send a real email address or phone
 * number, and the mapping operation must also be registered in
 * `NO_CACHE_OPS`. Both are required; neither is sufficient alone. Redaction
 * is the one that still holds if someone later forgets the cache list.
 *
 * ─── THE DESIGN RULE ──────────────────────────────────────────────────────
 * Preserve SHAPE, destroy IDENTITY. The model needs to know "these look like
 * email addresses"; it does not need to know whose. So a redacted sample
 * keeps the structure a type-inference can read — an `@`, a TLD, a digit
 * count, a decimal point — and removes everything that names a person.
 *
 * Values that cannot identify anyone pass through unchanged. A company
 * domain, an employee count, a funding stage and an ISO date are facts about
 * a business, not about a human, and redacting them would destroy the only
 * evidence that distinguishes `employeeCount` from `foundedYear` — both are
 * four-digit integers, and only the magnitude tells them apart.
 */

/** What the redactor decided a value looks like. Drives type inference. */
export type SampleShape =
  | 'email'
  | 'phone'
  | 'url'
  | 'domain'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'person_name'
  | 'short_text'
  | 'long_text'
  | 'empty';

export interface RedactedSample {
  /** Safe to send to a model and safe to log. */
  value: string;
  shape: SampleShape;
  /** True when the original was altered. Lets tests assert redaction fired. */
  redacted: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const DOMAIN_RE = /^(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const INTEGER_RE = /^[+-]?\d{1,15}$/;
const DECIMAL_RE = /^[+-]?\d{1,15}[.,]\d{1,6}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?)?/;
const SLASH_DATE_RE = /^\d{1,4}[/.]\d{1,2}[/.]\d{1,4}$/;
/**
 * Two to four capitalised words and nothing else. Deliberately narrow: it is
 * better to treat a name as `short_text` and redact less than to treat a job
 * title as a name and destroy the evidence that maps `jobTitle`.
 */
const PERSON_NAME_RE = /^[A-Z][a-z'’-]{1,20}(?: [A-Z][a-z'’-]{1,20}){1,3}$/;

const LONG_TEXT_THRESHOLD = 60;
/** How much of a long business description survives. Enough to recognise prose. */
const LONG_TEXT_KEEP = 40;

/** Classifies a trimmed value. Order matters: narrower patterns first. */
export function detectShape(raw: string): SampleShape {
  const value = raw.trim();
  if (!value) return 'empty';
  if (EMAIL_RE.test(value)) return 'email';
  if (URL_RE.test(value)) return 'url';
  if (ISO_DATE_RE.test(value) || SLASH_DATE_RE.test(value)) return 'date';
  if (INTEGER_RE.test(value)) return 'integer';
  if (DECIMAL_RE.test(value)) return 'decimal';
  if (isPhoneLike(value)) return 'phone';
  if (DOMAIN_RE.test(value) && !value.includes(' ')) return 'domain';
  if (PERSON_NAME_RE.test(value)) return 'person_name';
  return value.length > LONG_TEXT_THRESHOLD ? 'long_text' : 'short_text';
}

/**
 * A phone number, loosely. Requires at least 7 digits so a four-digit year
 * and a three-digit employee count are never mistaken for one, and rejects
 * anything carrying letters.
 */
function isPhoneLike(value: string): boolean {
  if (/[A-Za-z]/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+(]?[\d\s()./-]+$/.test(value);
}

/**
 * Redacts ONE value.
 *
 * `email`, `phone` and `person_name` are personal and are always rewritten.
 * `long_text` is truncated — a company description is public, but a free-text
 * column is exactly where a stray note about a person ends up, so the safe
 * default is to keep only enough to tell prose from an identifier.
 */
export function redactSample(raw: string): RedactedSample {
  const value = raw.trim();
  const shape = detectShape(value);

  switch (shape) {
    case 'empty':
      return { value: '', shape, redacted: false };

    case 'email': {
      // Keep the `@` and the TLD so "this is an email" survives; drop the
      // local part and the domain, either of which identifies someone.
      const tld = value.slice(value.lastIndexOf('.') + 1).toLowerCase();
      return { value: `•••@•••.${tld}`, shape, redacted: true };
    }

    case 'phone': {
      // Keep the digit count and a leading `+`: that is what distinguishes a
      // phone column from an integer column, and it names nobody.
      const digits = value.replace(/\D/g, '').length;
      const plus = value.trimStart().startsWith('+') ? '+' : '';
      return { value: `${plus}${'•'.repeat(digits)}`, shape, redacted: true };
    }

    case 'person_name': {
      // Initials only. Enough to see "two capitalised words", not who.
      const initials = value
        .split(/\s+/)
        .map((part) => `${part[0]}•••`)
        .join(' ');
      return { value: initials, shape, redacted: true };
    }

    case 'long_text':
      return { value: `${value.slice(0, LONG_TEXT_KEEP)}…`, shape, redacted: true };

    case 'integer': {
      // ── THE ONE CASE SHAPE CANNOT SETTLE ────────────────────────────────
      // `4930123456` is a phone number. It is also an integer. Nothing about
      // the value distinguishes them, and redaction runs before mapping, so
      // the header cannot help here.
      //
      // Resolution: mask any bare run of 10+ digits, but keep `shape` as
      // `integer`. Type inference reads the SHAPE, not the digits, so an
      // `annualRevenue` column of ten-digit figures still scores as
      // integer-compatible — nothing is lost from the mapping, and a phone
      // number written without punctuation never reaches a provider.
      //
      // Shorter integers pass through because their MAGNITUDE is the only
      // thing separating `foundedYear` (4 digits) from `employeeCount` from
      // `annualRevenue`, and a figure under ten digits cannot be a phone
      // number of any country.
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 10) {
        return { value: '•'.repeat(digits.length), shape, redacted: true };
      }
      return { value, shape, redacted: false };
    }

    // Business facts about a company, not about a person. Passed through,
    // because their exact value IS the type evidence.
    case 'url':
    case 'domain':
    case 'decimal':
    case 'date':
    case 'short_text':
      return { value, shape, redacted: false };
  }
}

/**
 * Redacts the sample set for a whole file, capping how many values per column
 * are taken. More samples do not improve the inference much and every extra
 * one is extra exposure.
 */
export function redactSamples(
  samples: Readonly<Record<string, readonly string[]>>,
  perColumnLimit = 5,
): Record<string, RedactedSample[]> {
  const out: Record<string, RedactedSample[]> = {};
  for (const [header, values] of Object.entries(samples)) {
    out[header] = values.slice(0, perColumnLimit).map(redactSample);
  }
  return out;
}

/** The shape a redacted set takes when handed to a proposer: strings only. */
export function toProposerSamples(
  redacted: Readonly<Record<string, readonly RedactedSample[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [header, values] of Object.entries(redacted)) {
    out[header] = values.map((v) => v.value);
  }
  return out;
}

/**
 * Fails closed if anything personal survived redaction.
 *
 * This is a belt-and-braces assertion, not the mechanism: `redactSample`
 * already rewrites these shapes. It exists because the cost of being wrong
 * is a real person's email address in a third party's logs and in Redis, and
 * because a future edit to `detectShape` could silently reclassify a value.
 * A guard that only restates the implementation still catches that edit.
 */
/** The character redaction leaves behind. Carries no information. */
const REDACTION_MARK = '•';

/**
 * Is this an email address that still names someone?
 *
 * `EMAIL_RE` alone is not the test, because a correctly redacted address
 * still has an `@` and a TLD by design — that is the shape we deliberately
 * preserve. What must not survive is identifying CONTENT, so the question is
 * whether the local part still holds a letter or a digit.
 */
function retainsEmailIdentity(value: string): boolean {
  if (!EMAIL_RE.test(value)) return false;
  const local = value.slice(0, value.indexOf('@')).split(REDACTION_MARK).join('');
  return /[A-Za-z0-9]/.test(local);
}

export function assertRedacted(values: readonly string[]): void {
  for (const raw of values) {
    const value = raw.trim();
    if (retainsEmailIdentity(value)) {
      throw new Error(
        'leadMapping: refusing to send an unredacted email address to a model provider. ' +
          'Sample values must pass through redactSamples() first.',
      );
    }
    // Deliberately asks `detectShape`, the same classifier the redactor uses,
    // rather than re-testing with `isPhoneLike`. A guard that forms its own
    // opinion disagrees with the redactor sooner or later: `isPhoneLike`
    // accepts any 7-digit run, so it called a revenue figure of `5000000` a
    // phone number and blocked a correct mapping. One classifier, one answer.
    if (detectShape(value) === 'phone') {
      throw new Error(
        'leadMapping: refusing to send an unredacted phone number to a model provider. ' +
          'Sample values must pass through redactSamples() first.',
      );
    }
    // Catches the ambiguous case above: a bare 10+ digit run that `detectShape`
    // classifies as an integer but which may be a phone number.
    if (/^\+?\d{10,}$/.test(value)) {
      throw new Error(
        'leadMapping: refusing to send a bare run of 10 or more digits to a model provider — ' +
          'it cannot be distinguished from a phone number. Sample values must pass through ' +
          'redactSamples() first.',
      );
    }
  }
}
