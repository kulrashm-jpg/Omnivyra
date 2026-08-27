/**
 * Guided creative direction — the user's own creative choices, in their words.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The Creator already decides everything about how an image looks: a ten-profile
 * director engine picks realism, framing, lighting and whether a person or a
 * product is central, and a forty-nine entry style registry describes how a
 * finished creative should feel. None of it was reachable. A user who wanted a
 * graffiti treatment, or explicitly wanted NO person in the frame, had no way to
 * say so — the system inferred an answer from keywords in their brief and never
 * showed them what it decided.
 *
 * This module is the missing input channel. It is deliberately small: it maps
 * plain-language user choices onto the vocabulary the existing engines already
 * speak, and it does not decide anything itself.
 *
 * WHAT IT IS NOT
 * --------------
 * It is NOT a second style registry. Every style here IS a row of
 * `VISUAL_STYLES`; the groups below are a PROJECTION of metadata those rows
 * already carry (`brandBehavior`, `industries`, `tags`), derived by seven
 * ordered rules rather than a hand-written table with forty-nine entries that
 * would drift the moment a style was added.
 *
 * It is NOT a second subject model. `SubjectChoice` maps onto the
 * `humanEmphasis` / `productEmphasis` fields the director engine already
 * publishes, and "let AI decide" maps onto *no override at all* — the existing
 * inference, untouched.
 *
 * ONE MORE THING IT ANSWERS
 * -------------------------
 * The same guided vocabulary decides how a user's UPLOADED image should be
 * used, when they ask us to decide (`proposeImageTreatment`). That belongs here
 * rather than in a module of its own because it reads exactly these choices —
 * what they said should be featured, the look they picked — and because it must
 * never become a second opinion about them. It decides nothing about
 * compatibility either: that it asks `slotAcceptance`, the predicate the router
 * itself applies.
 */
import { VISUAL_STYLES, type VisualStyle } from '../creator-outcomes/creatorVisualStyleRegistry';
import type { TemplateAssetFamily } from '../creator-templates/types';
import type { CompositionAssetPurpose } from './compositionAssetReference';
import type { TemplateAssetSlot } from './compositionAssetRouting';
import { slotAcceptance, defaultModeForPurpose } from './compositionAssetRouting';

/* ── What should be featured? ───────────────────────────────────────────────*/

/**
 * The user's answer to "What should be featured?", in the user's terms.
 *
 * `ai` is not a fifth kind of subject — it is the ABSENCE of a choice, and it
 * is the default. Saying so explicitly is what lets the UI show a chosen state
 * without pretending the user chose it.
 */
export type SubjectChoice = 'person' | 'product' | 'both' | 'text-only' | 'ai';

/** Emphasis vocabulary the Creative Director Engine already publishes. */
export type SubjectEmphasis = 'absent' | 'subtle' | 'central';

export interface SubjectOption {
  choice: SubjectChoice;
  label: string;
  hint: string;
}

/** Offered in this order: the two commonest answers first, AI last as the default. */
export const SUBJECT_OPTIONS: readonly SubjectOption[] = Object.freeze([
  { choice: 'person', label: 'A person', hint: 'Someone should be the focus.' },
  { choice: 'product', label: 'My product', hint: 'The product is the hero.' },
  { choice: 'both', label: 'Both', hint: 'A person using the product.' },
  { choice: 'text-only', label: 'Just text and background', hint: 'No person, no product — the words carry it.' },
  { choice: 'ai', label: 'Let AI decide', hint: 'We pick whatever suits your brief.' },
] as const);

export interface SubjectEmphasisOverride {
  humanEmphasis: SubjectEmphasis;
  productEmphasis: SubjectEmphasis;
}

/**
 * The emphasis pair a subject choice asserts, or `null` for "let AI decide".
 *
 * Null rather than a neutral pair on purpose: a neutral pair would be an
 * override that happens to agree with inference today and would silently start
 * disagreeing the moment a profile changed. "No answer" and "any answer" are
 * different things, and only one of them is what the user said.
 */
