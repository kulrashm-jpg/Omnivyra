/**
 * Renders message text with @mentions highlighted.
 * Feature 2: Highlight @username in message text.
 */
import React from 'react';

const MENTION_REGEX = /@([a-zA-Z0-9_.-]+)/g;

export function renderMessageWithMentions(text: string): React.ReactNode[] {
  if (!text || typeof text !== 'string') return [text];
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_REGEX.source, 'g');
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="font-semibold text-indigo-600 bg-indigo-50 px-0.5 rounded">
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

/** Renders message text with @mentions highlighted. Feature 2. */
export default function MentionHighlight({ text }: { text: string }) {
  return <>{renderMessageWithMentions(text)}</>;
}
