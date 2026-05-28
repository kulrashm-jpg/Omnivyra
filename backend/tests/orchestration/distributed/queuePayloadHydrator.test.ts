/**
 * Phase 23B — QueuePayloadHydrator unit tests.
 */

import {
  createQueuePayloadHydrator,
  QueuePayloadHydrationError,
  validateQueuePayloadShape,
} from '../../../services/orchestration/distributed/queuePayloadHydrator';
import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';
import {
  createInMemoryExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
} from '../../../services/threadRuntime/durableExecutionCoordinator';
import {
  createCheckpointRestorationEngine,
} from '../../../services/orchestration/recovery/checkpointRestorationEngine';
import type { QueuePayloadV1 } from '../../../services/orchestration/distributed/workflowExecutionTypes';

async function buildHarness() {
  const store = createInMemoryExecutionStore();
  const coord = createDurableExecutionCoordinator({ store });
  const queue = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
  const restoration = createCheckpointRestorationEngine({ store, telemetry: { emit: () => {} } });
  const hydrator = createQueuePayloadHydrator({
    durableExecution: coord,
    checkpointRestoration: restoration,
    telemetry: { emit: () => {} },
  });
  return { store, coord, queue, restoration, hydrator };
}

async function seedExec(h: Awaited<ReturnType<typeof buildHarness>>) {
  return h.coord.start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
}

function makePayload(over: Partial<QueuePayloadV1> & Pick<QueuePayloadV1, 'executionId' | 'companyId'>): QueuePayloadV1 {
  return {
    schemaVersion: 1, workflowType: 'content_generation',
    workflowParams: { stepIds: ['s1'] },
    ...over,
  };
}

describe('validateQueuePayloadShape', () => {
  test('null payload → missing_payload', () => {
    expect(validateQueuePayloadShape(null).code).toBe('missing_payload');
  });
  test('missing schemaVersion → invalid_schema', () => {
    expect(validateQueuePayloadShape({ workflowType: 'recovery', executionId: 'e', companyId: 'co' }).code).toBe('invalid_schema');
  });
  test('schemaVersion=99 → unsupported_schema_version', () => {
    expect(validateQueuePayloadShape({ schemaVersion: 99, workflowType: 'recovery', executionId: 'e', companyId: 'co' }).code).toBe('unsupported_schema_version');
  });
  test('unknown workflowType', () => {
    expect(validateQueuePayloadShape({ schemaVersion: 1, workflowType: 'bogus', executionId: 'e', companyId: 'co' }).code).toBe('unknown_workflow_type');
  });
  test('missing executionId → invalid_schema', () => {
    expect(validateQueuePayloadShape({ schemaVersion: 1, workflowType: 'recovery', companyId: 'co' }).code).toBe('invalid_schema');
  });
  test('idempotencyHints with bad class → idempotency_keys_invalid', () => {
    expect(validateQueuePayloadShape({
      schemaVersion: 1, workflowType: 'recovery', executionId: 'e', companyId: 'co',
      idempotencyHints: [{ stepId: 's', cls: 'bogus', semanticParts: [] }],
    }).code).toBe('idempotency_keys_invalid');
  });
  test('well-formed payload → ok', () => {
    expect(validateQueuePayloadShape({
      schemaVersion: 1, workflowType: 'content_generation', executionId: 'e', companyId: 'co',
    }).code).toBe('ok');
  });
});

describe('QueuePayloadHydrator', () => {
  test('hydrate succeeds for a well-formed payload + live execution', async () => {
    const h = await buildHarness();
    const exec = await seedExec(h);
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId,
      kind: 'execution_start',
      payload: makePayload({ executionId: exec.executionId, companyId: exec.companyId }) as unknown as Record<string, unknown>,
    });
    const hydrated = await h.hydrator.hydrate(entry);
    expect(hydrated.execution.executionId).toBe(exec.executionId);
    expect(hydrated.payload.schemaVersion).toBe(1);
  });

  test('hydrate throws for malformed payload', async () => {
    const h = await buildHarness();
    const exec = await seedExec(h);
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId,
      kind: 'execution_start',
      // Missing schemaVersion.
      payload: { workflowType: 'recovery', executionId: exec.executionId, companyId: exec.companyId } as unknown as Record<string, unknown>,
    });
    await expect(h.hydrator.hydrate(entry)).rejects.toBeInstanceOf(QueuePayloadHydrationError);
  });

  test('hydrate refuses execution_id_mismatch', async () => {
    const h = await buildHarness();
    const exec = await seedExec(h);
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId,
      kind: 'execution_start',
      payload: makePayload({ executionId: 'WRONG_ID', companyId: exec.companyId }) as unknown as Record<string, unknown>,
    });
    const { hydrated, validation } = await h.hydrator.hydrateOrNull(entry);
    expect(hydrated).toBeNull();
    expect(validation.code).toBe('execution_id_mismatch');
  });

  test('hydrate refuses when execution is missing', async () => {
    const h = await buildHarness();
    const entry = await h.queue.enqueue({
      executionId: 'ghost', companyId: 'co',
      kind: 'execution_start',
      payload: makePayload({ executionId: 'ghost', companyId: 'co' }) as unknown as Record<string, unknown>,
    });
    const { validation } = await h.hydrator.hydrateOrNull(entry);
    expect(validation.code).toBe('execution_missing');
  });

  test('hydrate refuses terminal execution (completed)', async () => {
    const h = await buildHarness();
    const exec = await seedExec(h);
    await h.coord.transition({ executionId: exec.executionId, to: 'running' });
    await h.coord.transition({ executionId: exec.executionId, to: 'completed' });
    const entry = await h.queue.enqueue({
      executionId: exec.executionId, companyId: exec.companyId,
      kind: 'execution_start',
      payload: makePayload({ executionId: exec.executionId, companyId: exec.companyId }) as unknown as Record<string, unknown>,
    });
    const { validation } = await h.hydrator.hydrateOrNull(entry);
    expect(validation.code).toBe('stale_execution');
  });
});