export function subjectEmphasisFor(choice: SubjectChoice | null | undefined): SubjectEmphasisOverride | null {
  switch (choice) {
    case 'person':    return { humanEmphasis: 'central', productEmphasis: 'absent' };
    case 'product':   return { humanEmphasis: 'absent', productEmphasis: 'central' };
    case 'both':      return { humanEmphasis: 'central', productEmphasis: 'central' };
    case 'text-only': return { humanEmphasis: 'absent', productEmphasis: 'absent' };
    default:          return null;
  }
}

export function isSubjectChoice(value: unknown): value is SubjectChoice {
  return SUBJECT_OPTIONS.some((o) => o.choice === value);
}

/* ── How should it look? ────────────────────────────────────────────────────*/

export type VisualDirectionGroup =
  | 'Product & UI'
  | 'Industry'
  | 'Photographic'
  | 'Bold & Street'
  | 'Dimensional'
  | 'Illustrated'
  | 'Editorial & Premium';

/** Presentation order — broad and familiar first, specialised last. */
export const VISUAL_DIRECTION_GROUPS: readonly VisualDirectionGroup[] = Object.freeze([
  'Photographic', 'Editorial & Premium', 'Illustrated',
  'Bold & Street', 'Dimensional', 'Industry', 'Product & UI',
]);

const has = (style: VisualStyle, ...tags: string[]) => tags.some((t) => style.tags.includes(t));

/**
 * Which group a style belongs to.
 *
 * Ordered rules, first match wins. The order carries meaning: `dashboard` is an
 * industry style AND a product surface, and it belongs with the product ones;
 * `clay` is illustration-led AND three-dimensional, and it belongs with the
 * dimensional ones. Reordering these changes the answer, which is why they are
 * a list rather than a set.
 */
export function groupForVisualStyle(style: VisualStyle): VisualDirectionGroup {
  // Specific product-surface tags only — `glassmorphism` carries a bare `ui`
  // tag and is a surface treatment, not a product mockup.
  if (has(style, 'mockup', 'dashboard', 'infographic', 'charts', 'app')) return 'Product & UI';
  // A style scoped to real industries rather than the `general` default.
  if (style.industries.length > 0 && !style.industries.includes('general')) return 'Industry';
  if (style.brandBehavior === 'photo-led') return 'Photographic';
  if (has(style, 'graffiti', 'street', 'urban', 'comic', 'anime', 'pop', 'neon', 'cyberpunk', 'sci-fi', 'futuristic', 'loud')) return 'Bold & Street';
  if (has(style, '3d', 'render', 'clay', 'glass', 'translucent', 'neumorphism', 'soft-ui', 'layered', 'paper-cut')) return 'Dimensional';
  if (style.brandBehavior === 'illustration-led'
    || has(style, 'watercolor', 'painterly', 'sketch', 'line', 'illustration', 'vector', 'flat', 'geometric', 'isometric', '2.5d', 'hand-drawn', 'doodle', 'abstract', 'shapes')) return 'Illustrated';
  return 'Editorial & Premium';
}

export interface VisualDirection {
  /** Registry id. Never shown to the user. */
  id: string;
  title: string;
  description: string;
  group: VisualDirectionGroup;
  /** Real rendered example, when one exists. */
  previewUrl: string | null;
  accent: string;
  surface: string;
}

/**
 * A curated showcase image exists for every style in the registry
 * (`public/creator-showcases/<id>/image.webp`). Pointing at it rather than
 * describing a style in words is the whole point: "Graffiti" means nothing to
 * someone who has never briefed a designer, and a picture of it means
 * everything.
 */
export function visualDirectionPreviewUrl(styleId: string, family?: TemplateAssetFamily): string {
  // Per FAMILY, because the showcases are: a style's carousel render and its
  // single-image render are different pictures, and showing the image render to
  // someone building an infographic would misrepresent what they are choosing.
  return `/creator-showcases/${styleId}/${family ?? 'image'}.webp`;
}

