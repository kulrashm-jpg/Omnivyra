/**
 * P0 — CONTACT GOVERNANCE TEMPORAL PRECISION. Owner-authorized, 2026-11-08.
 *
 * WHAT WAS WRONG. `isInForce` compared `effectiveFrom`/`effectiveUntil` against
 * `now` as RAW STRINGS, and in production the two sides never share a grammar:
 * PostgreSQL renders a `timestamptz` through `to_json` as `T`-separated with 1-6
 * fractional digits, trailing zeros TRIMMED (a whole second carries no fraction at
 * all), and an ALWAYS-EXPLICIT offset `±HH:MM` — never `Z`, not even at UTC, where
 * it emits `+00:00`. Callers pass `toISOString()`, which is always `Z` with exactly
 * 3 digits. Lexicographically `+`(0x2B) < `.`(0x2E) < `0`-`9` < `Z`(0x5A), so a DB
 * timestamp reads as EARLIER than it is — which expires a live restriction and
 * PERMITS contact. Under a non-UTC session TimeZone the error is HOURS wide, and
 * this repo pins TimeZone nowhere.
 *
 * WHY THESE FIXTURES ARE DB-FORMAT, AND WHY THIS SUITE EXISTS AT ALL. Every
 * pre-existing fixture in this repo is JS-format (`…000Z`), so every pre-existing
 * test compared JS against JS — the one case where the string comparison happens to
 * be a correct time comparison. The suite therefore validated a comparison that
 * NEVER OCCURS IN PRODUCTION. These fixtures inject the PostgreSQL rendering
 * directly as `GovernanceRecord` values, which is the only way to exercise the real
 * grammar: 19 of 64 real-schema suites and 436 of 2209 backend suites mock the very
 * seam that would carry it, and nothing anywhere feeds a production-format
 * timestamp to the evaluator. A test routed through a harness transport would be
 * testing the harness.
 *
 * AND THESE ASSERT THE PRODUCTION DECISION, not the parser. A test that only shows
 * the parser works is insufficient — `mayContact` is what decides whether a person
 * is contacted, so every temporal case below goes through `mayContact` and asserts
 * `decision`. `blocked` means the restriction was honoured; `allowed` is the
 * fail-open this P0 exists to close.
 *
 * EVERY CASE IS PAIRED WITH ITS NEGATIVE CONTROL: an assertion on the raw `>` / `<=`
 * showing that the OLD string comparison would have decided the opposite. Those
 * controls are what make this suite fail if anyone reverts to text comparison.
 */
import {
  mayContact,
  parseGovernanceInstantUs,
  type GovernanceRecord,
} from '../../services/prospectIdentity/contactGovernance';

const ORG = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

/** A live all-channel DNC, anchored on the person. In force ⇒ `blocked`. */
const rec = (over: Partial<GovernanceRecord> = {}): GovernanceRecord => ({
  id: 'g-1',
  organizationId: ORG,
  personId: PERSON,
  targetNormalized: null,
  channel: '*',
  governanceType: 'dnc_permanent',
  effectiveFrom: '2026-11-08T00:00:00+00:00',
  effectiveUntil: null,
  revokedAt: null,
  ...over,
});

const decide = (records: GovernanceRecord[], now: string) =>
  mayContact({ organizationId: ORG, personId: PERSON, channel: 'email', now, records });

/**
 * Two renderings must parse AND agree. Asserting `toBe` alone is VACUOUS when both
 * sides are null — a parser that rejected every DB-format timestamp would satisfy it,
 * and the paired `blocked` expectation would be satisfied too by failing closed. The
 * non-null assertions are what make these comparisons self-guarding.
 */
const sameInstant = (a: string, b: string): void => {
  const ua = parseGovernanceInstantUs(a);
  const ub = parseGovernanceInstantUs(b);
  expect(ua).not.toBeNull();
  expect(ub).not.toBeNull();
  expect(ua).toBe(ub);
};

