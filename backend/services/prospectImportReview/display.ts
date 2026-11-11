/**
 * What a REVIEWER sees of a held candidate. Pure.
 *
 * Projection, not passthrough: only the fields a person needs to decide
 * "import or skip" (name, title, company, location, profile link, and what the
 * match was ON). Contact data never reaches the review screen, whatever the
 * provider sent.
 *
 * HOMOGRAPH-SAFE (PI review refinement 2): the human here is the authority, so
 * a profile link is shown in a form where lookalikes cannot deceive: any
 * non-ASCII slug is shown percent-escaped, and a slug that mixes scripts
 * carries an explicit marker.
 */
import { classifyLinkedinProfile } from '../../../lib/linkedin/profileUrl';
import type { HoldReason } from './probe';

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Scripts present in a string (Latin, Cyrillic, Greek, Han, Arabic, other). */
function scriptsOf(s: string): Set<string> {
  const out = new Set<string>();
  for (const ch of s) {
    if (/\p{Script=Latin}/u.test(ch)) out.add('Latin');
    else if (/\p{Script=Cyrillic}/u.test(ch)) out.add('Cyrillic');
    else if (/\p{Script=Greek}/u.test(ch)) out.add('Greek');
    else if (/\p{Script=Han}/u.test(ch)) out.add('Han');
    else if (/\p{Script=Arabic}/u.test(ch)) out.add('Arabic');
    // The \p{L} guard is LOAD-BEARING: only LETTERS are classified, so digits,
    // hyphens and percent signs in an ordinary slug (jane-doe-123) never count
    // as a second script. Without it the mixed-script marker fires on every
    // slug and reviewers learn to ignore it (PI review, package 3).
    else if (/\p{L}/u.test(ch)) out.add('Other');
  }
  return out;
}

export interface DisplayLink {
  /** ASCII-only rendering: non-ASCII characters percent-escaped. */
  readonly shown: string;
  readonly mixedScript: boolean;
  readonly form: 'vanity' | 'opaque';
}

export function displayProfileLink(url: unknown): DisplayLink | null {
  const c = classifyLinkedinProfile(url);
  if (!c.key || c.form === 'refused') return null;
  let decoded = c.key;
  try { decoded = decodeURI(c.key); } catch { /* keep encoded */ }
  const slug = decoded.split('/').pop() ?? '';
  return {
    // encodeURI leaves ASCII alone and escapes everything else: the rendering
    // cannot contain a lookalike character.
    shown: encodeURI(decoded),
    mixedScript: scriptsOf(slug).size > 1,
    form: c.form,
  };
}

export interface CandidateView {
  readonly name: string | null;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly profile: DisplayLink | null;
  /** The basis of the hold, stated (review 10): what the match was ON. */
  readonly matchedOn: string;
}

const BASIS: Readonly<Record<HoldReason, string>> = Object.freeze({
  name_match: 'Same first and last name as an existing person. Nothing else agrees.',
  role_contact: 'Same shared mailbox (e.g. info@) as an existing person. A shared address does not say which person.',
  shared_phone: 'Same phone number as an existing person with a different name. It may be a switchboard.',
});

/** Project a held raw provider record (Apollo person shape) for review. */
export function candidateView(raw: Record<string, unknown> | null, reason: HoldReason): CandidateView {
  const r = raw ?? {};
  const org = (r.organization && typeof r.organization === 'object' ? r.organization : r.account) as
    Record<string, unknown> | undefined;
  const name = str(r.name) ?? ([str(r.first_name), str(r.last_name)].filter(Boolean).join(' ') || null);
  const location = [str(r.city), str(r.state), str(r.country)].filter(Boolean).join(', ') || null;
  return {
    name,
    title: str(r.title),
    company: org ? str(org.name) : null,
    location,
    profile: displayProfileLink(r.linkedin_url),
    matchedOn: BASIS[reason],
  };
}
