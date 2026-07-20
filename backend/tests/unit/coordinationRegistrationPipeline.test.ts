/**
 * WS-2B — Canonical Communication Registration pipeline tests (Zone A2).
 *
 * Proves: one operation (registerCommunication) hides root-ensure + registry +
 * graph membership + observability + future dedup; idempotent / replay-safe (no
 * duplicate rows); lifecycle is monotonic; and the pipeline is a safe no-op when
 * dark. Deterministic, in-memory, no seam, no DB.
 */
import {
  createCommunicationRegistrationPipeline,
  createInMemoryCommunicationRegistry,
  createInMemorySemanticRootRegistry,
  inertComparator,
  deriveIdempotencyKey,
  deriveSemanticRootId,
  COMMUNICATION_LIFECYCLE,
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
    registry: createInMemoryCommunicationRegistry({ comparator: inertComparator, now: () => '2026-07-20T00:00:00.000Z' }),
    roots: createInMemorySemanticRootRegistry({ now: () => '2026-07-20T00:00:00.000Z' }),
  });
}

const req = (over: Partial<RegisterCommunicationRequest> = {}): RegisterCommunicationRequest => ({
  companyId: 'co-2b',
  communicationIntent: 'promote',
  topic: 'launch new pricing',
  artifactType: 'post',
  generationStage: 'draft',
  platform: 'linkedin',
  sourceModule: 'campaigns',
  ...over,
});

describe('WS-2B — registerCommunication (idempotency)', () => {
  it('is a no-op when OFF but still derives stable ids', async () => {
    await withMode('off', async () => {
      const p = makePipeline();
      const r = await p.registerCommunication(req());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.skipped).toBe(true);
      expect(r.value.record).toBeNull();
      expect(r.value.semanticRootId).toBe(deriveSemanticRootId({ companyId: 'co-2b', communicationIntent: 'promote', campaignId: null, topic: 'launch new pricing' }));
      expect(r.value.idempotencyKey).toMatch(/^cidem_[0-9a-f]{24}$/);
    });
  });

  it('registers once, then collapses replays onto the SAME row (no duplicates)', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const first = await p.registerCommunication(req());
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.created).toBe(true);
      expect(first.value.skipped).toBe(false);
      const firstId = first.value.record?.id;

      // Replays (retry / duplicate request) — same identity ⇒ same row, created:false.
      const replay1 = await p.registerCommunication(req());
      const replay2 = await p.registerCommunication(req());
      expect(replay1.ok && replay1.value.created).toBe(false);
      expect(replay2.ok && replay2.value.created).toBe(false);
      if (replay1.ok) expect(replay1.value.record?.id).toBe(firstId);
      if (replay2.ok) expect(replay2.value.record?.id).toBe(firstId);
    });
  });

  it('creates distinct rows for distinct identities', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const a = await p.registerCommunication(req({ topic: 'topic A' }));
      const b = await p.registerCommunication(req({ topic: 'topic B' }));
      expect(a.ok && a.value.created).toBe(true);
      expect(b.ok && b.value.created).toBe(true);
      if (a.ok && b.ok) expect(a.value.record?.id).not.toBe(b.value.record?.id);
    });
  });

  it('honors a caller-supplied idempotencyKey', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const key = 'cidem_customkey';
      const a = await p.registerCommunication(req({ idempotencyKey: key, topic: 'x' }));
      const b = await p.registerCommunication(req({ idempotencyKey: key, topic: 'DIFFERENT topic same key' }));
      expect(a.ok && a.value.created).toBe(true);
      expect(b.ok && b.value.created).toBe(false); // same key ⇒ collapses
      if (a.ok && b.ok) expect(b.value.record?.id).toBe(a.value.record?.id);
    });
  });

  it('requires a tenant', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const r = await p.registerCommunication(req({ companyId: '' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('TENANT_REQUIRED');
    });
  });

  it('ensures a Semantic Root when a seed is supplied', async () => {
    await withMode('shadow', async () => {
      const roots = createInMemorySemanticRootRegistry({ now: () => '2026-07-20T00:00:00.000Z' });
      const p = createCommunicationRegistrationPipeline({
        registry: createInMemoryCommunicationRegistry({ comparator: inertComparator }),
        roots,
      });
      const r = await p.registerCommunication(req({
        root: { businessObjective: 'grow pipeline', positioning: 'value-based', targetAudience: 'RevOps' },
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.rootEnsured).toBe(true);
      const root = await roots.get('co-2b', r.value.semanticRootId);
      expect(root.ok && root.value?.businessObjective).toBe('grow pipeline');
    });
  });

  it('derives ids identically whether OFF or ON (adoption-safe)', async () => {
    const offR = await withMode('off', () => makePipeline().registerCommunication(req()));
    const onR = await withMode('shadow', () => makePipeline().registerCommunication(req()));
    expect(offR.ok && onR.ok).toBe(true);
    if (offR.ok && onR.ok) {
      expect(offR.value.semanticRootId).toBe(onR.value.semanticRootId);
      expect(offR.value.idempotencyKey).toBe(onR.value.idempotencyKey);
    }
  });
});

describe('WS-2B — advanceLifecycle (monotonic)', () => {
  it('advances forward, is idempotent, and never moves backward', async () => {
    await withMode('shadow', async () => {
      const p = makePipeline();
      const reg = await p.registerCommunication(req());
      expect(reg.ok).toBe(true);
      if (!reg.ok || !reg.value.record) return;
      const id = reg.value.record.id;
      expect(reg.value.record.publicationStatus).toBe('planned');

      const toGen = await p.advanceLifecycle('co-2b', id, 'generated');
      expect(toGen.ok && toGen.value.changed).toBe(true);

      // Backward (generated → planned) is a no-op.
      const back = await p.advanceLifecycle('co-2b', id, 'planned');
      expect(back.ok && back.value.changed).toBe(false);
      if (back.ok) expect(back.value.state).toBe('generated');

      // Forward to published, then archived (reachable from anywhere).
      const toPub = await p.advanceLifecycle('co-2b', id, 'published');
      expect(toPub.ok && toPub.value.changed).toBe(true);
      const toArch = await p.advanceLifecycle('co-2b', id, 'archived');
      expect(toArch.ok && toArch.value.changed).toBe(true);
    });
  });

  it('exposes the canonical 7-state lifecycle in order', () => {
    expect(COMMUNICATION_LIFECYCLE).toEqual(['planned', 'generated', 'adapted', 'published', 'engaged', 'measured', 'archived']);
  });
});

describe('WS-2B — deriveIdempotencyKey', () => {
  it('is deterministic for the same identity and varies with it', () => {
    const base = { companyId: 'c', semanticRootId: 'sroot_x', artifactType: 'post', platform: 'linkedin' };
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
    expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, platform: 'x' }));
  });
});