/** The caller-side instant, in the JS grammar callers actually pass today. */
const NOW_JS = '2026-11-08T10:00:00.500Z';

describe('P0 — a non-UTC rendering must not expire a live restriction', () => {
  it('an in-force hold rendered +05:30 BLOCKS contact, where the string comparison said "not yet started"', () => {
    // 15:30+05:30 IS 10:00Z, so this took effect 500 ms before NOW_JS.
    const from = '2026-11-08T15:30:00+05:30';
    sameInstant(from, '2026-11-08T10:00:00+00:00');
    expect(decide([rec({ effectiveFrom: from })], NOW_JS).decision).toBe('blocked');
    // NEGATIVE CONTROL: the old comparison read it as future, i.e. PERMITTED.
    expect(from > NOW_JS).toBe(true);
  });

  it('an in-force hold rendered -05:00 BLOCKS contact, where the string comparison said "lapsed"', () => {
    // 07:00-05:00 IS 12:00Z — two hours in the FUTURE, so the hold is still live.
    const until = '2026-11-08T07:00:00-05:00';
    sameInstant(until, '2026-11-08T12:00:00+00:00');
    expect(decide([rec({ effectiveUntil: until })], NOW_JS).decision).toBe('blocked');
    // NEGATIVE CONTROL: the old comparison read it as already expired.
    expect(until <= NOW_JS).toBe(true);
  });

  it('a negative offset that shifts the DATE is still the same instant', () => {
    // 2026-11-07T21:15:49-05:00 IS 2026-11-08T02:15:49Z: the calendar day differs.
    sameInstant('2026-11-07T21:15:49-05:00', '2026-11-08T02:15:49+00:00');
    expect(decide([rec({ effectiveFrom: '2026-11-07T21:15:49-05:00' })], NOW_JS).decision).toBe('blocked');
  });

  it('a quarter-hour zone is handled, and lexical order disagrees with chronological order', () => {
    const from = '2026-11-08T15:45:00+05:45';                      // == 10:00:00Z
    sameInstant(from, '2026-11-08T10:00:00+00:00');
    expect(decide([rec({ effectiveFrom: from })], NOW_JS).decision).toBe('blocked');
    expect(from > NOW_JS).toBe(true);                               // lexical: later
    expect(parseGovernanceInstantUs(from)! < parseGovernanceInstantUs(NOW_JS)!).toBe(true); // real: earlier
  });
});

