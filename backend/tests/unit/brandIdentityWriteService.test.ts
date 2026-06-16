import {
  createDraft, updateDraft, previewBrand, publishDraft, rollbackPublished,
  type BrandWriteDeps, type BrandIdentityStore, type BrandPointer,
} from '../../services/brand/brandIdentityWriteService';
import type { BrandIdentityRow, BrandRuntime } from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';

function makeFakeStore() {
  const versions = new Map<string, BrandIdentityRow>();
  let pointer: BrandPointer | null = null;
  const key = (c: string, v: number) => `${c}:${v}`;
  const store: BrandIdentityStore = {
    async getPointer() { return pointer; },
    async getVersion(c, v) { return versions.get(key(c, v)) ?? null; },
    async nextVersion(c) {
      let max = 0;
      for (const k of versions.keys()) if (k.startsWith(`${c}:`)) max = Math.max(max, Number(k.split(':')[1]));
      return max + 1;
    },
    async insertVersion(c, row) { versions.set(key(c, row.version), { ...row }); },
    async updateVersionVoice(c, v, patch) {
      const r = versions.get(key(c, v));
      if (r) versions.set(key(c, v), { ...r, voice: patch.voice, tagline: patch.tagline });
    },
    async setPublished(c, v, iso) {
      const r = versions.get(key(c, v));
      if (r) versions.set(key(c, v), { ...r, status: 'published', published_at: iso });
    },
    async upsertPointer(c, p) {
      pointer = {
        published_version: 'published_version' in p ? p.published_version ?? null : pointer?.published_version ?? null,
        draft_version: 'draft_version' in p ? p.draft_version ?? null : pointer?.draft_version ?? null,
      };
    },
  };
  return { store, versions, getPointer: () => pointer };
}

function makeDeps(over: Partial<BrandWriteDeps> = {}) {
  const fake = makeFakeStore();
  const invalidated: string[] = [];
  const deps: BrandWriteDeps = {
    store: fake.store,
    loadProfile: async () => ({ brandVoice: 'warm, plain', brandVoiceList: ['warm', 'plain'], brandPositioning: 'POS', keyMessages: 'KM', targetAudience: 'AUD' }),
    invalidate: (id) => { invalidated.push(id); },
    nowIso: () => NOW,
    ...over,
  };
  return { deps, fake, invalidated };
}

describe('brandIdentityWriteService', () => {
  it('createDraft prefills voice for parity + surfaces (does not persist) messaging context', async () => {
    const { deps, fake } = makeDeps();
    const r = await createDraft('co1', deps);
    expect(r.created).toBe(true);
    expect(r.draft.version).toBe(1);
    expect(r.draft.status).toBe('draft');
    expect((r.draft.voice as { tone?: string }).tone).toBe('warm, plain'); // voice parity
    expect((r.draft.voice as { descriptors?: string[] }).descriptors).toEqual(['warm', 'plain']);
    expect(fake.getPointer()).toEqual({ published_version: null, draft_version: 1 });
    // messaging surfaced but NOT in the persisted row
    expect(r.prefillContext).toEqual({ brand_positioning: 'POS', key_messages: 'KM', target_audience: 'AUD' });
    expect(JSON.stringify(r.draft)).not.toContain('POS');
  });

  it('createDraft returns the existing draft instead of a second one', async () => {
    const { deps } = makeDeps();
    await createDraft('co1', deps);
    const second = await createDraft('co1', deps);
    expect(second.created).toBe(false);
    expect(second.draft.version).toBe(1);
  });

  it('updateDraft writes voice/tagline and ignores visual fields', async () => {
    const { deps, fake } = makeDeps();
    await createDraft('co1', deps);
    const { draft } = await updateDraft('co1', {
      voice: { tone: 'dry, contrarian', descriptors: ['dry'] },
      tagline: 'Be bold',
      // visual fields below must be ignored:
      ...({ colors: { palette: ['#fff'] }, typography: { bodyFont: 'Poppins' } } as Record<string, unknown>),
    }, deps);
    expect((draft.voice as { tone?: string }).tone).toBe('dry, contrarian');
    expect(draft.tagline).toBe('Be bold');
    expect(JSON.stringify(draft)).not.toContain('Poppins');
    expect(JSON.stringify(fake.versions.get('co1:1'))).not.toContain('#fff');
  });

  it('updateDraft throws when no draft exists', async () => {
    const { deps } = makeDeps();
    await expect(updateDraft('co1', { tagline: 'x' }, deps)).rejects.toThrow('no_draft');
  });

  it('preview resolves the draft + invalidates cache (no publish)', async () => {
    const resolveCalls: Array<{ preview?: boolean }> = [];
    const fakeRt = { meta: { source: 'brand_identity', status: 'draft' } } as unknown as BrandRuntime;
    const { deps, fake, invalidated } = makeDeps({ resolve: async (_id, opts) => { resolveCalls.push(opts ?? {}); return fakeRt; } });
    await createDraft('co1', deps);
    const rt = await previewBrand('co1', deps);
    expect(rt).toBe(fakeRt);
    expect(resolveCalls).toEqual([{ preview: true }]);
    expect(invalidated).toContain('co1');
    expect(fake.getPointer()?.published_version).toBeNull(); // not published
  });

  it('publishDraft moves the pointer, clears draft, invalidates cache', async () => {
    const { deps, fake, invalidated } = makeDeps();
    await createDraft('co1', deps);
    const r = await publishDraft('co1', deps);
    expect(r.publishedVersion).toBe(1);
    expect(fake.getPointer()).toEqual({ published_version: 1, draft_version: null });
    expect(fake.versions.get('co1:1')?.status).toBe('published');
    expect(invalidated).toContain('co1');
  });

  it('rollbackPublished flips the pointer only (no row mutation) + invalidates', async () => {
    const { deps, fake, invalidated } = makeDeps();
    await createDraft('co1', deps);      // v1 draft
    await publishDraft('co1', deps);     // publish v1
    await createDraft('co1', deps);      // v2 draft
    await publishDraft('co1', deps);     // publish v2 → published_version 2
    expect(fake.getPointer()?.published_version).toBe(2);
    const before = JSON.stringify(fake.versions.get('co1:1'));
    await rollbackPublished('co1', 1, deps);
    expect(fake.getPointer()?.published_version).toBe(1);
    expect(JSON.stringify(fake.versions.get('co1:1'))).toBe(before); // no mutation
    expect(invalidated.filter((x) => x === 'co1').length).toBeGreaterThanOrEqual(3); // 2 publishes + rollback
  });

  it('rollback to a non-existent version throws', async () => {
    const { deps } = makeDeps();
    await expect(rollbackPublished('co1', 99, deps)).rejects.toThrow('version_not_found');
  });
});
