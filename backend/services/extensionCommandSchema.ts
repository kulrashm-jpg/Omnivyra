/**
 * Extension command payload schema — strict, versioned, per-action.
 *
 * Every command emitted by /api/extension/commands carries:
 *   { schema_version, payload: <shape-specific-to-(platform,action)> }
 *
 * The extension's commandProcessor rejects commands whose schema_version
 * it does not know OR whose payload fails the per-action validator.
 *
 * The single SCHEMA_VERSION here is THE version — bump it when any
 * payload shape changes. Keep the extension-side mirror in
 * extension/shared/commandPayloadSchema.js in lockstep.
 */

export const COMMAND_SCHEMA_VERSION = '2026-04-29.1';

/** Return shape for validators. */
type Validation =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: string; message: string };

function requireString(obj: any, key: string, min = 1): { ok: true; value: string } | { ok: false; message: string } {
  const v = obj?.[key];
  if (typeof v !== 'string' || v.trim().length < min) {
    return { ok: false, message: `${key} must be a string with at least ${min} character(s)` };
  }
  return { ok: true, value: v };
}

function allowOnly(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return 'payload must be an object';
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return `unknown field: ${k}`;
  return null;
}

// Keyed by `${platform}.${action}` using extension-facing action names.
const VALIDATORS: Record<string, (p: any) => Validation> = {
  'linkedin.reply_comment': (p) => {
    const unknown = allowOnly(p, ['text', 'autoSubmit', 'threadId', 'commentText', 'replyToComment', 'author']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'linkedin.like_message': (p) => {
    const unknown = allowOnly(p, ['messageText', 'targetText', 'commentText', 'platformMessageId']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    return { ok: true, payload: p };
  },
  'linkedin.continue_thread': (p) => {
    const unknown = allowOnly(p, ['text', 'reply', 'content', 'autoSubmit', 'threadId', 'commentText', 'replyToComment', 'messageText']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'linkedin.create_post': (p) => {
    const unknown = allowOnly(p, ['text', 'content', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: p };
  },

  'twitter.reply_comment': (p) => {
    const unknown = allowOnly(p, ['text', 'reply', 'autoSubmit', 'commentText', 'threadId']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'twitter.like_message': (p) => {
    const unknown = allowOnly(p, ['messageText', 'commentText', 'targetText', 'platformMessageId']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    return { ok: true, payload: p };
  },
  'twitter.continue_thread': (p) => {
    const unknown = allowOnly(p, ['text', 'reply', 'content', 'autoSubmit', 'threadId', 'commentText', 'replyToComment']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'twitter.open_thread': (p) => {
    const unknown = allowOnly(p, ['threadId', 'threadUrl']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.threadId && !p.threadUrl) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'threadId or threadUrl required' };
    }
    return { ok: true, payload: p };
  },
  'twitter.create_post': (p) => {
    const unknown = allowOnly(p, ['text', 'content', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: p };
  },

  'facebook.reply_comment': (p) => {
    const unknown = allowOnly(p, ['text', 'reply', 'autoSubmit', 'commentText']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'facebook.like_message': (p) => {
    const unknown = allowOnly(p, ['messageText', 'commentText', 'targetText']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    return { ok: true, payload: p };
  },
  'facebook.create_post': (p) => {
    const unknown = allowOnly(p, ['text', 'content', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: p };
  },
  'facebook.continue_thread': (p) => {
    // Messenger DM reply. `threadId` is advisory — the extension requires
    // the tab to already be on the Messenger conversation; we do not
    // navigate cross-origin.
    const unknown = allowOnly(p, ['text', 'reply', 'content', 'message', 'autoSubmit', 'threadId']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'facebook.open_thread': (p) => {
    // Orchestration step: ensure the active Messenger tab is on a given
    // conversation. `threadId` or `threadUrl` must be supplied.
    const unknown = allowOnly(p, ['threadId', 'threadUrl']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.threadId && !p.threadUrl) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'threadId or threadUrl required' };
    }
    return { ok: true, payload: p };
  },
  'facebook.search_user': (p) => {
    const unknown = allowOnly(p, ['query']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const q = requireString(p, 'query', 1);
    if (q.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (q as { message: string }).message };
    return { ok: true, payload: p };
  },
  'facebook.start_new_dm': (p) => {
    const unknown = allowOnly(p, ['recipientId', 'recipientHandle', 'text', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.recipientId && !p.recipientHandle) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'recipientId or recipientHandle required' };
    }
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },

  'instagram.reply_comment': (p) => {
    const unknown = allowOnly(p, ['text', 'reply', 'autoSubmit', 'commentText']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'instagram.like_message': (p) => {
    const unknown = allowOnly(p, ['messageText', 'commentText', 'targetText']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    return { ok: true, payload: p };
  },
  'instagram.create_post': (p) => {
    const unknown = allowOnly(p, ['text', 'content', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: p };
  },
  'instagram.continue_thread': (p) => {
    // Instagram Direct DM reply. Requires the tab to be on /direct/t/<thread>.
    const unknown = allowOnly(p, ['text', 'reply', 'content', 'message', 'autoSubmit', 'threadId']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'instagram.open_thread': (p) => {
    const unknown = allowOnly(p, ['threadId', 'threadUrl']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.threadId && !p.threadUrl) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'threadId or threadUrl required' };
    }
    return { ok: true, payload: p };
  },
  'instagram.search_user': (p) => {
    const unknown = allowOnly(p, ['query']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const q = requireString(p, 'query', 1);
    if (q.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (q as { message: string }).message };
    return { ok: true, payload: p };
  },
  'instagram.start_new_dm': (p) => {
    const unknown = allowOnly(p, ['recipientHandle', 'text', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.recipientHandle) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'recipientHandle required' };
    }
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'linkedin.open_thread': (p) => {
    const unknown = allowOnly(p, ['threadId', 'threadUrl']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.threadId && !p.threadUrl) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'threadId or threadUrl required' };
    }
    return { ok: true, payload: p };
  },
  'linkedin.search_user': (p) => {
    const unknown = allowOnly(p, ['query']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    const q = requireString(p, 'query', 1);
    if (q.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (q as { message: string }).message };
    return { ok: true, payload: p };
  },
  'linkedin.start_new_dm': (p) => {
    const unknown = allowOnly(p, ['recipientHandle', 'recipientProfileUrl', 'text', 'autoSubmit']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    if (!p.recipientHandle && !p.recipientProfileUrl) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'recipientHandle or recipientProfileUrl required' };
    }
    const text = requireString(p, 'text', 1);
    if (text.ok !== true) return { ok: false, code: 'INVALID_PAYLOAD', message: (text as { message: string }).message };
    return { ok: true, payload: { ...p, autoSubmit: p.autoSubmit !== false } };
  },
  'linkedin.sync_dm_inbox': (p) => {
    // Opt-in navigate flag so the extension may force /messaging/ when
    // fired from a non-messaging tab. No other fields expected.
    const unknown = allowOnly(p, ['navigate']);
    if (unknown) return { ok: false, code: 'UNKNOWN_FIELD', message: unknown };
    return { ok: true, payload: { navigate: p.navigate === true } };
  },
};

for (const platform of ['linkedin', 'facebook', 'instagram', 'twitter', 'x']) {
  const canonical = platform === 'x' ? 'twitter' : platform;
  const aliases: Array<[string, string]> = [
    ['reply', 'reply_comment'],
    ['react', 'like_message'],
    ['send_dm', 'continue_thread'],
  ];
  for (const [alias, target] of aliases) {
    const validator = VALIDATORS[`${canonical}.${target}`];
    if (validator) VALIDATORS[`${platform}.${alias}`] = validator;
  }
}

export function validateCommandPayload(
  platform: string,
  action: string,
  payload: unknown,
): Validation {
  const key = `${String(platform || '').toLowerCase().trim()}.${String(action || '').toLowerCase().trim()}`;
  const v = VALIDATORS[key];
  if (!v) return { ok: false, code: 'UNKNOWN_COMMAND', message: `No schema for ${key}` };
  return v(payload);
}
