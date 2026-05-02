import { isAuthorSelf, isDmMessageType } from './messageRoles';

export type DmIdentityMessage = {
  platform?: string | null;
  platform_message_id?: string | null;
  message_type?: string | null;
  direction?: string | null;
  content?: string | null;
  author_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type DmThreadIdentityInput = {
  platform: string;
  threadId: string;
  platformThreadId?: string | null;
  threadRawPayload?: Record<string, unknown> | null;
  latestMessage?: DmIdentityMessage | null;
  messages?: DmIdentityMessage[];
};

export type DmThreadIdentity = {
  key: string;
  counterpartyAuthorId: string | null;
  targetIds: string[];
};

function cleanIdentityValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'unknown' || lowered === 'linkedin member' || lowered === 'member') return null;
  return trimmed;
}

function keyValue(value: string): string {
  return value.trim().toLowerCase();
}

function addTarget(targets: string[], value: unknown) {
  const cleaned = cleanIdentityValue(value);
  if (!cleaned) return;
  if (!targets.some((target) => keyValue(target) === keyValue(cleaned))) {
    targets.push(cleaned);
  }
}

function isSelfMessage(message: DmIdentityMessage): boolean {
  const rawPayload = message.raw_payload ?? {};
  return isAuthorSelf({
    platform: message.platform,
    platform_message_id: message.platform_message_id,
    direction: message.direction,
    author_self: rawPayload.author_self as boolean | null | undefined,
    sender_self: rawPayload.sender_self as boolean | null | undefined,
    sender_username: rawPayload.sender_username as string | null | undefined,
    sender_profile_url: rawPayload.sender_profile_url as string | null | undefined,
    content: message.content,
  });
}

function firstThreadParticipantIdentity(input: DmThreadIdentityInput): { kind: string; value: string } | null {
  const rawPayload = input.threadRawPayload ?? {};
  const participantProfileUrl = cleanIdentityValue(rawPayload.participant_profile_url);
  if (participantProfileUrl) return { kind: 'profile', value: participantProfileUrl };

  const participantUsername = cleanIdentityValue(rawPayload.participant_username);
  if (participantUsername) return { kind: 'username', value: participantUsername };

  const participantName = cleanIdentityValue(rawPayload.participant_name);
  if (participantName) return { kind: 'name', value: participantName };

  const platformThreadId = cleanIdentityValue(input.platformThreadId);
  if (platformThreadId) return { kind: 'thread', value: platformThreadId };

  return null;
}

function firstMessageIdentity(messages: DmIdentityMessage[]): {
  kind: string;
  value: string;
  authorId: string | null;
} | null {
  for (const message of messages) {
    if (!isDmMessageType(message.message_type)) continue;
    if (isSelfMessage(message)) continue;

    const authorId = cleanIdentityValue(message.author_id);
    if (authorId) return { kind: 'author', value: authorId, authorId };

    const rawPayload = message.raw_payload ?? {};
    const senderProfileUrl = cleanIdentityValue(rawPayload.sender_profile_url);
    if (senderProfileUrl) return { kind: 'profile', value: senderProfileUrl, authorId: null };

    const senderUsername = cleanIdentityValue(rawPayload.sender_username);
    if (senderUsername) return { kind: 'username', value: senderUsername, authorId: null };

    const senderName = cleanIdentityValue(rawPayload.sender_name);
    if (senderName) return { kind: 'name', value: senderName, authorId: null };
  }

  return null;
}

export function resolveDmThreadIdentity(input: DmThreadIdentityInput): DmThreadIdentity {
  const messages = input.messages?.length
    ? input.messages
    : input.latestMessage
      ? [input.latestMessage]
      : [];
  const targets: string[] = [];
  const threadRawPayload = input.threadRawPayload ?? {};

  addTarget(targets, input.platformThreadId);
  addTarget(targets, threadRawPayload.participant_profile_url);
  addTarget(targets, threadRawPayload.participant_username);
  addTarget(targets, threadRawPayload.participant_name);

  for (const message of messages) {
    if (!isDmMessageType(message.message_type)) continue;
    if (isSelfMessage(message)) continue;
    const rawPayload = message.raw_payload ?? {};
    addTarget(targets, rawPayload.sender_profile_url);
    addTarget(targets, rawPayload.sender_username);
    addTarget(targets, rawPayload.sender_name);
  }

  const messageIdentity = firstMessageIdentity(messages);
  const threadIdentity = firstThreadParticipantIdentity(input);
  const chosen = messageIdentity ?? threadIdentity;

  if (chosen) {
    return {
      key: `${chosen.kind}:${keyValue(chosen.value)}`,
      counterpartyAuthorId: messageIdentity?.authorId ?? null,
      targetIds: targets,
    };
  }

  return {
    key: `thread:${input.threadId}`,
    counterpartyAuthorId: null,
    targetIds: targets,
  };
}
