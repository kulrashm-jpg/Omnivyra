/**
 * Pins the creatorEvent contract — every Creator-pipeline failure point
 * MUST route through this single helper so production dashboards have a
 * uniform shape to pivot on.
 *
 * Contract:
 *   - Stage names are constrained to the documented set.
 *   - `error` status routes to logger.warn; everything else to logger.info.
 *   - `message` is truncated to 240 chars (log-line hygiene).
 *   - Detail fields pass through unchanged so dashboards can pivot on
 *     `category`, `assetType`, `platform`, etc.
 *   - Does NOT mutate the caller-supplied detail object.
 */

const loggerInfo = jest.fn();
const loggerWarn = jest.fn();
const loggerError = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError },
}));

import { creatorEvent } from '../../services/creatorObservation';

beforeEach(() => jest.clearAllMocks());

describe('creatorEvent — routing', () => {
  it('routes ok / fallback / skip to logger.info', () => {
    creatorEvent('provider', 'ok');
    creatorEvent('overlay', 'fallback');
    creatorEvent('pdf_upload', 'skip');
    expect(loggerInfo).toHaveBeenCalledTimes(3);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('routes error status to logger.warn (not logger.error — auth-spine reserves error level)', () => {
    creatorEvent('provider', 'error', { message: 'OpenAI rate limit' });
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('emits the canonical event name and stage/status fields', () => {
    creatorEvent('pdf_upload', 'fallback', { category: 'storage_mime_blocked', message: 'mime not allowed' });
    expect(loggerInfo).toHaveBeenCalledWith('creator_event', expect.objectContaining({
      stage: 'pdf_upload',
      status: 'fallback',
      category: 'storage_mime_blocked',
    }));
  });
});

describe('creatorEvent — detail handling', () => {
  it('passes detail fields through to the log payload', () => {
    creatorEvent('overlay', 'error', {
      category: 'render_fallback_used',
      assetType: 'pdf',
      platform: 'linkedin',
      message: 'svg compose failed',
      customField: 'foo',
    });
    expect(loggerWarn).toHaveBeenCalledWith('creator_event', expect.objectContaining({
      category: 'render_fallback_used',
      assetType: 'pdf',
      platform: 'linkedin',
      customField: 'foo',
    }));
  });

  it('truncates message to 240 characters for log-line hygiene', () => {
    const longMessage = 'x'.repeat(1_000);
    creatorEvent('provider', 'error', { message: longMessage });
    const payload = loggerWarn.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof payload.message).toBe('string');
    expect((payload.message as string).length).toBe(240);
  });

  it('does not mutate the caller-supplied detail object', () => {
    const detail = { message: 'x'.repeat(500), category: 'test' };
    const before = JSON.stringify(detail);
    creatorEvent('provider', 'error', detail);
    expect(JSON.stringify(detail)).toBe(before);
  });

  it('tolerates undefined / missing detail entirely', () => {
    expect(() => creatorEvent('restore', 'skip')).not.toThrow();
    expect(loggerInfo).toHaveBeenCalledWith('creator_event', expect.objectContaining({
      stage: 'restore',
      status: 'skip',
    }));
  });
});

describe('creatorEvent — every stage emits cleanly', () => {
  it.each(['provider', 'overlay', 'pdf_upload', 'asset_save', 'restore', 'generation'] as const)(
    'stage=%s ok status emits without throwing',
    (stage) => {
      expect(() => creatorEvent(stage, 'ok', { category: 'test' })).not.toThrow();
      expect(loggerInfo).toHaveBeenCalledWith('creator_event', expect.objectContaining({ stage, status: 'ok' }));
    },
  );
});
