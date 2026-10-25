/**
 * Persuasive, purpose-driven copy — shared rules (owner request 2026-10-25).
 *
 * The confirmation page showed the brief's INSTRUCTION ("Create an engaging
 * promotion for our AI-Driven Digital Marketing System.") as the main message
 * AND as the headline, and a button cut mid-word ("Discover your marketing
 * clar"). Two rules follow:
 *
 *   1. An instruction is a TASK, not copy. A sentence that tells us what to make
 *      ("Create a post…", "I want an image…") is handed to the AI as the brief;
 *      it is never seeded verbatim into a headline / subheadline / button.
 *   2. A button is a short, goal-specific action that fits its slot whole. When
 *      the brief's call to action does not fit, a goal-appropriate one is used
 *      instead of a cut.
 *
 * Pure — no DB, no fetch, no window. Used by the client (seeding, chips, the
 * copy editor) and the server (field-assist prompt + deterministic fallback).
 */

const TASK_VERBS = 'create|make|design|write|generate|build|produce|develop|craft|promote|launch|draft|prepare|compose|put together|come up with';
const DETERMINERS = 'a|an|our|my|the|this|that|some|one|two|three|four|five|\\d+';
const ASSET_NOUNS = 'image|images|picture|post|posts|promotion|promo|campaign|asset|assets|carousel|carousels|infographic|infographics|graphic|graphics|banner|banners|ad|ads|advert|advertisement|creative|creatives|visual|visuals|flyer|poster|announcement|story|stories|reel|reels|video|slide|slides|deck|caption|thumbnail|teaser|mailer|newsletter';

/** "Create an engaging promotion for…", "Design a carousel about…", "Write the post…". */
const TASK_WITH_ASSET = new RegExp(
  `^(?:please\\s+|let['’]?s\\s+|can you\\s+|could you\\s+|help me\\s+|help us\\s+)?(?:${TASK_VERBS})\\s+(?:${DETERMINERS})\\b(?:\\s+[\\w'’&/-]+){0,6}?\\s+(?:${ASSET_NOUNS})\\b`,
  'i',
);
/** "Promote our new planner", "Showcase my bakery" — a task about OUR thing. */
const TASK_ABOUT_OURS = /^(?:please\s+)?(?:promote|advertise|announce|showcase|highlight|market|feature|introduce)\s+(?:our|my)\b/i;
/** "I want…", "We need…", "I'd like…", "Looking for…". */
const WANT = /^(?:i|we)\s*(?:want|need|would like|['’]d like|am looking|['’]m looking|are looking|['’]re looking)\b|^(?:looking for|need)\s+(?:a|an|some)\b/i;

/**
 * Whether a line is an INSTRUCTION to us (what to make) rather than copy for
 * the audience. Conservative: a benefit line addressed to the viewer ("Launch
 * your campaign in minutes", "Build a better pipeline") is copy, not a task.
 */
export function isInstructionLikeCopy(text: string | null | undefined): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^["“'‘]+/, '');
  if (!t) return false;
  return TASK_WITH_ASSET.test(t) || TASK_ABOUT_OURS.test(t) || WANT.test(t);
}

/**
 * The subject an instruction is about — "…promotion for our AI-Driven Digital
 * Marketing System." → "AI-Driven Digital Marketing System". Empty when none.
 */
export function instructionSubject(text: string | null | undefined): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!isInstructionLikeCopy(t)) return '';
  const m = t.match(/\b(?:for|about|on|of|promoting|showcasing|featuring|introducing|announcing|highlighting)\s+(?:(?:our|my|the|a|an|this)\s+)?(.+)$/i)
    ?? t.match(/^(?:please\s+)?(?:promote|advertise|announce|showcase|highlight|market|feature|introduce)\s+(?:our|my)\s+(.+)$/i);
  const subject = (m?.[1] ?? '').split(/(?<=[.!?])\s|[;—–]|,\s+(?:that|which|to|so)\b/u)[0] ?? '';
  return subject.replace(/[.!?,:;]+$/, '').trim();
}

/**
 * Goal-specific button text, from the goal / objective wording. Most specific
 * first (an "event" promotion asks for a seat, not "Get the offer").
 */
export function goalCtaSuggestions(objective: string | null | undefined): string[] {
  const o = String(objective ?? '').toLowerCase();
  if (!o.trim()) return [];
  if (/\b(event|webinar|workshop|conference|meetup|summit|livestream|register|registration|rsvp)\b/.test(o)) return ['Reserve your seat', 'Register now', 'Save your spot'];
  if (/\b(lead|leads|demo|sales|book|consult|consultation|pipeline|sign[- ]?ups?)\b/.test(o)) return ['Book a demo', 'Get a free consult', 'Talk to us'];
  if (/\b(launch|new product|release|introduc|announce)\w*/.test(o)) return ['Try it free', 'See what’s new', 'Get early access'];
  if (/\b(promot|offer|sale|discount|deal|coupon|shop|buy|purchase|conver)\w*|%/.test(o)) return ['Get the offer', 'Claim the offer', 'Shop now'];
  if (/\b(aware|brand|story|educat|explain|how-to|how to|process|guide|teach|insight|thought)\w*/.test(o)) return ['See how it works', 'Learn more', 'Read the guide'];
  return [];
}

/** A usable button line: 1–4 words, not a question, within `max`. */
export function isFittingCta(text: string | null | undefined, max?: number): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /\?$/.test(t)) return false;
  if (typeof max === 'number' && max > 0 && t.length > max) return false;
  const words = t.split(' ').length;
  return words >= 1 && words <= 4 && !isInstructionLikeCopy(t);
}

/** The first candidate that fits the button slot whole (never cut). */
export function pickFittingCta(candidates: ReadonlyArray<string | null | undefined>, max?: number): string {
  for (const c of candidates) {
    const t = String(c ?? '').replace(/\s+/g, ' ').trim();
    if (isFittingCta(t, max)) return t;
  }
  return '';
}
