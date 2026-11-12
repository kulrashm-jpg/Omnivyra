/**
 * CLASS-2 C3 (e9 sweep; 55 approved the design, 2026-11-12): a WhatsApp engine request's claim is
 * FENCED, so a sweep that stalled past STALE_SUBMISSION_MS can never send a second message.
 *
 * The race: sweep A claims (requested -> submitting) and stalls. Sweep B sees the claim stale,
 * finds no broadcast, releases it; B (or C) claims, creates wf:<task> and sends. A wakes and
 * created a SECOND wf:<task> broadcast and queued it - the person messaged twice.
 *   FENCE 1: right before the enqueue, A proves the claim is still its own (CAS on
 *            state=submitting AND the updated_at read right after its claim). Lost -> no enqueue.
 *   FENCE 2: B's stale release is pinned to the stale updated_at it READ, so it cannot release a
 *            claim A has just refreshed.
 * Each fence alone leaves a double send (55); both are pinned here, each by its own case.
 *
 * REAL: createWhatsAppAdapter / createCommunityAdapter. The request ledger is a STRICT double of
 * execution_engine_requests: compare-and-set on state, the updated_at pin when given, and the
 * guard trigger's updated_at := now() on EVERY update as a fresh MICROSECOND string (the raw form
 * PostgREST returns) - a fake that kept updated_at still would let every fence pass.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no database in this suite'); }, ownedDbRpc: () => { throw new Error('no database'); } }));

import {
  STALE_SUBMISSION_MS,
  broadcastNameFor,
  createWhatsAppAdapter,
  defaultWhatsAppDeps,
  type WhatsAppAdapterDeps,
} from '../../services/orchestration/whatsappEngineAdapter';
import { createCommunityAdapter, defaultCommunityDeps, type CommunityAdapterDeps } from '../../services/orchestration/communityEngineAdapter';
import type { EngineStepContext } from '../../services/orchestration/engineAdapters';

const ORG = '0b000000-0000-4000-8000-000000000001';
const TASK = '0b000000-0000-4000-8000-0000000000a1';
const T0 = '2026-11-12T10:00:00.000Z';

type State = 'requested' | 'submitting' | 'submitted' | 'completed' | 'skipped' | 'failed' | 'uncertain';
interface Req { id: string; state: State; external_ref: string | null; detail: string | null; updated_at: string }

let clock: string;
let seq: number;
let row: Req | null;
let broadcasts: Array<{ id: string; name: string }>;
let enqueued: string[];
/** Runs once, inside the named dep, before it answers: the interleaving point. */
let hooks: Partial<Record<'createBroadcast' | 'expandPersonRecipients' | 'findBroadcastByName' | 'enqueueBroadcast', () => Promise<void>>>;

/** The trigger: every update gets a fresh microsecond value on the test clock. */
const touch = (): string => `${clock.slice(0, 19)}.${String(++seq).padStart(6, '0')}+00:00`;
const later = (ms: number) => { clock = new Date(Date.parse(clock) + ms).toISOString(); };
const runHook = async (k: keyof typeof hooks) => { const h = hooks[k]; if (h) { delete hooks[k]; await h(); } };

const ledger: Pick<WhatsAppAdapterDeps, 'getOrCreateRequest' | 'transitionRequest'> = {
  async getOrCreateRequest() {
    if (!row) row = { id: 'req-1', state: 'requested', external_ref: null, detail: null, updated_at: touch() };
    return { ...row };
  },
  async transitionRequest(_o, _t, from, patch, _claim, expectUpdatedAt) {
    if (!row || row.state !== from) return false;
    if (expectUpdatedAt !== undefined && row.updated_at !== expectUpdatedAt) return false;
    Object.assign(row, patch, { updated_at: touch() });
    return true;
  },
};

