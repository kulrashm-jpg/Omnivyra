/**
 * WS-2B-validate — Registration readiness / stress & lifecycle validation (Zone A2).
 *
 * Hardening proof BEFORE any producer adopts the pipeline: concurrent + repeated
 * registrations, replay collapse, full lifecycle traversal, forward-only + invalid
 * transition handling, and idempotency under fan-out. Deterministic, in-memory.
 */
import {
  createCommunicationRegistrationPipeline,
  createInMemoryCommunicationRegistry,
  createInMemorySemanticRootRegistry,
  inertComparator,
  COMMUNICATION_LIFECYCLE,
  type CommunicationLifecycleState,
  type RegisterCommunicationRequest,
} from '../../services/intelligence/coordination';

const MODE_ENV = 'COORDINATION_REGISTRATION_MODE';
function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[MODE_ENV];
  process.env[MODE_ENV] = mode;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = prev;
  });
}

function makePipeline() {
  return createCommunicationRegistrationPipeline({
    registry: createInMemoryCommunicationRegistry({ comparator: inertComparator }),
    roots: createInMemorySemanticRootRegistry(),
  });
}

const req = (over: Partial<RegisterCommunicationRequest> = {}): RegisterCommunicationRequest => ({
  companyId: 'co-val',
  communicationIntent: 'promote',
  topic: 'q3 launch',
  artifactType: 'post',
  generationStage: 'draft',
  platform: 'linkedin',
  sourceModule: 'campaigns',
  ...over,
});

describe('WS-2B-validate — Phase 1: registration stress', () => {
  it('collapses N concurrent identical registrations to exactly one created row', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const results = await Promise.all(
        Array.from({ length: 25 }, () => p.registerCommunication(req())),
      );
      const created = results.filter((r) => r.ok && r.value.created).length;
      const ids = new Set(results.map((r) => (r.ok ? r.value.record?.id : null)));
      expect(created).toBe(1);            // exactly one real insert
      expect(ids.size).toBe(1);           // all resolved to the same row
    });
  });

  it('repeated sequential registrations never duplicate', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      let firstId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const r = await p.registerCommunication(req());
        expect(r.ok).toBe(true);
        if (r.ok) {
          firstId ??= r.value.record?.id;
          expect(r.value.record?.id).toBe(firstId);
          expect(r.value.created).toBe(i === 0);
        }
      }
    });
  });

  it('distinct identities across a fan-out create distinct rows', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => p.registerCommunication(req({ topic: `topic ${i}` }))),
      );
      const ids = new Set(results.map((r) => (r.ok ? r.value.record?.id : null)));
      expect(ids.size).toBe(20);
      expect(results.every((r) => r.ok && r.value.created)).toBe(true);
    });
  });
});

describe('WS-2B-validate — Phase 2: lifecycle validation', () => {
  it('traverses the full canonical lifecycle forward, each step changed', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const reg = await p.registerCommunication(req());
      if (!reg.ok || !reg.value.record) throw new Error('register failed');
      const id = reg.value.record.id;

      // planned is the seed; advance through the remaining 6 states in order.
      for (const state of COMMUNICATION_LIFECYCLE.slice(1)) {
        const r = await p.advanceLifecycle('co-val', id, state as CommunicationLifecycleState);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.changed).toBe(true);
          expect(r.value.state).toBe(state);
        }
      }
    });
  });

  it('rejects backward transitions as idempotent no-ops (never regresses)', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const reg = await p.registerCommunication(req());
      if (!reg.ok || !reg.value.record) throw new Error('register failed');
      const id = reg.value.record.id;
      await p.advanceLifecycle('co-val', id, 'published');

      for (const back of ['planned', 'generated', 'adapted'] as CommunicationLifecycleState[]) {
        const r = await p.advanceLifecycle('co-val', id, back);
        expect(r.ok && r.value.changed).toBe(false);
        if (r.ok) expect(r.value.state).toBe('published'); // unchanged
      }
    });
  });

  it('treats same-state (incl. archived→archived) as a no-op', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const reg = await p.registerCommunication(req());
      if (!reg.ok || !reg.value.record) throw new Error('register failed');
      const id = reg.value.record.id;

      const same = await p.advanceLifecycle('co-val', id, 'planned');
      expect(same.ok && same.value.changed).toBe(false);

      await p.advanceLifecycle('co-val', id, 'archived');
      const archAgain = await p.advanceLifecycle('co-val', id, 'archived');
      expect(archAgain.ok && archAgain.value.changed).toBe(false);
    });
  });

  it('allows skip-ahead forward transitions (planned → measured)', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const reg = await p.registerCommunication(req());
      if (!reg.ok || !reg.value.record) throw new Error('register failed');
      const r = await p.advanceLifecycle('co-val', reg.value.record.id, 'measured');
      expect(r.ok && r.value.changed).toBe(true);
    });
  });

  it('errors on advancing an unknown communication id', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const r = await p.advanceLifecycle('co-val', 'does-not-exist', 'generated');
      expect(r.ok).toBe(false);
    });
  });

  it('requires a tenant for lifecycle advancement', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const r = await p.advanceLifecycle('', 'any', 'generated');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('TENANT_REQUIRED');
    });
  });
});

describe('WS-2B-validate — Phase 5: API supports a topic-less derived artifact (Creator)', () => {
  it('registers an adapted artifact that inherits its parent root (no topic)', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      // Parent (Writer) registers with a topic.
      const parent = await p.registerCommunication(req({ artifactType: 'post', generationStage: 'generated' }));
      if (!parent.ok || !parent.value.record) throw new Error('parent register failed');
      const parentRootId = parent.value.semanticRootId;

      // Creator's visual — NO topic; inherits the parent's semanticRootId.
      const visual = await p.registerCommunication({
        companyId: 'co-val',
        communicationIntent: 'promote',
        semanticRootId: parentRootId,
        artifactType: 'image',
        generationStage: 'render',
        platform: 'linkedin',
        parentArtifactId: parent.value.record.id,
        contentRef: { kind: 'asset', id: 'render-1' },
        sourceModule: 'creator',
      });
      expect(visual.ok).toBe(true);
      if (!visual.ok) return;
      expect(visual.value.created).toBe(true);
      expect(visual.value.semanticRootId).toBe(parentRootId); // grouped under the same root
      expect(visual.value.record?.artifactType).toBe('image');
    });
  });
});
