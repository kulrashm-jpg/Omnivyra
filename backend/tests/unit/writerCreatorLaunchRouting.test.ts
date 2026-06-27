/**
 * @jest-environment jsdom
 */
import {
  buildWriterCreatorPrefill,
  launchCreatorFromWriter,
  POST_CREATOR_ASSET_TYPES_VISIBLE,
} from '../../../lib/content/writerCreatorAssetLaunch';
import { loadAttachmentSession } from '../../../lib/content/creatorAttachmentSession';

describe('Writer Add Asset → canonical Creator workflow routing', () => {
  const mkRouter = () => ({ push: jest.fn(() => Promise.resolve(true)) });
  const source = buildWriterCreatorPrefill({
    sourceType: 'post', sourceId: 'post:draft', assetType: 'supporting_image',
    title: 'My title', body: 'Some post body text here.', platform: 'linkedin',
  });

  it('launches at the TEMPLATE GALLERY via a single CreatorAttachmentSession token', () => {
    const router = mkRouter();
    launchCreatorFromWriter({ router: router as any, assetType: 'supporting_image', source });
    expect(router.push).toHaveBeenCalledTimes(1);
    const arg = router.push.mock.calls[0][0];
    expect(arg.pathname).toBe('/command-center/creator-content/image/templates');
    expect(arg.query.source).toBe('writer');
    expect(typeof arg.query.session).toBe('string');
    // scattered launch params are gone — consolidated into the session object.
    expect(arg.query.prefill).toBeUndefined();
    expect(arg.query.return_to).toBeUndefined();
    expect(arg.query.asset_type).toBeUndefined();
    const sess = loadAttachmentSession(arg.query.session);
    expect(sess).not.toBeNull();
    expect(sess!.assetType).toBe('supporting_image');
    expect(sess!.attachmentMode).toBeTruthy();
    expect(String(sess!.returnDestination)).toMatch(/^\//); // internal return owned by the session
  });

  it('requests skipping the optional Blueprint + Content Ingestion stages (post content already exists)', () => {
    const router = mkRouter();
    launchCreatorFromWriter({ router: router as any, assetType: 'supporting_image', source });
    const arg = router.push.mock.calls[0][0];
    expect(arg.query.skip_blueprint).toBe('1');
    expect(arg.query.skip_ingestion).toBe('1');
    // still the canonical gallery — skip is a request carried INTO the one pipeline.
    expect(arg.pathname).toBe('/command-center/creator-content/image/templates');
  });

  it('every visible writer asset type routes to a template gallery (no special-case Image)', () => {
    for (const t of POST_CREATOR_ASSET_TYPES_VISIBLE) {
      const router = mkRouter();
      const s = buildWriterCreatorPrefill({ sourceType: 'post', sourceId: 'post:draft', assetType: t, title: 'T', body: 'B' });
      launchCreatorFromWriter({ router: router as any, assetType: t, source: s });
      const arg = router.push.mock.calls[0][0];
      expect(arg.pathname).toMatch(/^\/command-center\/creator-content\/[a-z]+\/templates$/);
      expect(loadAttachmentSession(arg.query.session)!.assetType).toBe(t);
    }
  });

  it('asset-type list is registry-driven (not a hardcoded image-only list)', () => {
    expect(POST_CREATOR_ASSET_TYPES_VISIBLE.length).toBeGreaterThan(1);
    expect(POST_CREATOR_ASSET_TYPES_VISIBLE).toContain('supporting_image');
  });
});