const deps = (over: Partial<WhatsAppAdapterDeps> = {}): WhatsAppAdapterDeps => ({
  ...ledger,
  async findBroadcastByName(_o, name) {
    const found = broadcasts.find((b) => b.name === name)?.id ?? null; // answered BEFORE the hook runs
    await runHook('findBroadcastByName');
    return found;
  },
  readPersonPhone: async () => '+14155552671',
  findWhatsAppAccount: async () => ({ id: 'sa-1' }),
  createBroadcast: (async (input: { name: string }) => {
    await runHook('createBroadcast');
    const id = `bc-${broadcasts.length + 1}`;
    broadcasts.push({ id, name: input.name });
    return id;
  }) as never,
  expandPersonRecipients: (async () => { await runHook('expandPersonRecipients'); return { inserted: 1, skipped: 0 }; }) as never,
  enqueueBroadcast: (async (id: string) => { await runHook('enqueueBroadcast'); enqueued.push(id); return { run_id: 'r', batches: 1, recipients: 1 }; }) as never,
  readRecipientStatus: async () => 'pending',
  hasApproval: async () => true,
  channelRefusal: async () => null,
  ...over,
});

const ctx = (): EngineStepContext => ({
  organizationId: ORG, executionInstanceId: 'inst-1', executionTaskId: TASK, planStepId: 'step-1', channel: 'whatsapp',
  subject: { kind: 'prospect', id: 'p-1' } as never,
  step: { key: 'wa', channel: 'whatsapp', delay_after_previous_hours: 0, whatsapp: { template_name: 'tpl' } } as never,
  personId: 'person-1', now: clock,
});
const sweep = (over: Partial<WhatsAppAdapterDeps> = {}) => createWhatsAppAdapter(deps(over)).execute(ctx());