function toDirection(style: VisualStyle, family?: TemplateAssetFamily): VisualDirection {
  return {
    id: style.id,
    title: style.title,
    description: style.description,
    group: groupForVisualStyle(style),
    previewUrl: visualDirectionPreviewUrl(style.id, family),
    accent: style.thumbnail.accent,
    surface: style.thumbnail.surface,
  };
}

/** Every direction this asset family can actually render, in registry order. */
export function listVisualDirections(family?: TemplateAssetFamily): VisualDirection[] {
  return VISUAL_STYLES
    .filter((s) => !family || s.supportedFamilies.includes(family))
    .map((s) => toDirection(s, family));
}

/** The same list, bucketed for a "see all" browser. Empty groups are omitted. */
export function visualDirectionsByGroup(
  family?: TemplateAssetFamily,
): Array<{ group: VisualDirectionGroup; directions: VisualDirection[] }> {
  const all = listVisualDirections(family);
  return VISUAL_DIRECTION_GROUPS
    .map((group) => ({ group, directions: all.filter((d) => d.group === group) }))
    .filter((bucket) => bucket.directions.length > 0);
}

export function getVisualDirection(id: string | null | undefined, family?: TemplateAssetFamily): VisualDirection | null {
  if (!id) return null;
  return listVisualDirections(family).find((d) => d.id === id) ?? null;
}

/**
 * Is this direction one the chosen family can render?
 *
 * Asked before a stored choice is trusted: a user who picks a style for an
 * image and then switches to an infographic must not silently carry a style the
 * infographic renderer cannot express.
 */
export function isVisualDirectionSupported(id: string | null | undefined, family: TemplateAssetFamily): boolean {
  return getVisualDirection(id, family) !== null;
}

/* ── What we suggest ────────────────────────────────────────────────────────*/

export const RECOMMENDED_DIRECTION_COUNT = 6;

/**
 * The handful of directions to offer up front.
 *
 * Deterministic, and derived only from metadata the registry already carries —
 * `recommendedContent` matched against the chosen outcome, then `industries`
 * against the company's. Ranked, never filtered: the list is always filled to
 * six from registry order, so the user is never shown three options because
 * their outcome happened to be unusual.
 *
 * This is a SUGGESTION. Nothing downstream treats it as a decision.
 */
