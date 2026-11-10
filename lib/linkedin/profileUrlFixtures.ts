/**
 * The SHARED fixture table for `profileUrl.ts`. Both Prospect Intelligence and
 * Outreach's extension run every row, so the two sides cannot drift. Adding a
 * case here adds it to both suites. Fabricated inputs only; no real profile.
 */
import type { LinkedinSlugForm } from './profileUrl';

const JANE = 'https://www.linkedin.com/in/jane-doe';
export const OPAQUE_IN_FIXTURE = 'ACoAAA1b2C3d4E5f6G7h8I9j0KlMnOpQrStU';
export const OPAQUE_SN_FIXTURE = 'ACwAAAbcDEF123ghiJKL456mnoPQR789stu';

/** `normalizeLinkedinUrl(input, space)` must return `want`. */
export const NORMALIZE_FIXTURES: ReadonlyArray<{ input: string; space?: '/in/' | '/company/' | string; want: string | null; why: string }> = [
  // one profile, one key
  { input: 'https://www.linkedin.com/in/jane-doe', want: JANE, why: 'canonical' },
  { input: 'https://www.linkedin.com/in/jane-doe/', want: JANE, why: 'trailing slash' },
  { input: 'https://www.linkedin.com/in/Jane-Doe', want: JANE, why: 'case' },
  { input: 'http://linkedin.com/in/jane-doe', want: JANE, why: 'http, bare host' },
  { input: 'https://de.linkedin.com/in/jane-doe', want: JANE, why: 'locale subdomain' },
  { input: 'https://in.linkedin.com/in/jane-doe?originalSubdomain=in', want: JANE, why: 'regional host + param' },
  { input: 'https://www.linkedin.com/in/jane-doe?trk=public_profile&miniProfileUrn=x#about', want: JANE, why: 'tracking params + fragment' },
  { input: 'https://www.linkedin.com/in/jane-doe/details/experience/', want: JANE, why: 'extra path segments' },
  { input: '  https://www.linkedin.com/in/jane-doe  ', want: JANE, why: 'surrounding whitespace' },
  { input: 'https://www.linkedin.com/company/Acme/', space: '/company/', want: 'https://www.linkedin.com/company/acme', why: 'company space' },
  // must be NULL
  { input: 'https://www.linkedin.com.evil.com/in/jane', want: null, why: 'suffix-lookalike host' },
  { input: 'https://evil.com/@www.linkedin.com/in/jane', want: null, why: 'host is evil.com' },
  { input: 'https://user:pass@linkedin.com/in/jane', want: null, why: 'credentials' },
  { input: 'https://user@linkedin.com/in/jane', want: null, why: 'username' },
  { input: 'javascript:alert(1)//linkedin.com/in/jane', want: null, why: 'javascript scheme' },
  { input: 'data:text/html,linkedin.com/in/jane', want: null, why: 'data scheme' },
  { input: '//linkedin.com/in/jane', want: null, why: 'protocol-relative' },
  { input: 'ftp://linkedin.com/in/jane', want: null, why: 'ftp scheme' },
  { input: 'https://www.linkedin.com/in/../company/x', want: null, why: 'dot-segment' },
  { input: 'https://www.linkedin.com/in/%2e%2e/company/x', want: null, why: 'encoded dot-segment' },
  { input: 'https://www.linkedin.com/in/%252e%252e', want: null, why: 'double-encoded dot-segment' },
  { input: 'https://www.linkedin.com/in/jane-doe?ref=a..b', want: JANE, why: 'dots in the discarded query do not refuse' },
  { input: 'https://www.linkedin.com/in/jane-doe#a..b', want: JANE, why: 'dots in the discarded fragment do not refuse' },
  { input: 'https://linkedin.com./in/jane', want: null, why: 'trailing FQDN dot' },
  { input: 'https://www.linkedin.com/sales/lead/ACwAAA1,NAME_SEARCH,tok', want: null, why: 'Sales Navigator app URL' },
  { input: 'https://www.linkedin.com/pub/jane-doe/1/2/3', want: null, why: 'legacy /pub/' },
  { input: 'https://www.linkedin.com/company/acme', want: null, why: 'company URL in the /in/ space' },
  { input: 'https://www.linkedin.com/in/jane-doe', space: '/company/', want: null, why: 'profile URL in the /company/ space' },
  { input: 'https://www.linkedin.com/in/jane-doe', space: '/sales/', want: null, why: 'unknown space' },
  { input: 'https://www.linkedin.com/in/', want: null, why: 'empty slug' },
  { input: 'https://www.linkedin.com/in/jane doe', want: null, why: 'space in slug' },
  { input: 'https://www.linkedin.com/in/ja​ne', want: null, why: 'U+200B zero-width space (Cf)' },
  { input: 'https://www.linkedin.com/in/ja‮ne', want: null, why: 'U+202E bidi override (Cf)' },
  { input: 'https://www.linkedin.com/in/ja‍ne', want: null, why: 'U+200D zero-width joiner (Cf)' },
  { input: 'https://www.linkedin.com/in/﻿jane', want: null, why: 'U+FEFF BOM (Cf)' },
  { input: 'https://www.linkedin.com/in/ja⁦ne', want: null, why: 'U+2066 bidi isolate (Cf)' },
  { input: 'https://www.linkedin.com/in/ja­ne', want: null, why: 'U+00AD soft hyphen (Cf)' },
  { input: 'https://www.linkedin.com/in/ja%E2%80%8Bne', want: null, why: 'percent-encoded U+200B' },
  { input: 'not a url', want: null, why: 'not a URL' },
  { input: '', want: null, why: 'empty' },
];