describe('P0 — microsecond precision decides real contact outcomes', () => {
  it('an until 456 us in the future BLOCKS: milliseconds would have expired it', () => {
    const until = '2026-11-08T10:00:00.123456+00:00';
    const now = '2026-11-08T10:00:00.123Z';                          // .123000
    expect(decide([rec({ effectiveUntil: until })], now).decision).toBe('blocked');
    expect(until <= now).toBe(true);                                 // NEGATIVE CONTROL
    // And a millisecond-resolution parse would collapse both to the same instant.
    expect(Date.parse(until)).toBe(Date.parse(now));
  });

  it('.123456 and .123100 are DISTINCT instants, where Date.parse makes them equal', () => {
    const a = '2026-11-08T10:00:00.123456+00:00';
    const b = '2026-11-08T10:00:00.123100+00:00';
    expect(parseGovernanceInstantUs(a)).not.toBe(parseGovernanceInstantUs(b));
    expect(Date.parse(a)).toBe(Date.parse(b));                       // the truncation, demonstrated
  });

  it('ONE MICROSECOND is observable at the END boundary, which is EXCLUSIVE', () => {
    const now = '2026-11-08T10:00:00.123456+00:00';
    // exactly equal ⇒ lapsed ⇒ allowed (ADR §11: in force while now < effective_until)
    expect(decide([rec({ effectiveUntil: now })], now).decision).toBe('allowed');
    // one microsecond later ⇒ still in force
    expect(decide([rec({ effectiveUntil: '2026-11-08T10:00:00.123457+00:00' })], now).decision).toBe('blocked');
  });

  it('ONE MICROSECOND is observable at the START boundary, which is INCLUSIVE', () => {
    const now = '2026-11-08T10:00:00.123456+00:00';
    // exactly equal ⇒ started ⇒ blocked
    expect(decide([rec({ effectiveFrom: now })], now).decision).toBe('blocked');
    // one microsecond later ⇒ not yet started ⇒ allowed
    expect(decide([rec({ effectiveFrom: '2026-11-08T10:00:00.123457+00:00' })], now).decision).toBe('allowed');
  });

  it('a WHOLE SECOND carries no fractional part at all, and is not a parse failure', () => {
    // This is the ordinary case: PostgreSQL trims trailing zeros entirely.
    sameInstant('2026-11-08T10:00:00+00:00', '2026-11-08T10:00:00.000Z');
    expect(decide([rec({ effectiveFrom: '2026-11-08T10:00:00+00:00' })], NOW_JS).decision).toBe('blocked');
  });

  it('a NON-UTC offset combined with a TRIMMED fraction - the commonest real shape outside UTC', () => {
    // Neither the offset nor the trimmed fraction was previously tested together, and
    // this is what PostgREST actually emits for a sub-second instant in a non-UTC session.
    sameInstant('2026-11-08T15:30:00.1234+05:30', '2026-11-08T10:00:00.123400Z');
    sameInstant('2026-11-08T15:45:00.000001+05:45', '2026-11-08T10:00:00.000001Z');
    sameInstant('2026-11-08T05:00:00.5-05:00', '2026-11-08T10:00:00.500Z');
    // and it decides correctly through mayContact, not just in the parser
    expect(decide([rec({ effectiveFrom: '2026-11-08T15:30:00.1234+05:30' })], NOW_JS).decision).toBe('blocked');
    expect('2026-11-08T15:30:00.1234+05:30' > NOW_JS).toBe(true);   // NEGATIVE CONTROL
  });

  it('trailing-zero trimming does not move the instant', () => {
    for (const [trimmed, full] of [
      ['2026-11-08T10:00:00.5+00:00', '2026-11-08T10:00:00.500000+00:00'],
      ['2026-11-08T10:00:00.12+00:00', '2026-11-08T10:00:00.120000+00:00'],
      ['2026-11-08T10:00:00.123+00:00', '2026-11-08T10:00:00.123000+00:00'],
    ]) {
      sameInstant(trimmed, full);
    }
  });
});