export function recommendVisualDirections(input: {
  family: TemplateAssetFamily;
  outcomeId?: string | null;
  industry?: string | null;
  limit?: number;
}): VisualDirection[] {
  const limit = Math.max(1, input.limit ?? RECOMMENDED_DIRECTION_COUNT);
  const outcome = String(input.outcomeId || '').toLowerCase().trim();
  const industry = String(input.industry || '').toLowerCase().trim();

  const scored = VISUAL_STYLES
    .filter((s) => s.supportedFamilies.includes(input.family))
    .map((style, index) => {
      let score = 0;
      if (outcome && style.recommendedContent.some((c) => outcome.includes(c) || c.includes(outcome))) score += 2;
      if (industry && style.industries.includes(industry)) score += 1;
      // Registry order breaks ties, so the same inputs always give the same six.
      return { style, score, index };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  return scored.slice(0, limit).map((s) => toDirection(s.style, input.family));
}

/* ── The user's creative choices, as one value ──────────────────────────────*/

/**
 * Everything the guided workflow lets a user say about how their creative
 * should look. Every field is optional: an empty object is exactly today's
 * behaviour, which is what makes this safe to thread everywhere.
 */
export interface GuidedCreativeChoices {
  /** A `VISUAL_STYLES` id the user picked. Absent → the engine infers. */
  visualDirectionId?: string | null;
  /** What the user said should be featured. Absent / 'ai' → the engine infers. */
  subject?: SubjectChoice | null;
  /** Free-form direction in the user's own words. */
  visualInstruction?: string | null;
}

export const EMPTY_GUIDED_CHOICES: GuidedCreativeChoices = Object.freeze({});

/** Did the user actually express anything, or is this an empty shell? */
export function hasGuidedChoices(choices: GuidedCreativeChoices | null | undefined): boolean {
  if (!choices) return false;
  return Boolean(
    choices.visualDirectionId
    || (choices.subject && choices.subject !== 'ai')
    || String(choices.visualInstruction || '').trim(),
  );
}

/**
 * Narrow stored choices to what the family can honour.
 *
 * A direction the family cannot render is DROPPED rather than carried, so the
 * engine falls back to inference — the documented safe behaviour — instead of
 * being handed a style its renderer has no expression for.
 */
export function sanitizeGuidedChoices(
  choices: GuidedCreativeChoices | null | undefined,
  family: TemplateAssetFamily,
): GuidedCreativeChoices {
  if (!choices) return EMPTY_GUIDED_CHOICES;
  const directionId = choices.visualDirectionId && isVisualDirectionSupported(choices.visualDirectionId, family)
    ? choices.visualDirectionId
    : null;
  const subject = isSubjectChoice(choices.subject) ? choices.subject : null;
  const instruction = String(choices.visualInstruction || '').trim().slice(0, 400);
  return {
    ...(directionId ? { visualDirectionId: directionId } : {}),
    ...(subject && subject !== 'ai' ? { subject } : {}),
    ...(instruction ? { visualInstruction: instruction } : {}),
  };
}

/* ── "Let us choose" — how should we use their image? ───────────────────────*/

/**
 * The four ways a user's photograph can inform a generated image.
 *
 * CONDITION only, and deliberately so. The other two purposes a template can
 * declare — `logo` and `supporting` — are COMPOSE: they place exact pixels at
 * declared coordinates, and no template outside `sys-image-logo-only` declares
 * any. Proposing one would be proposing a treatment the renderer would refuse,
 * which is the precise failure this whole feature exists to end.
 */
export const PROPOSABLE_PURPOSES: readonly CompositionAssetPurpose[] =
  Object.freeze(['subject', 'product', 'background', 'style_reference'] as const);

export type ProposablePurpose = 'subject' | 'product' | 'background' | 'style_reference';

export interface TreatmentProposal {
  /** The purpose we intend to attach, or null when we could not choose one. */
  purpose: ProposablePurpose | null;
  /** Why, in the vocabulary of the signals — for tests and telemetry, never for the user. */
  basis:
    | 'user_instruction'
    | 'subject_choice'
    | 'brief'
    | 'template_contract'
    | 'visual_look'
    | 'conservative_default'
    | 'cannot_decide';
}

const CANNOT_DECIDE: TreatmentProposal = Object.freeze({ purpose: null, basis: 'cannot_decide' });

/** Word groups the instruction is read against. Deliberately small and literal. */
const INSTRUCTION_SIGNALS: ReadonlyArray<{ purpose: ProposablePurpose; words: readonly string[] }> = Object.freeze([
  { purpose: 'background', words: ['background', 'behind', 'backdrop', 'scene behind', 'wallpaper'] },
  { purpose: 'style_reference', words: ['inspiration', 'inspired', 'style', 'vibe', 'feel like', 'mood', 'reference', "don't copy", 'do not copy', 'not exactly'] },
  { purpose: 'product', words: ['product', 'packaging', 'device', 'bottle', 'box', 'screenshot'] },
  { purpose: 'subject', words: ['me', 'my face', 'myself', 'person', 'portrait', 'prominent', 'main', 'hero', 'front'] },
]);

/**
 * Which purposes this template can actually accept, in the fixed order above.
 *
 * Asked through `slotAcceptance` — the SAME predicate the router applies — so a
 * proposal can never name something routing would refuse. Compatibility is not
 * re-implemented here; it is consulted.
 */
function acceptablePurposes(slots: readonly TemplateAssetSlot[] | null | undefined): ProposablePurpose[] {
  return PROPOSABLE_PURPOSES.filter(
    (p) => slotAcceptance(Array.isArray(slots) ? slots : undefined, p, defaultModeForPurpose(p)).ok,
  ) as ProposablePurpose[];
}

const contains = (haystack: string, words: readonly string[]) => words.some((w) => haystack.includes(w));

/**
 * Choose one treatment for an uploaded image, deterministically.
 *
 * Signal priority, highest first — the user's own words, then their explicit
 * answers, then what the design implies:
 *
 *   1. the instruction they typed about THIS image;
 *   2. what they said should be featured;
 *   3. the creative brief;
 *   4. the template's own contract (a product design wants a product);
 *   5. the selected look;
 *   6. failing all of those, a conservative default.
 *
 * Ambiguity resolves to `background`, never `subject`. A background that should
 * have been a subject is a muted result; a subject that should have been a
 * background puts a person at the centre of a composition nobody asked for —
 * the two mistakes are not equally recoverable.
 *
 * Pure and total: same inputs, same answer, always one of four purposes or
 * `cannot_decide`. No provider call, no randomness, no clock.
 */
export function proposeImageTreatment(input: {
  templateSlots?: readonly TemplateAssetSlot[] | null;
  templateCategory?: string | null;
  templatePurposeKey?: string | null;
  subject?: SubjectChoice | null;
  visualDirectionId?: string | null;
  instruction?: string | null;
  brief?: string | null;
  /**
   * Which family is being made. Narrows what may be PROPOSED — never how a
   * chosen purpose routes, which stays a property of purpose and mode alone.
   */
  family?: 'image' | 'carousel' | 'infographic' | null;
}): TreatmentProposal {
  /*
   * A deterministic family cannot guide a look, so it is never PROPOSED one.
   *
   * The template still declares the slot and the router still admits it — a
   * user who deliberately picks "style reference" gets the existing truthful
   * refusal from the renderer. What changes is that the system stops
   * SUGGESTING something it knows it cannot do.
   */
  const deterministic = input.family === 'infographic' || input.family === 'carousel';
  const acceptable = acceptablePurposes(input.templateSlots)
    .filter((p) => !(deterministic && p === 'style_reference'));
  if (acceptable.length === 0) return CANNOT_DECIDE;

  /** First acceptable candidate from an ordered wish-list, else null. */
  const firstAcceptable = (wish: readonly ProposablePurpose[]): ProposablePurpose | null =>
    wish.find((p) => acceptable.includes(p)) ?? null;

  // 1 — the user's own words about this image.
  const instruction = String(input.instruction || '').toLowerCase().trim();
  if (instruction) {
    for (const signal of INSTRUCTION_SIGNALS) {
      if (contains(instruction, signal.words) && acceptable.includes(signal.purpose)) {
        return { purpose: signal.purpose, basis: 'user_instruction' };
      }
    }
  }

  // 2 — what they said should be featured.
  if (input.subject === 'person') {
    const p = firstAcceptable(['subject', 'background']);
    if (p) return { purpose: p, basis: 'subject_choice' };
  }
  if (input.subject === 'product') {
    const p = firstAcceptable(['product', 'subject', 'background']);
    if (p) return { purpose: p, basis: 'subject_choice' };
  }
  if (input.subject === 'both') {
    const p = firstAcceptable(['subject', 'product', 'background']);
    if (p) return { purpose: p, basis: 'subject_choice' };
  }
  if (input.subject === 'text-only') {
    // They asked for no person and no product, so their image can only set the
    // scene or the look — never become the thing in the frame.
    const p = firstAcceptable(['background', 'style_reference']);
    if (p) return { purpose: p, basis: 'subject_choice' };
  }

  // 3 — the brief.
  const brief = String(input.brief || '').toLowerCase();
  if (brief) {
    for (const signal of INSTRUCTION_SIGNALS) {
      if (contains(brief, signal.words) && acceptable.includes(signal.purpose)) {
        return { purpose: signal.purpose, basis: 'brief' };
      }
    }
  }

  // 4 — the template's own contract.
  const category = String(input.templateCategory || '').toLowerCase();
  const purposeKey = String(input.templatePurposeKey || '').toLowerCase();
  if ((category === 'product' || purposeKey.includes('product')) && acceptable.includes('product')) {
    return { purpose: 'product', basis: 'template_contract' };
  }

  // 5 — the selected look. A photographic look can carry a real photograph as
  // its subject; an illustrated or artistic one reinterprets, so the image is
  // better used as a style anchor than as literal content.
  const look = String(input.visualDirectionId || '');
  if (look) {
    const style = getVisualDirection(look);
    if (style) {
      const photographic = style.group === 'Photographic';
      const wish: ProposablePurpose[] = photographic
        ? ['subject', 'background']
        : ['style_reference', 'background'];
      const p = firstAcceptable(wish);
      if (p) return { purpose: p, basis: 'visual_look' };
    }
  }

  // 6 — conservative default.
  const fallback = firstAcceptable(['background', 'style_reference', 'subject', 'product']);
  return fallback
    ? { purpose: fallback, basis: 'conservative_default' }
    : CANNOT_DECIDE;
}

/**
 * What we will tell the user we intend to do, in their words.
 *
 * The second sentence states the PROMISE, and it is derived from the mode the
 * purpose actually resolves to rather than asserted: every proposable purpose
 * is CONDITION, so the honest wording is always referential. If a compose
 * purpose ever became proposable this would have to say something different,
 * which is why it is computed and not written down.
 */
export function describeTreatment(
  purpose: ProposablePurpose,
  /**
   * Which family is being made.
   *
   * The same purpose does not mean the same thing everywhere, and pretending it
   * does is how a promise stops being true. An infographic is composited
   * deterministically with no model in its path: a `background` there is placed
   * and softened, never reinterpreted, so the referential wording every other
   * family needs would be simply wrong. Omitted → the generative wording, which
   * is correct for image and banner and is what every existing caller gets.
   */
  family?: 'image' | 'carousel' | 'infographic' | null,
): { headline: string; promise: string } {
  /*
   * INFOGRAPHIC — deterministic, and described as such.
   *
   * Only `background` is honoured here, so only it gets the placement wording.
   * Anything else on this family is genuinely unsupported and keeps the
   * referential sentence rather than borrowing a promise it cannot keep.
   */
  if (family === 'infographic' && purpose === 'background') {
    return {
      headline: 'We’ll use your image as a faded background',
      promise: 'It’s cropped to fit and softened behind the design so the text stays readable.',
    };
  }

  /*
   * CAROUSEL — the same deterministic placement, across the whole deck.
   *
   * One accepted background sits behind every slide, so the promise has to say
   * "the carousel", not "this image". Saying it the generative way would claim
   * a reinterpretation that no model performs here.
   */
  if (family === 'carousel' && purpose === 'background') {
    return {
      headline: 'We’ll use your image as the background across the carousel',
      promise: 'The same picture sits behind every slide, cropped to fit and softened so the text stays readable.',
    };
  }

  /*
   * DETERMINISTIC FAMILIES CANNOT GUIDE A LOOK.
   *
   * Infographic and carousel composite SVG over a base layer with no model
   * anywhere in the path. A style reference asks for a manner of seeing to be
   * emulated, and a compositor that copies pixels cannot do it — so the
   * renderer refuses and discloses `family_unsupported`.
   *
   * Until this line, the proposal still told those users "we'll use it as a
   * visual reference, so the GENERATED result may differ" — a promise about a
   * generation that never happens, made moments before the disclosure
   * contradicted it. Saying so up front is the honest order: refuse first,
   * rather than accept and then explain.
   */
  if ((family === 'infographic' || family === 'carousel') && purpose === 'style_reference') {
    return {
      headline: 'This design can’t take a style reference',
      promise: 'It’s built from your text and brand rather than generated from a picture, so your image wouldn’t be used. It stays in your library — choose an image design to guide a look.',
    };
  }

  const headline = {
    subject: 'We’ll use your image as the main subject',
    product: 'We’ll use your image as the product',
    background: 'We’ll use your image as the background',
    style_reference: 'We’ll use your image to guide the look',
  }[purpose];
  const placedExactly = defaultModeForPurpose(purpose) === 'compose';
  const promise = placedExactly
    ? 'It will be placed exactly as you uploaded it.'
    : 'We’ll use it as a visual reference, so the generated result may differ from the original.';
  return { headline, promise };
}
