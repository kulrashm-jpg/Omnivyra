/**
 * Single source of truth for two predicates the engagement pipeline keeps
 * needing in different layers (API routes, hooks, UI components, service
 * helpers). Anywhere you would otherwise write the inline checks below,
 * import from here instead.
 *
 * Why this file exists:
 *   - `message_type` lands in the DB as 'dm' (legacy ingester) OR
 *     'direct_message' (newer /api/extension/events/dms). Both shapes
 *     coexist. Five different files used to spell the OR check inline.
 *   - "Did the user send this?" historically depended on three signals:
 *     direction='outgoing', raw_payload.author_self/sender_self=true, and
 *     content starting with "You:" (LinkedIn DOM artefact). Three files
 *     used to spell that OR check inline, each slightly differently.
 */

/** True when the message_type column represents a 1:1 direct message,
 *  regardless of which ingester wrote the row. */
export function isDmMessageType(messageType: string | null | undefined): boolean {
  if (!messageType) return false;
  const lower = messageType.toString().toLowerCase();
  return lower === 'dm' || lower === 'direct_message';
}

/** Inputs the role checker accepts. Each field is optional because
 *  callers see different subsets of message metadata. */
export type AuthorSelfInputs = {
  /** engagement_messages.direction column (incoming|outgoing). */
  direction?: string | null;
  /** engagement_messages.raw_payload.author_self boolean. */
  author_self?: boolean | null;
  /** engagement_messages.raw_payload.sender_self boolean (legacy DM ingester). */
  sender_self?: boolean | null;
  /** Message content. LinkedIn's preview rows prefix self-sent messages
   *  with "You: " — we use this as a fallback signal when the boolean
   *  flags aren't populated. */
  content?: string | null;
};

/** True when the message in question was authored by the logged-in user.
 *  Combines direction, raw-payload booleans, and the LinkedIn "You:"
 *  preview prefix into one decision. Returns false for ambiguous input. */
export function isAuthorSelf(inputs: AuthorSelfInputs): boolean {
  if (inputs.direction === 'outgoing') return true;
  if (inputs.author_self === true) return true;
  if (inputs.sender_self === true) return true;
  const trimmed = (inputs.content ?? '').toString().trim();
  if (/^you\s*:/i.test(trimmed)) return true;
  return false;
}

/** Strip the "Sender:" / "You:" prefix that LinkedIn injects on DM
 *  preview rows. Once we've used the prefix to route message ownership
 *  (via isAuthorSelf), the cleaned text is what humans + LLMs read.
 *  Idempotent — only matches a leading capitalized name token. */
export function stripSenderColonPrefix(content: string | null | undefined): string {
  const trimmed = (content || '').toString().trim();
  if (!trimmed) return '';
  // "You: ..." — outgoing preview.
  const youMatch = trimmed.match(/^you\s*:\s*/i);
  if (youMatch) return trimmed.slice(youMatch[0].length).trim();
  // "FirstName: ..." — incoming preview.
  const senderMatch = trimmed.match(/^([A-Z][\w'.-]{0,40})\s*:\s*/);
  if (senderMatch) return trimmed.slice(senderMatch[0].length).trim();
  return trimmed;
}
