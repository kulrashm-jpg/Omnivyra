import {
  CREATOR_RENDER_POLL_MAX_ATTEMPTS,
  creatorRenderPollStatus,
  creatorRenderPollFailureReason,
  creatorRenderPollTerminalMessage,
  fetchCreatorRenderJobStatus,
  hasCreatorRenderPollExhausted,
  isCreatorRenderJobStatus,
  mergeRenderedCreatorResult,
  shouldOfferInlineCreatorRender,
} from '../../../lib/creator-content/creatorRenderedResult';
import type { CreatorResult } from '../../../lib/creator-content/creatorWorkflowModel';

function result(id: string): CreatorResult {
  return {
    success: true,
    primary_platform: 'linkedin',
    output: {
      asset_type: 'carousel',
      asset_instruction: {},
      asset_payload: {
        media_bundle: {
          metadata: { render_async: true, render_job: { id } },
        },
      },
      packaging: {
        caption: '',
        hashtags: [],
        cta: '',
        meta_description: '',
      },
    },
  };
}

describe('creator rendered-result lifecycle', () => {
  it.each(['failed', 'cancelled', 'dead_letter'])(
    'offers a no-generation inline retry for terminal render status %s',
    (status) => {
      expect(shouldOfferInlineCreatorRender(status, 0)).toBe(true);
    },
  );

  it('does not offer inline rendering while a queue job is waiting, even when stalled', () => {
    expect(shouldOfferInlineCreatorRender('queued', 24)).toBe(false);
    expect(shouldOfferInlineCreatorRender('waiting', 25)).toBe(false);
    expect(shouldOfferInlineCreatorRender('queued', 180)).toBe(false);
    expect(shouldOfferInlineCreatorRender('active', 60)).toBe(false);
    expect(shouldOfferInlineCreatorRender('unknown', 180)).toBe(false);
  });

  it('treats malformed poll statuses as unavailable and maps valid statuses without fallback masking', () => {
    expect(isCreatorRenderJobStatus('active')).toBe(true);
    expect(isCreatorRenderJobStatus('completed')).toBe(true);
    expect(isCreatorRenderJobStatus(undefined)).toBe(false);
    expect(isCreatorRenderJobStatus('unknown')).toBe(false);
    expect(creatorRenderPollStatus('waiting')).toBe('waiting');
    expect(creatorRenderPollStatus('queued')).toBe('queued');
  });

  it('exhausts polling at the existing 90-attempt limit and gives an actionable recovery message', () => {
    expect(CREATOR_RENDER_POLL_MAX_ATTEMPTS).toBe(90);
    expect(hasCreatorRenderPollExhausted(89)).toBe(false);
    expect(hasCreatorRenderPollExhausted(90)).toBe(true);
    expect(creatorRenderPollTerminalMessage('status_unavailable')).toMatch(/worker may still be running.*do not retry inline until a terminal status is confirmed/i);
    expect(creatorRenderPollTerminalMessage('timed_out')).toMatch(/timed out.*worker may still be running.*do not retry inline/i);
    expect(creatorRenderPollTerminalMessage('not_completed')).toMatch(/90 status checks.*worker may still be running.*do not retry inline/i);
    expect(shouldOfferInlineCreatorRender('failed', 0)).toBe(true);
  });

  it('classifies network, HTTP, and malformed-body failures as unavailable, not timeouts', () => {
    expect(creatorRenderPollFailureReason(new Error('Network failure'))).toBe('status_unavailable');
    expect(creatorRenderPollFailureReason(new Error('HTTP 503'))).toBe('status_unavailable');
    expect(creatorRenderPollFailureReason(new Error('Malformed JSON'))).toBe('status_unavailable');
    const timeout = new Error('request timeout');
    timeout.name = 'AbortError';
    expect(creatorRenderPollFailureReason(timeout)).toBe('timed_out');
  });

  it('rejects network, non-OK, malformed, and incomplete completed-status responses', async () => {
    const signal = new AbortController().signal;
    await expect(fetchCreatorRenderJobStatus('job-1', signal, async () => {
      throw new Error('network unavailable');
    })).rejects.toThrow('network unavailable');

    await expect(fetchCreatorRenderJobStatus('job-1', signal, async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }))).rejects.toThrow('HTTP 503');

    await expect(fetchCreatorRenderJobStatus('job-1', signal, async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('invalid JSON'); },
    }))).rejects.toThrow('malformed');

    await expect(fetchCreatorRenderJobStatus('job-1', signal, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ render_job: { status: 'completed' } }),
    }))).rejects.toThrow('did not include a result');
  });

  it('forwards the encoded job URL and cancellation signal to the status request', async () => {
    const signal = new AbortController().signal;
    const fetchStatus = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ render_job: { status: 'queued' } }),
    }));

    await fetchCreatorRenderJobStatus('job /1', signal, fetchStatus);

    expect(fetchStatus).toHaveBeenCalledWith(
      '/api/command-center/creator-content/render-job/job%20%2F1',
      { credentials: 'include', signal },
    );
  });

  it('does not merge a stale render into a newer infographic or carousel result', () => {
    const oldResult = result('old-job');
    const currentResult = result('new-job');

    expect(mergeRenderedCreatorResult(currentResult, oldResult, {
      files: ['old-slide.png'],
    })).toBe(currentResult);
    expect(currentResult.output.asset_payload.media_bundle?.files).toBeUndefined();
  });

  it('merges completed files and metadata into the result that started the render', () => {
    const sourceResult = result('current-job');
    const merged = mergeRenderedCreatorResult(sourceResult, sourceResult, {
      url: 'preview.png',
      files: ['slide-1.png', 'slide-2.png'],
      metadata: { provider_rendered: true },
    });

    expect(merged).not.toBe(sourceResult);
    expect(merged?.output.asset_payload.media_bundle).toMatchObject({
      url: 'preview.png',
      files: ['slide-1.png', 'slide-2.png'],
      metadata: {
        render_job: { id: 'current-job' },
        provider_rendered: true,
        render_async: false,
      },
    });
  });

  it('preserves the inline fallback marker on a current result', () => {
    const sourceResult = result('inline-job');
    const merged = mergeRenderedCreatorResult(sourceResult, sourceResult, {
      url: 'preview.png',
    }, 'inline_fallback');

    expect(merged?.output.asset_payload.media_bundle?.metadata).toMatchObject({
      render_async: false,
      rendered_via: 'inline_fallback',
    });
  });
});