beforeEach(() => {
  clock = T0; seq = 0; row = null; broadcasts = []; enqueued = []; hooks = {};
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('WhatsApp engine request: a stalled sweep never sends a second message', () => {
  it('(d) NEGATIVE CONTROL: one sweep, no interleaving -> exactly one broadcast queued, the request submitted', async () => {
    const r = await sweep();
    expect(r).toMatchObject({ outcome: 'submitted' });
    expect(enqueued).toEqual(['bc-1']);
    expect(row).toMatchObject({ state: 'submitted', external_ref: 'bc-1' });
  });

  it('(a) A stalls before creating; B releases and C sends; A wakes -> FENCE 1 fails and A queues NOTHING', async () => {
    hooks.createBroadcast = async () => {
      // A is stalled here (claimed, nothing created). Time passes; B releases, then C claims and sends.
      later(STALE_SUBMISSION_MS + 60_000);
      const b = await sweep();                                      // B: stale + no broadcast -> release -> claims, sends
      expect(b).toMatchObject({ outcome: 'submitted' });
    };
    const a = await sweep();
    expect(a).toMatchObject({ outcome: 'claim_lost', disposition: 'wait' });
    expect(enqueued).toEqual(['bc-1']);                             // B/C's only; A's draft (bc-2) never queued
    expect(broadcasts.map((b) => b.name)).toEqual([broadcastNameFor(TASK), broadcastNameFor(TASK)]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('claim lost before enqueue'), expect.objectContaining({ draft_broadcast_id: 'bc-2' }));
    expect(row).toMatchObject({ state: 'submitted', external_ref: 'bc-1' });
  });

  it('(b) B found no broadcast; A then creates and passes FENCE 1; B releases -> FENCE 2 refuses it; ONE send', async () => {
    // A: claims, then pauses before creating. B: reads the stale claim, its lookup answers "none".
    // Then A creates its broadcast and passes fence 1 (refreshing its claim), and pauses INSIDE the
    // enqueue - the window 55 named: state is still `submitting`, so a state-only release succeeds.
    let resumeCreate!: () => void;
    let resumeEnqueue!: () => void;
    let aAtEnqueue!: () => void;
    const aPaused = new Promise<void>((r) => { hooks.createBroadcast = () => new Promise<void>((go) => { resumeCreate = go; r(); }); });
    const aReachedEnqueue = new Promise<void>((r) => { aAtEnqueue = r; });
    hooks.enqueueBroadcast = () => new Promise<void>((go) => { resumeEnqueue = go; aAtEnqueue(); });
    const a = sweep();
    await aPaused;
    later(STALE_SUBMISSION_MS + 60_000);
    hooks.findBroadcastByName = async () => { resumeCreate(); await aReachedEnqueue; };
    const b = await sweep();                                        // B's release lands here
    resumeEnqueue();
    expect(await a).toMatchObject({ outcome: 'submitted' });
    expect(b).toMatchObject({ outcome: 'submitting', disposition: 'wait' });
    expect(enqueued).toEqual(['bc-1']);
    expect(broadcasts).toHaveLength(1);
    expect(row).toMatchObject({ state: 'submitted', external_ref: 'bc-1' });
  });

  it('(c) A created its broadcast, B settles the request uncertain, A wakes -> FENCE 1 fails: uncertain means A queued nothing', async () => {
    hooks.expandPersonRecipients = async () => {
      later(STALE_SUBMISSION_MS + 60_000);
      const b = await sweep();                                      // B finds A's broadcast -> uncertain, never released
      expect(b).toMatchObject({ outcome: 'submission_interrupted', disposition: 'needs_human' });
    };
    const a = await sweep();
    expect(a).toMatchObject({ outcome: 'claim_lost' });
    expect(enqueued).toEqual([]);
    expect(row).toMatchObject({ state: 'uncertain' });
  });

  it('the claim cannot be read back (no token): nothing is created or queued - fail closed, never treated as "mine"', async () => {
    let reads = 0;
    const r = await sweep({
      getOrCreateRequest: async (o, t) => { reads += 1; if (reads === 2) throw new Error('unreadable'); return ledger.getOrCreateRequest(o, t); },
    });
    expect(r).toMatchObject({ outcome: 'claim_unfenced', disposition: 'wait' });
    expect(broadcasts).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('the token is the RAW microsecond string: the fence matches it exactly (a millisecond round-trip would never match)', async () => {
    const seen: Array<string | undefined> = [];
    await sweep({ transitionRequest: async (o, t, f, p, c, e) => { seen.push(e); return ledger.transitionRequest(o, t, f, p, c, e); } });
    const fence = seen.find((e) => e !== undefined)!;
    expect(fence).toMatch(/\.\d{6}\+00:00$/);
    expect(enqueued).toEqual(['bc-1']);
  });
});

describe('the shared contract: the updated_at pin is honoured on the generic path and REFUSED on the claim path', () => {
  it.each([
    ['whatsapp', defaultWhatsAppDeps.transitionRequest.bind(defaultWhatsAppDeps)],
    ['community', defaultCommunityDeps.transitionRequest.bind(defaultCommunityDeps)],
  ] as const)('%s: a claim (requested -> submitting) with expectUpdatedAt throws, before any database call', async (_l, transition) => {
    await expect(transition(ORG, TASK, 'requested', { state: 'submitting' }, {}, '2026-11-12T10:00:00.000001+00:00'))
      .rejects.toThrow('expectUpdatedAt is not supported on the claim path');
  });
});

describe('community engine: the stale release is pinned to the claim it read (55)', () => {
  const communityCtx = (): EngineStepContext => ({ ...ctx(), channel: 'community' as never, step: { key: 'c', channel: 'community', delay_after_previous_hours: 0 } as never });
  const staleRead = (): Req => ({ id: 'req-1', state: 'submitting', external_ref: null, detail: null, updated_at: `${T0.slice(0, 19)}.000001+00:00` });

  it('the claim moved between the read and the release (a fresh updated_at): NOT released', async () => {
    row = { ...staleRead(), updated_at: `${T0.slice(0, 19)}.000002+00:00` };   // the holder refreshed it
    later(STALE_SUBMISSION_MS + 60_000);
    const adapter = createCommunityAdapter({ ...ledger, getOrCreateRequest: async () => staleRead() } as unknown as CommunityAdapterDeps);
    const r = await adapter.execute(communityCtx());
    expect(r).toMatchObject({ outcome: 'submitting', disposition: 'wait' });
    expect(row.state).toBe('submitting');
  });

  it('NEGATIVE CONTROL: still the stale claim that was read -> released', async () => {
    row = staleRead();
    later(STALE_SUBMISSION_MS + 60_000);
    const adapter = createCommunityAdapter({ ...ledger, getOrCreateRequest: async () => staleRead() } as unknown as CommunityAdapterDeps);
    await adapter.execute(communityCtx()).catch(() => undefined);   // the run continues past the release; only the release is asserted
    expect(row.state).not.toBe('submitting');
  });
});
