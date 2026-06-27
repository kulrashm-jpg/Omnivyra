/**
 * @jest-environment jsdom
 */
import {
  createAttachmentSession,
  loadAttachmentSession,
  attachAssetToSession,
  resolveReturnDestination,
} from '../../../lib/content/creatorAttachmentSession';
import { buildWriterCreatorPrefill, getWriterCreatorPrefillKey, type WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';
import { resolveCreatorAsset } from '../../../lib/content/creatorAssetResolver';
import { listAssetsForConsumer, listConsumers, writerDraftConsumer } from '../../../lib/content/creatorAssetUsageGraph';

const lc = buildWriterCreatorPrefill({ sourceType: 'post', sourceId: 'post:draft', assetType: 'supporting_image', title: 'T', body: 'Body text', platform: 'linkedin' });

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

describe('CreatorAttachmentSession — single lifecycle owner', () => {
  it('createAttachmentSession persists ONE consolidated object (launch ctx + return + draft)', () => {
    const s = createAttachmentSession({ launchContext: lc, returnDestination: '/multi-platform-scheduler?x=1', assetType: 'supporting_image', token: 'tk1', now: '2026-06-26T00:00:00.000Z' });
    expect(s.token).toBe('tk1');
    expect(s.source).toBe('writer');
    expect(s.launchContext).toBe(lc);
    expect(s.returnDestination).toBe('/multi-platform-scheduler?x=1');
    expect(s.draft).toEqual({ sourceType: 'post', sourceId: 'post:draft', companyId: null });
    expect(s.attachmentState).toBe('pending');
    // exactly one storage key, and it round-trips
    const keys = Object.keys(window.sessionStorage).filter((k) => k.includes('attachment_session'));
    expect(keys).toEqual(['creator_attachment_session_tk1']);
    expect(loadAttachmentSession('tk1')!.returnDestination).toBe('/multi-platform-scheduler?x=1');
  });

  it('attachAssetToSession registers in the library + stores a REF only; regenerate adds a version', async () => {
    createAttachmentSession({ launchContext: lc, returnDestination: '/w', assetType: 'supporting_image', token: 'tk2' });
    const a1: WriterAttachedAsset = { id: 'a1', creatorType: 'supporting_image', title: 'A1', url: 'u1', createdAt: 'x' };
    const a2: WriterAttachedAsset = { id: 'a2', creatorType: 'supporting_image', title: 'A2', url: 'u2', createdAt: 'y' };
    await attachAssetToSession('tk2', a1, { now: '2026-06-26T00:00:01.000Z' });
    let s = loadAttachmentSession('tk2')!;
    expect(s.attachmentState).toBe('attached');
    expect(s.selectedRef).toEqual({ assetId: 'a1', version: 1, selectedVariant: null });
    expect(s.assets.length).toBe(1);
    // session holds a REFERENCE, not the payload
    expect((s.assets[0] as Record<string, unknown>).url).toBeUndefined();
    expect((s.assets[0] as Record<string, unknown>).title).toBeUndefined();
    expect(s.regenerationHistory.length).toBe(1);

    // regenerate → a new VERSION of the SAME library asset (same id, not a replacement)
    await attachAssetToSession('tk2', a2, { now: '2026-06-26T00:00:02.000Z' });
    s = loadAttachmentSession('tk2')!;
    expect(s.selectedRef).toEqual({ assetId: 'a1', version: 2, selectedVariant: null });
    expect(s.regenerationHistory.length).toBe(2);
    expect(s.replacementHistory.length).toBe(0);

    // refs resolve to library payloads; older version still retrievable
    expect((await resolveCreatorAsset(s.selectedRef))!.url).toBe('u2');
    expect((await resolveCreatorAsset({ assetId: 'a1', version: 1 }))!.url).toBe('u1');

    // the session delegated the relationship to the canonical usage graph
    const consumer = writerDraftConsumer('post', 'post:draft');
    expect((await listAssetsForConsumer(consumer)).map((r) => r.assetId)).toEqual(['a1']);
    expect((await listConsumers('a1')).map((c) => `${c.type}:${c.id}`)).toEqual(['writer-draft:post:post:draft']);
  });

  it('resolveReturnDestination is owned by the session (internal paths only)', () => {
    createAttachmentSession({ launchContext: lc, returnDestination: '/multi-platform-scheduler', assetType: 'supporting_image', token: 'tk3' });
    expect(resolveReturnDestination('tk3')).toBe('/multi-platform-scheduler');
    createAttachmentSession({ launchContext: lc, returnDestination: 'https://evil.example', assetType: 'supporting_image', token: 'tk4' });
    expect(resolveReturnDestination('tk4')).toBeNull(); // external rejected
  });

  it('legacy prefill key still resolves into a session (back-compat)', () => {
    window.sessionStorage.setItem(getWriterCreatorPrefillKey('legacy1'), JSON.stringify(lc));
    const s = loadAttachmentSession('legacy1');
    expect(s).not.toBeNull();
    expect(s!.launchContext.sourceId).toBe('post:draft');
    expect(s!.assetType).toBe('supporting_image');
  });
});
