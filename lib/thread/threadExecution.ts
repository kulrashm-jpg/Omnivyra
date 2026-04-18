export type ThreadExecutionMode = 'manual' | 'auto';

export function getThreadExecutionLabel(mode: ThreadExecutionMode): string {
  return mode === 'auto' ? 'Auto-post when approved' : 'Manual review first';
}

export function getThreadExecutionDescription(mode: ThreadExecutionMode): string {
  if (mode === 'auto') {
    return 'Auto-post can be enabled later as an explicit preference. It should never be the default thread behavior.';
  }
  return 'Edit the sequence, choose the schedule, and post it intentionally. This is the default thread execution mode.';
}
