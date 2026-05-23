// Snapshot Lifecycle Status Model
//
// Deterministic, metadata-only lifecycle statuses for persisted publish
// snapshots. These statuses describe a snapshot's place in the publishing
// lifecycle — they do NOT gate runtime, enforce transitions, or trigger
// execution. The advisory transition map exists for documentation only.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';

export type SnapshotLifecycleStatus =
  | 'draft_snapshot'
  | 'scheduled_snapshot'
  | 'published_snapshot'
  | 'archived_snapshot'
  | 'invalid_snapshot';

export const SNAPSHOT_LIFECYCLE_STATUSES: readonly SnapshotLifecycleStatus[] = [
  'draft_snapshot',
  'scheduled_snapshot',
  'published_snapshot',
  'archived_snapshot',
  'invalid_snapshot',
];

// Advisory only — NOT enforced. Describes the expected lifecycle shape.
export const SNAPSHOT_LIFECYCLE_TRANSITIONS: Record<SnapshotLifecycleStatus, readonly SnapshotLifecycleStatus[]> = {
  draft_snapshot: ['scheduled_snapshot', 'published_snapshot', 'archived_snapshot', 'invalid_snapshot'],
  scheduled_snapshot: ['published_snapshot', 'archived_snapshot', 'invalid_snapshot'],
  published_snapshot: ['archived_snapshot'],
  archived_snapshot: [],
  invalid_snapshot: [],
};

export function isSnapshotLifecycleStatus(value: unknown): value is SnapshotLifecycleStatus {
  return typeof value === 'string' && (SNAPSHOT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

// Deterministic initial status — derived purely from the snapshot publish intent.
export function deriveInitialSnapshotStatus(snapshot: UniversalPublishSnapshot): SnapshotLifecycleStatus {
  if (snapshot.publishIntent === 'schedule') return 'scheduled_snapshot';
  return 'draft_snapshot';
}

export function isTerminalSnapshotStatus(status: SnapshotLifecycleStatus): boolean {
  return status === 'published_snapshot'
    || status === 'archived_snapshot'
    || status === 'invalid_snapshot';
}

// Advisory check — does NOT block; callers decide. Returns whether the
// transition is part of the documented lifecycle shape.
export function isAdvisedLifecycleTransition(
  from: SnapshotLifecycleStatus,
  to: SnapshotLifecycleStatus,
): boolean {
  return SNAPSHOT_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function serializeSnapshotLifecycleStatus(status: SnapshotLifecycleStatus): string {
  return [
    '## SNAPSHOT LIFECYCLE STATUS',
    `Status: ${status}`,
    `Terminal: ${isTerminalSnapshotStatus(status)}`,
    `Advised transitions: ${SNAPSHOT_LIFECYCLE_TRANSITIONS[status].join(', ') || 'none'}`,
  ].join('\n');
}
