/**
 * executionTaskModel.ts — deterministic execution-task model (CKRE-004 §8/§9).
 *
 * PURE. Models orchestration work as tasks with priority, idempotency-keyed
 * deduplication, retry, dead-letter, resume, cancel, and stuck/timeout recovery.
 * It is NOT a new queue — it is the deterministic task/state model that the
 * orchestrator persists (ledger) and that an adapter can hand to the EXISTING
 * BullMQ queues for execution.
 */

export type TaskState =
  | 'PENDING'
  | 'RUNNING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER'
  | 'CANCELLED';

export type TaskType = 'knowledge_refresh' | 'downstream_invalidation' | 'rollback_restore' | 'consumer_regenerate';

export interface ExecutionTask {
  /** Idempotency key — dedupes identical work (companyId:type:version:node). */
  id: string;
  companyId: string;
  type: TaskType;
  /** Target node/scope this task acts on (e.g. a dependency node or 'all'). */
  target: string;
  priority: number;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

const TRANSITIONS: Readonly<Record<TaskState, ReadonlyArray<TaskState>>> = {
  PENDING:     ['RUNNING', 'CANCELLED'],
  RUNNING:     ['COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED'],
  RETRYING:    ['RUNNING', 'DEAD_LETTER', 'CANCELLED'],
  FAILED:      ['RETRYING', 'DEAD_LETTER'],
  COMPLETED:   [],
  DEAD_LETTER: [],
  CANCELLED:   [],
};

export function canTaskTransition(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}
export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTaskTransition(from, to)) throw new Error(`ILLEGAL_TASK_TRANSITION:${from}->${to}`);
}

export interface MakeTaskInput {
  companyId: string;
  type: TaskType;
  target: string;
  priority: number;
  version?: number | null;
  maxAttempts?: number;
  timeoutMs?: number;
  now: string;
}

/** Deterministic idempotency key — identical work yields the identical id. */
export function taskIdempotencyKey(companyId: string, type: TaskType, target: string, version?: number | null): string {
  return `${companyId}:${type}:${target}:${version ?? 'na'}`;
}

export function makeTask(input: MakeTaskInput): ExecutionTask {
  return {
    id: taskIdempotencyKey(input.companyId, input.type, input.target, input.version ?? null),
    companyId: input.companyId,
    type: input.type,
    target: input.target,
    priority: input.priority,
    state: 'PENDING',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    timeoutMs: input.timeoutMs ?? 5 * 60 * 1000,
    createdAt: input.now,
    startedAt: null,
    finishedAt: null,
    lastError: null,
  };
}

/** Deduplicate tasks by idempotency key, keeping the highest priority (lowest number). */
export function dedupeTasks(tasks: ExecutionTask[]): ExecutionTask[] {
  const byId = new Map<string, ExecutionTask>();
  for (const t of tasks) {
    const existing = byId.get(t.id);
    if (!existing || t.priority < existing.priority) byId.set(t.id, t);
  }
  // Deterministic order: priority asc, then id.
  return Array.from(byId.values()).sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
}

/** Mark a task started. Pure — returns a new task. */
export function startTask(task: ExecutionTask, now: string): ExecutionTask {
  assertTaskTransition(task.state, 'RUNNING');
  return { ...task, state: 'RUNNING', attempts: task.attempts + 1, startedAt: now };
}

/** Mark a task completed. */
export function completeTask(task: ExecutionTask, now: string): ExecutionTask {
  assertTaskTransition(task.state, 'COMPLETED');
  return { ...task, state: 'COMPLETED', finishedAt: now };
}

/**
 * Fail a task and deterministically decide retry vs dead-letter based on attempts.
 * attempts < maxAttempts → RETRYING; else DEAD_LETTER.
 */
export function failTask(task: ExecutionTask, error: string, now: string): ExecutionTask {
  const toDead = task.attempts >= task.maxAttempts;
  return {
    ...task,
    state: toDead ? 'DEAD_LETTER' : 'RETRYING',
    finishedAt: toDead ? now : null,
    lastError: error,
  };
}

export function cancelTask(task: ExecutionTask, now: string): ExecutionTask {
  if (task.state === 'COMPLETED' || task.state === 'DEAD_LETTER') return task; // terminal — no-op
  return { ...task, state: 'CANCELLED', finishedAt: now };
}

/** A RUNNING task that exceeded its timeout is stuck. */
export function isStuck(task: ExecutionTask, nowMs: number): boolean {
  if (task.state !== 'RUNNING' || !task.startedAt) return false;
  const started = Date.parse(task.startedAt);
  return Number.isFinite(started) && nowMs - started > task.timeoutMs;
}

/** Recover a stuck task: retry (if attempts left) or dead-letter. Deterministic. */
export function recoverStuck(task: ExecutionTask, now: string): ExecutionTask {
  const toDead = task.attempts >= task.maxAttempts;
  return {
    ...task,
    state: toDead ? 'DEAD_LETTER' : 'RETRYING',
    finishedAt: toDead ? now : null,
    lastError: 'stuck_timeout_recovered',
  };
}

/** Tasks eligible to (re)run: PENDING or RETRYING, priority order. */
export function runnableTasks(tasks: ExecutionTask[]): ExecutionTask[] {
  return tasks
    .filter((t) => t.state === 'PENDING' || t.state === 'RETRYING')
    .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
}