describe('P0 — uncertainty FAILS CLOSED, and in the right direction per guard', () => {
  it('an unparseable effectiveFrom does NOT become "not yet started"', () => {
    expect(decide([rec({ effectiveFrom: 'not a timestamp' })], NOW_JS).decision).toBe('blocked');
  });

  it('an unparseable effectiveUntil does NOT become "lapsed"', () => {
    expect(decide([rec({ effectiveUntil: 'not a timestamp' })], NOW_JS).decision).toBe('blocked');
  });

  it('an unparseable or missing `now` cannot authorize contact', () => {
    expect(decide([rec()], 'not a timestamp').decision).toBe('blocked');
    expect(decide([rec()], '').decision).toBe('blocked');
    expect(decide([rec()], undefined as unknown as string).decision).toBe('blocked');
  });

  it('the two formats that LOOK plausible and are not production forms also fail closed', () => {
    // `::text` renders a SPACE separator; PostgREST never emits this.
    expect(decide([rec({ effectiveFrom: '2026-11-08 10:00:00+00:00' })], NOW_JS).decision).toBe('blocked');
    // node-postgres hands back a Date; String(Date) is lexicographic garbage.
    expect(decide([rec({ effectiveFrom: String(new Date('2026-11-08T00:00:00Z')) })], NOW_JS).decision).toBe('blocked');
  });

  it('malformed, out-of-range and over-precise values are rejected by the parser', () => {
    for (const bad of [
      '', '2026-13-01T10:00:00Z', '2026-02-30T10:00:00Z', '2026-11-08T25:00:00Z',
      '2026-11-08T10:00:00', '2026-11-08T10:00:00+99:00', '2026-11-08T10:00:00.1234567Z',
      // A :60 MINUTE or SECOND rolls over WITHIN the same date, so the calendar
      // round-trip cannot see it — only the explicit range guard rejects these. Without
      // them a mutant that deletes that guard passes the whole suite (measured).
      '2026-11-08T10:00:60Z', '2026-11-08T10:60:00Z', '2026-11-08T10:00:60+00:00',
      'Sun Nov 08 2026 10:00:00 GMT+0000', null, undefined, 42, {},
    ]) {
      expect(parseGovernanceInstantUs(bad)).toBeNull();
    }
  });

  it('an UNSAFE integer result is rejected rather than silently rounded', () => {
    // Today's instants are far inside the safe range: ~1.78e15 us against
    // MAX_SAFE_INTEGER 9.007e15, which runs out around the year 2255.
    const us = parseGovernanceInstantUs('2026-11-08T10:00:00.123456+00:00');
    expect(Number.isSafeInteger(us)).toBe(true);
    expect(parseGovernanceInstantUs('2200-01-01T00:00:00+00:00')).not.toBeNull();
    // Beyond it, epoch microseconds stop being exactly representable — year 9999 is
    // 2.53e17 us — so the guard REJECTS rather than comparing a rounded value. This
    // is the one case where failing closed on a well-formed timestamp is correct:
    // an inexact instant must not be allowed to decide a suppression.
    expect(parseGovernanceInstantUs('9999-12-31T23:59:59.999999+00:00')).toBeNull();
    // And it fails closed through the real decision, not just the parser.
    expect(decide([rec({ effectiveFrom: '9999-12-31T23:59:59.999999+00:00' })], NOW_JS).decision)
      .toBe('blocked');
  });
});

describe('P0 — every unrelated governance rule is preserved', () => {
  it('revokedAt stays a NULL CHECK and is never compared temporally', () => {
    // A FUTURE revocation instant must still mean "not in force". Comparing it
    // against `now` would make this read as still-in-force — a behaviour change in
    // the dangerous direction.
    expect(decide([rec({ revokedAt: '2099-01-01T00:00:00+00:00' })], NOW_JS).decision).toBe('allowed');
    // And it short-circuits before parsing, so even a garbage timestamp is inert.
    expect(decide([rec({ revokedAt: 'garbage', effectiveFrom: 'garbage' })], NOW_JS).decision).toBe('allowed');
  });

  it('an UNDATED restriction never lapses', () => {
    expect(decide([rec({ effectiveFrom: '2020-01-01T00:00:00+00:00', effectiveUntil: null })], NOW_JS).decision)
      .toBe('blocked');
  });

  it('an empty record set is allowed without any instant being needed', () => {
    // `mayContact` never reads `now` when there are no records, which is what makes
    // the loader's absent-instant case provably inert.
    expect(decide([], 'not a timestamp').decision).toBe('allowed');
  });

  it('tenant isolation and channel scoping are untouched by the temporal change', () => {
    const other = '33333333-3333-4333-8333-333333333333';
    expect(decide([rec({ organizationId: other })], NOW_JS).decision).toBe('allowed');
    expect(decide([rec({ channel: 'whatsapp', governanceType: 'dnc_channel' })], NOW_JS).decision).toBe('allowed');
  });

  it('a genuinely future restriction is still correctly NOT in force', () => {
    // The fix must not over-suppress: this is the case a blanket tolerance breaks.
    expect(decide([rec({ effectiveFrom: '2027-01-01T00:00:00+00:00' })], NOW_JS).decision).toBe('allowed');
  });

  it('a genuinely lapsed restriction is still correctly NOT in force', () => {
    expect(decide([rec({
      effectiveFrom: '2020-01-01T00:00:00+00:00',
      effectiveUntil: '2020-02-01T00:00:00+00:00',
    })], NOW_JS).decision).toBe('allowed');
  });
});
