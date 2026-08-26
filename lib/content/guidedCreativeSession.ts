/**
 * Carrying the user's creative answers from the guided workspace to the editor.
 *
 * The marketing brief already travels this way — session storage, keyed to the
 * draft, read back when the editor opens with `?from=workspace`. The creative
 * answers follow the SAME route rather than inventing a second transport, and
 * deliberately do not travel in the URL: a style id in the address bar is an
 * implementation detail the user should never see, and a bookmarked URL
 * carrying half a creative is a state nobody chose.
 *
 * Parsing is total and forgiving in one direction only: anything malformed
 * yields "no choices", which is exactly today's behaviour. A corrupt value must
 * never produce a *different* creative — only the default one.
 */
import {
  isSubjectChoice,
  type GuidedCreativeChoices,
  type SubjectChoice,
} from './guidedCreativeDirection';

export type { SubjectChoice };

export const GUIDED_CHOICES_SESSION_KEY = 'omnivyra.creator.guidedChoices.v1';

export function serializeGuidedChoices(choices: GuidedCreativeChoices): string {
  return JSON.stringify({
    visualDirectionId: choices.visualDirectionId ?? null,
    subject: choices.subject ?? null,
    visualInstruction: choices.visualInstruction ?? null,
  });
}

/**
 * Read choices back. Returns null when there is nothing usable to read —
 * distinct from an empty object, so a caller can tell "the user skipped the
 * step" apart from "there was never a workspace hand-off at all".
 */
export function readGuidedChoices(raw: string | null | undefined): GuidedCreativeChoices | null {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;

  const visualDirectionId = typeof row.visualDirectionId === 'string' && row.visualDirectionId.trim()
    ? row.visualDirectionId.trim()
    : null;
  const subject = isSubjectChoice(row.subject) ? row.subject : null;
  const visualInstruction = typeof row.visualInstruction === 'string' && row.visualInstruction.trim()
    ? row.visualInstruction.trim().slice(0, 400)
    : null;

  if (!visualDirectionId && !subject && !visualInstruction) return null;
  return {
    ...(visualDirectionId ? { visualDirectionId } : {}),
    ...(subject && subject !== 'ai' ? { subject } : {}),
    ...(visualInstruction ? { visualInstruction } : {}),
  };
}
