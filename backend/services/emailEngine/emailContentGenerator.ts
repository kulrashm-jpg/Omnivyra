/**
 * PI-041-A — the deterministic v1 Email content generator.
 *
 * ─── DETERMINISTIC, AND WHY THAT MATTERS HERE ─────────────────────────────
 * Identical inputs produce byte-identical output. Nothing reads a clock, a random
 * source, a model or the network. That is not a stylistic preference: the send
 * path validates content BEFORE an attempt exists and records it INSIDE the send
 * boundary, so the same render happens twice and the two must agree exactly or
 * the evidence would describe something other than what was sent.
 *
 * ─── THE WORKFLOW VERSION IS AUTHORITATIVE ────────────────────────────────
 * Content intent is the authored step `instruction`, carried verbatim through the
 * Plan snapshot into `execution_tasks.action` and onto the legacy task. This
 * module renders that intent; it does not decide it.
 *
 * ─── IT FAILS CLOSED, AND IT DOES NOT IMPROVISE ───────────────────────────
 * `instruction` is optional on a step (032, unchanged), so a task can arrive with
 * no intent at all. That is a refusal, not a prompt to invent copy. In
 * particular it does NOT fall back to `task.explanation`, does NOT read
 * `gtm_messages`, and does NOT substitute generic sales language — a recipient
 * receiving plausible-looking text nobody authored is a worse failure than a run
 * that stops.
 *
 * ─── NOT A MESSAGE LIBRARY ────────────────────────────────────────────────
 * J-5 remains deferred. There is no template entity, no reuse, no versioning and
 * no storage here: this is a pure function from intent plus person to two
 * strings.
 */

/** Bumped whenever rendering changes, so evidence says which renderer ran. */
export const EMAIL_CONTENT_GENERATOR_VERSION = 'email-deterministic-1.0.0';

/** Recorded as `content_source` on the evidence row. */
export const EMAIL_CONTENT_SOURCE = `workflow_instruction:${EMAIL_CONTENT_GENERATOR_VERSION}`;

/** The canonical person fields a render may use. Nothing else is permitted. */
export const PERSONALIZATION_FIELDS = [
  'full_name', 'first_name', 'last_name', 'job_title',
  'department', 'seniority', 'city', 'region', 'timezone',
] as const;

const SUBJECT_MAX = 200;
const INSTRUCTION_MAX = 2000;

export class EmailContentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'EmailContentError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new EmailContentError(message, code);
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
  /** Exactly the values substituted, so the render can be explained later. */
  readonly personalizationInputs: Record<string, string>;
  readonly contentSource: string;
}

/**
 * Collapse whitespace so a multi-line instruction yields one usable subject.
 * Deliberately not a sentence splitter: guessing where a thought ends would make
 * the subject depend on punctuation nobody authored for that purpose.
 */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Substitute `{{field}}` for an authorized person field.
 *
 * A placeholder naming an unauthorized field, or one whose value this person does
 * not have, makes the whole render UNUSABLE rather than resolving to an empty
 * string — "Hi ," reaching a real person is exactly the failure this refuses.
 */
function substitute(
  template: string,
  personalization: Record<string, string>,
): { text: string; used: Record<string, string> } {
  const used: Record<string, string> = {};
  const allowed = new Set<string>(PERSONALIZATION_FIELDS);

  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_whole, raw: string) => {
    const field = raw.toLowerCase();
    if (!allowed.has(field)) {
      fail(
        `the instruction references "${field}", which is not an authorized personalization field`,
        'unauthorized_personalization',
      );
    }
    const value = str(personalization[field]);
    if (value === null) {
      fail(
        `this person has no "${field}" to personalize with; refusing rather than sending a gap`,
        'personalization_missing',
      );
    }
    used[field] = value;
    return value;
  });

  return { text, used };
}

/**
 * Render the email for one task.
 *
 * `instruction` is the authored step text. Absent or blank, this refuses — see
 * the header.
 */
export function renderEmailContent(input: {
  instruction: string | null;
  personalization: Record<string, string>;
}): RenderedEmail {
  const instruction = str(input.instruction);
  if (instruction === null) {
    fail(
      'this workflow step authored no email instruction; refusing rather than inventing content',
      'instruction_missing',
    );
  }
  if (instruction.length > INSTRUCTION_MAX) {
    fail(`an instruction must be at most ${INSTRUCTION_MAX} characters`, 'instruction_too_long');
  }

  const personalization = input.personalization ?? {};
  const { text, used } = substitute(instruction, personalization);

  const body = text.trim();
  if (body === '') {
    fail('the instruction rendered to an empty body', 'content_unusable');
  }

  // The subject is the instruction's first line, collapsed and bounded. v1 does
  // not author a separate subject line, and inventing one would be content nobody
  // wrote — so it is derived, visibly and deterministically, from the intent.
  const firstLine = oneLine(body.split('\n')[0] ?? '');
  if (firstLine === '') {
    fail('the instruction rendered to an empty subject', 'content_unusable');
  }
  const subject = firstLine.length > SUBJECT_MAX
    ? `${firstLine.slice(0, SUBJECT_MAX - 1).trimEnd()}…`
    : firstLine;

  return {
    subject,
    body,
    personalizationInputs: used,
    contentSource: EMAIL_CONTENT_SOURCE,
  };
}
