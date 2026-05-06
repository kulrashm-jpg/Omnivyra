/**
 * Pure rendering helpers for engagement messages.
 *
 * Phase 35-C-1 extraction from ConversationView.tsx. These four functions
 * are stateless: they take inputs and return strings/style classes. No
 * closure over component state. Moving them out of ConversationView is
 * pure structural refactor.
 *
 * The full MessageItem component extraction (which needs ~12 closure
 * dependencies threaded as props) is the next sub-phase and intentionally
 * not done here without prop-interface review.
 */

export function formatTimestamp(
  iso: string | null | undefined,
  displayLabel?: string | null
): string {
  if (displayLabel && displayLabel.trim()) return displayLabel.trim();
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

export function authorDisplay(
  msg: { author_id: string | null; author_display_name?: string | null; author_self?: boolean },
  threadAuthor: string | null
): string {
  if (msg.author_self) return 'You';
  if (msg.author_id === '__self__') return 'You';
  if (msg.author_display_name) return msg.author_display_name;
  if (threadAuthor) return threadAuthor;
  if (msg.author_id) return msg.author_id.slice(0, 8) + '…';
  return 'Unknown';
}

export function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const OTHER_AVATAR_CLASSES = [
  'border-emerald-200 bg-emerald-100 text-emerald-800',
  'border-amber-200 bg-amber-100 text-amber-900',
  'border-rose-200 bg-rose-100 text-rose-800',
  'border-violet-200 bg-violet-100 text-violet-800',
  'border-teal-200 bg-teal-100 text-teal-800',
  'border-orange-200 bg-orange-100 text-orange-800',
  'border-slate-300 bg-slate-100 text-slate-700',
];

export function avatarTone(name: string, isSelf: boolean): string {
  if (isSelf) return 'border-blue-200 bg-blue-100 text-blue-800';
  // Deterministic color from name — same name always gets same hue.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash << 5) - hash + name.charCodeAt(i);
  return OTHER_AVATAR_CLASSES[Math.abs(hash) % OTHER_AVATAR_CLASSES.length];
}
