/**
 * @jest-environment jsdom
 *
 * Owner 2026-10-25: "there are many buttons on this page — open asset, edit asset,
 * duplicate asset and so on — but none of them work". Two causes:
 *   1. a failed generation came back as the server's text-only stand-in
 *      (beta-fallback-*) and was shown as "Completed"; download / duplicate acted on
 *      nothing;
 *   2. "Open editor" scrolled to a form that is HIDDEN on the confirmation screen.
 *
 * SECRETS: none. No network.
 */
import {
  CREATOR_EDITOR_ELEMENT_ID, CREATOR_EDITOR_OPEN_EVENT, openCreatorEditor,
} from '../../../lib/content/openCreatorEditor';
import {
  creatorPlaceholderFailure, hasUsableCreatorOutput, type CreatorResult,
} from '../../../lib/creator-content/creatorWorkflowModel';

const realOutput = (): CreatorResult => ({
  success: true,
  primary_platform: 'instagram',
  output: {
    asset_type: 'carousel',
    asset_instruction: { template_id: 'sys-carousel-educational-5' },
    asset_payload: { media_bundle: { url: 'https://cdn.test/slide-1.png', files: ['https://cdn.test/slide-2.png'] }, slides: [] },
    packaging: { caption: 'Plan a month of posts in an hour', hashtags: [] },
  },
} as unknown as CreatorResult);

const placeholderOutput = (): CreatorResult => {
  const r = realOutput() as unknown as { output: Record<string, any> };
  r.output.asset_instruction = { template_id: 'beta-fallback-carousel' };
  r.output.asset_payload = { media_bundle: { metadata: { generated_by: 'creator-beta-fallback', placeholder: true } } };
  r.output.metadata = { beta_fallback: true, fallback_reason: 'provider_image_unavailable:model_unavailable' };
  return r as unknown as CreatorResult;
};

describe('a failed generation is never treated as a usable asset', () => {
  it('detects the placeholder and carries its reason', () => {
    expect(creatorPlaceholderFailure(placeholderOutput())).toEqual({ reason: 'provider_image_unavailable:model_unavailable' });
    expect(creatorPlaceholderFailure(realOutput())).toBeNull();
    expect(creatorPlaceholderFailure(null)).toBeNull();
  });

  it('download / duplicate / save refuse the placeholder but accept a real output', () => {
    expect(hasUsableCreatorOutput(placeholderOutput())).toBe(false);
    expect(hasUsableCreatorOutput(realOutput())).toBe(true);
  });
});

describe('"Open editor" opens the hidden form, then scrolls to it', () => {
  afterEach(() => { document.body.innerHTML = ''; jest.useRealTimers(); });

  it('asks the page to show the form and scrolls once it is visible', () => {
    jest.useFakeTimers();
    const wrapper = document.createElement('div');
    wrapper.hidden = true; // confirmation screen: the form is mounted but hidden
    const el = document.createElement('div');
    el.id = CREATOR_EDITOR_ELEMENT_ID;
    (el as any).scrollIntoView = jest.fn();
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);
    const opened = jest.fn(() => { wrapper.hidden = false; });
    window.addEventListener(CREATOR_EDITOR_OPEN_EVENT, opened);

    const res = openCreatorEditor({ assetId: 'a1' }, () => {});
    expect(res.status).toBe('opened');
    expect(opened).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    expect((el as any).scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    window.removeEventListener(CREATOR_EDITOR_OPEN_EVENT, opened);
  });
});