/** Pairs that must normalise to the SAME key, and pairs that must NOT. */
export const EQUIVALENCE_FIXTURES: ReadonlyArray<{ a: string; b: string; same: boolean; why: string }> = [
  { a: 'https://www.linkedin.com/in/jöhn', b: 'https://www.linkedin.com/in/j%C3%B6hn', same: true, why: 'raw unicode == percent-encoded' },
  { a: 'https://www.linkedin.com/in/jöhn', b: 'https://www.linkedin.com/in/john', same: false, why: 'diacritic is a different slug' },
  { a: 'https://www.linkedin.com/in/јane', b: 'https://www.linkedin.com/in/jane', same: false, why: 'Cyrillic lookalike stays distinct (no ASCII restriction)' },
  { a: 'https://www.linkedin.com/in/jane-doe-1', b: 'https://www.linkedin.com/in/jane-doe', same: false, why: 'different slugs' },
];

/** `classifyLinkedinProfile(input)` must return `form` (and `key` when given). */
export const CLASSIFY_FIXTURES: ReadonlyArray<{ input: string | null; form: LinkedinSlugForm; key?: string | null; why: string }> = [
  { input: 'https://www.linkedin.com/in/Jane-Doe/', form: 'vanity', key: JANE, why: 'vanity, folded key' },
  { input: 'https://www.linkedin.com/in/张伟', form: 'vanity', why: 'CJK vanity kept' },
  { input: `https://www.linkedin.com/in/${OPAQUE_IN_FIXTURE}?trk=x`, form: 'opaque', key: `https://www.linkedin.com/in/${OPAQUE_IN_FIXTURE}`, why: 'ACoAA id keeps its case' },
  { input: `https://www.linkedin.com/in/${OPAQUE_SN_FIXTURE}`, form: 'opaque', key: `https://www.linkedin.com/in/${OPAQUE_SN_FIXTURE}`, why: 'ACwAA id keeps its case' },
  { input: 'https://www.linkedin.com/in/acoaa-the-band', form: 'vanity', why: 'name that starts like an id' },
  { input: 'https://www.linkedin.com/in/ACoAA', form: 'vanity', why: 'too short to be an id' },
  { input: 'https://www.linkedin.com/in/jane-doe-ACoAA12345678901234567890', form: 'vanity', why: 'id-like text inside a vanity slug' },
  { input: 'https://www.linkedin.com/in/acoaaa1b2c3d4e5f6g7h8i9j0klmnopqrstu', form: 'vanity', why: 'all lower case: ambiguous, defaults to vanity' },
  { input: 'https://www.linkedin.com/sales/lead/ACwAAA1,NAME_SEARCH,tok', form: 'refused', key: null, why: 'Sales Navigator app URL' },
  { input: 'https://evil.com/in/jane', form: 'refused', key: null, why: 'not LinkedIn' },
  { input: '', form: 'refused', key: null, why: 'empty' },
  { input: null, form: 'refused', key: null, why: 'absent' },
];
