/**
 * The resolved CREATOR BRIEF — the ONE content source the image / carousel /
 * infographic editors fill from.
 *
 * Before this module the writer content reached the editor through two
 * unrelated shapes: a Writer launch (CreatorAttachmentSession → title/body/
 * audience/tone) and the Unified Workspace's MarketingBrief (sessionStorage →
 * freeText/offer/audience/tone/cta). Each was mapped to a handful of form
 * answers and the rest was lost: the workspace tone never reached field
 * assist, the offer only fed the topic, and nothing told the AI which line was
 * the MAIN MESSAGE.
 *
 * Owner decision (2026-10-24): the writer content drives every field, and the
 * main message is the key — it is the primary on-image text and every other
 * field supports it. So both sources resolve here into one shape, and every
 * downstream consumer (template fill, overlay fill, chips, field assist,
 * generation payload) reads only this.
 *
 * Pure — no DB, no fetch, no window. Safe on both sides (the server sanitises
 * a persisted brief with the same function the client uses).
 */

import type { MarketingBrief } from '../content/unifiedCreationModel';
import { getCreationGoal } from '../content/unifiedCreationModel';
import type { WriterCreatorSourcePayload } from '../content/writerCreatorAssetLaunch';

export type CreatorBriefSource = 'writer' | 'workspace';

export interface CreatorBrief {
  /** THE key line: what the asset must say. Primary on-image text. */
  mainMessage: string;
  /** The full writer content (post body / conversational brief). */
  body: string;
  audience: string;
  tone: string;
  /** What the viewer is asked to do. */
  cta: string;
  offer: string;
  objective: string;
  source: CreatorBriefSource;
}

/** Length caps — the same ceilings field-assist applies to client strings. */
export const CREATOR_BRIEF_LIMITS = {
  mainMessage: 300,
  body: 6000,
  audience: 300,
  tone: 120,
  cta: 120,
  offer: 300,
  objective: 300,
} as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** Body keeps its line breaks (paragraph structure carries meaning for slides). */
const bodyStr = (v: unknown): string => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');

/**
 * Shorten text to at most `max` characters WITHOUT cutting a word in half. Text that
 * already fits is returned unchanged (line breaks included). A longer text is cut at
 * the last whitespace inside the limit and loses any dangling separator (`,` `;` `:` `—`),
 * so copy that reaches an image, a slide or a card never ends mid-word ("…Marketi").
 * Only a single word longer than the limit is cut inside the word.
 */
export function clipWords(text: string, max: number): string {
  const value = String(text ?? '').trim();
  if (!value || value.length <= max) return value;
  const head = value.slice(0, max + 1);
  const lastSpace = head.search(/\s\S*$/);
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : value.slice(0, max);
  return cut.replace(/[\s,;:—–-]+$/u, '').trim();
}

/**
 * The first sentence of a piece of writing, as the main message.
 * Splits on sentence punctuation, a semicolon or a line break — a run-on
 * `a; b; c` paragraph is not one message — and drops URLs first so a link
 * never becomes the headline. Always shortened on a word boundary.
 */
export function deriveMainMessage(text: string, max: number = CREATOR_BRIEF_LIMITS.mainMessage): string {
  const cleaned = String(text || '').replace(/https?:\/\/\S+/gi, '').trim();
  if (!cleaned) return '';
  const first = cleaned.split(/(?<=[.!?])\s+|;\s+|\n+/u).map((s) => s.trim()).find((s) => /[A-Za-z0-9]/.test(s)) ?? '';
  return clipWords(str(first), max);
}

function capped(b: CreatorBrief): CreatorBrief {
  return {
    mainMessage: clipWords(b.mainMessage, CREATOR_BRIEF_LIMITS.mainMessage),
    body: clipWords(b.body, CREATOR_BRIEF_LIMITS.body),
    audience: clipWords(b.audience, CREATOR_BRIEF_LIMITS.audience),
    tone: clipWords(b.tone, CREATOR_BRIEF_LIMITS.tone),
    cta: clipWords(b.cta, CREATOR_BRIEF_LIMITS.cta),
    offer: clipWords(b.offer, CREATOR_BRIEF_LIMITS.offer),
    objective: clipWords(b.objective, CREATOR_BRIEF_LIMITS.objective),
    source: b.source,
  };
}

/** Unified Workspace MarketingBrief → CreatorBrief. */
export function resolveCreatorBriefFromWorkspace(brief: MarketingBrief | null | undefined): CreatorBrief | null {
  if (!brief || typeof brief !== 'object') return null;
  const body = bodyStr(brief.freeText);
  const offer = str(brief.offer);
  const goalLabel = brief.goalId ? (getCreationGoal(brief.goalId)?.label ?? '') : '';
  const resolved = capped({
    // An explicitly stated main message (Creator intake) wins over one derived from the brief.
    mainMessage: str(brief.mainMessage) || deriveMainMessage(body) || offer,
    body,
    audience: str(brief.audience),
    tone: str(brief.tone),
    cta: str(brief.cta),
    offer,
    objective: goalLabel || offer || deriveMainMessage(body),
    source: 'workspace',
  });
  return hasCreatorBriefContent(resolved) ? resolved : null;
}

/** Writer launch payload → CreatorBrief. The post title is the main message when present. */
export function resolveCreatorBriefFromWriter(src: WriterCreatorSourcePayload | null | undefined): CreatorBrief | null {
  if (!src || typeof src !== 'object') return null;
  const body = bodyStr(src.body);
  const title = str(src.title);
  const resolved = capped({
    mainMessage: title || deriveMainMessage(body),
    body,
    audience: str(src.audience),
    tone: str(src.tone),
    cta: '',
    offer: '',
    objective: '',
    source: 'writer',
  });
  return hasCreatorBriefContent(resolved) ? resolved : null;
}

/**
 * The single resolution order. An explicit Writer launch wins (the user came
 * here FROM a post); otherwise the workspace brief; otherwise nothing.
 */
export function resolveCreatorBrief(input: {
  writerSource?: WriterCreatorSourcePayload | null;
  workspaceBrief?: MarketingBrief | null;
}): CreatorBrief | null {
  return resolveCreatorBriefFromWriter(input.writerSource ?? null)
    ?? resolveCreatorBriefFromWorkspace(input.workspaceBrief ?? null);
}

export function hasCreatorBriefContent(b: CreatorBrief | null | undefined): b is CreatorBrief {
  return Boolean(b && (b.mainMessage.trim() || b.body.trim()));
}

/**
 * Validate an untrusted brief (a request body, a persisted row, storage).
 * Accepts camelCase or snake_case keys; returns null when nothing usable.
 */
export function sanitizeCreatorBrief(raw: unknown): CreatorBrief | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const source: CreatorBriefSource = r.source === 'writer' ? 'writer' : 'workspace';
  const resolved = capped({
    mainMessage: str(r.mainMessage ?? r.main_message),
    body: bodyStr(r.body ?? r.full_text ?? r.fullText),
    audience: str(r.audience),
    tone: str(r.tone),
    cta: str(r.cta),
    offer: str(r.offer),
    objective: str(r.objective),
    source,
  });
  return hasCreatorBriefContent(resolved) ? resolved : null;
}

/**
 * The brief as the editor currently stands: the user's own "main message" /
 * "viewer action" / audience answers override what the brief seeded, because
 * an edited answer IS the user's latest word on it.
 */
export function effectiveCreatorBrief(
  brief: CreatorBrief | null,
  answers: Record<string, string>,
  editedAnswerIds: ReadonlySet<string>,
): CreatorBrief | null {
  if (!brief) return null;
  const pick = (id: string, fallback: string): string => {
    const v = str(answers[id]);
    return editedAnswerIds.has(id) && v ? v : fallback;
  };
  return {
    ...brief,
    mainMessage: pick('keyMessage', brief.mainMessage),
    cta: pick('cta', brief.cta),
    audience: pick('audience', brief.audience),
  };
}

/**
 * Fit the main message into a field of `maxLength` characters without
 * inventing anything: verbatim when it fits, else its first clause, else a
 * word-boundary cut. `exact` says whether the result is the message verbatim
 * (an inexact fit is a candidate for an AI condense pass).
 */
export function fitMainMessage(mainMessage: string, maxLength?: number): { value: string; exact: boolean } {
  const msg = str(mainMessage).replace(/[.!]+$/, '');
  if (!msg) return { value: '', exact: true };
  if (!maxLength || msg.length <= maxLength) return { value: msg, exact: true };
  const clause = msg.split(/\s+[—–-]\s+|[:;]\s+|,\s+/)[0]?.trim() ?? '';
  if (clause && clause.length <= maxLength && clause.length >= Math.min(12, maxLength)) return { value: clause, exact: false };
  const cut = msg.slice(0, maxLength + 1).replace(/\s+\S*$/, '').trim();
  return { value: (cut || msg.slice(0, maxLength)).trim(), exact: false };
}

/**
 * Field-assist `context` fields carrying the WHOLE brief. The server prompt
 * treats `main_message` as the key every field supports, `source_content` as
 * the material to draw from, and cta/offer as facts to keep.
 */
export function creatorBriefAssistContext(b: CreatorBrief | null): Record<string, string> {
  if (!b) return {};
  const out: Record<string, string> = {};
  if (b.mainMessage) out.main_message = b.mainMessage;
  if (b.body) out.source_content = b.body;
  if (b.audience) out.audience = b.audience;
  if (b.tone) out.tone = b.tone;
  if (b.cta) out.cta = b.cta;
  if (b.offer) out.offer = b.offer;
  if (b.objective) out.objective = b.objective;
  return out;
}

/**
 * Seed the editor's form answers from a brief restored server-side (a new tab
 * has neither the Writer session nor the workspace brief in its storage).
 * Only ids present in `fieldIds` are written.
 */
export function creatorBriefToEditorAnswers(b: CreatorBrief, fieldIds: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (id: string, v: string) => { if (v && fieldIds.has(id)) out[id] = v; };
  set('topic', (b.offer || b.mainMessage).slice(0, 120));
  set('keyMessage', b.mainMessage);
  set('audience', b.audience);
  set('cta', b.cta);
  return out;
}
