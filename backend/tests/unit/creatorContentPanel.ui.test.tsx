/**
 * @jest-environment jsdom
 *
 * React Testing Library coverage for CreatorContentPanel's
 * AttachmentUploadSection. Exercises:
 *
 *   - awaiting_media_upload renders theme treatment + URL field + Upload button
 *   - URL submit calls onUploadMedia with expectedRevision derived from row
 *   - Drag-drop triggers onUploadFile with the dropped File
 *   - Cancel button appears during uploading and aborts via the AbortSignal
 *   - Conflict response surfaces the "changed in another tab" copy
 *   - Validation failure shows the errors list
 *   - Scheduled row reveals Replace Media + Reschedule + Unschedule buttons
 *   - Unschedule confirmation flow calls onUnschedule on confirm
 */

import React from 'react';
import '@testing-library/jest-dom';

// CreatorContentPanelController:121 destructures { user, userName, selectedCompanyId }
// from useCompanyContext, which throws outside a CompanyProvider.
//
// Mocked at the HOOK boundary rather than wrapping the render in the real
// CompanyProvider: that provider calls getSupabaseBrowser() and fetches
// /api/company-profile (CompanyContext.tsx:169+), which would pull auth and
// network into a jsdom UI unit test asserting upload-section rendering.
//
// Only the three consumed fields are supplied — nothing invented beyond what the
// controller reads.
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    user: { user_id: 'u-1' },
    userName: 'Test User',
    selectedCompanyId: 'c-1',
  }),
}));

// jsdom provides no `fetch`. With a selectedCompanyId now present, the
// controller's video-workflow effect (CreatorContentPanelController:203+) runs and
// calls it. Stubbed to an empty-payload OK so the effect completes without
// network — these tests assert upload-section RENDERING, not that request.
beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  })) as unknown as typeof fetch;
});
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CreatorContentPanel, {
  type AttachmentRowState,
} from '../../../components/activity-workspace/CreatorContentPanel';

/** Derived from the panel's own prop type, so a prop signature change fails here. */
type PanelProps = import('../../../components/activity-workspace/CreatorContentPanel').CreatorContentPanelProps;
type UploadMediaArgs = Parameters<NonNullable<PanelProps['onUploadMedia']>>;
type UploadFileArgs = Parameters<NonNullable<PanelProps['onUploadFile']>>;
type UnscheduleArgs = Parameters<NonNullable<PanelProps['onUnschedule']>>;

function baseRowState(overrides: Partial<AttachmentRowState> = {}): AttachmentRowState {
  return {
    dailyPlanId: 'plan-1',
    contentType: 'reel',
    lifecycle: 'awaiting_media_upload',
    revision: 1,
    themeTreatmentSummary: { hookText: 'open with question', sceneCount: 3, durationSeconds: 60, aspectRatio: '9:16', ctaText: 'Watch' },
    creatorGuidance: { production_notes: 'shoot vertical', production_checklist: ['set up', 'record'], talking_points: ['point 1'], b_roll_ideas: [] },
    marketingPackage: { caption: 'cap', hashtags: ['#tag'], cta: 'Watch' },
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof CreatorContentPanel>> = {}) {
  const onUploadMedia = jest.fn(async (..._a: UploadMediaArgs) => ({ ok: true, lifecycle: 'ready_for_schedule' as const, uploadedMediaUrl: 'https://x.test/y.mp4' }));
  const onUploadFile = jest.fn(async (..._a: UploadFileArgs) => ({ ok: true, lifecycle: 'ready_for_schedule' as const, uploadedMediaUrl: 'https://x.test/y.mp4' }));
  const onReschedule = jest.fn(async () => ({ ok: true, lifecycle: 'scheduled' as const }));
  const onUnschedule = jest.fn(async (..._a: UnscheduleArgs) => ({ ok: true, lifecycle: 'upload_failed' as const }));
  const onNotice = jest.fn();

  render(
    <CreatorContentPanel
      theme="t"
      productionBrief=""
      talkingPoints={[]}
      contentType="reel"
      platforms={['instagram']}
      onAssetSaved={jest.fn()}
      onGeneratePromotion={jest.fn()}
      campaignId="c"
      executionId="e"
      weekNumber={1}
      day="Mon"
      onNotice={onNotice}
      attachmentRowState={baseRowState()}
      onUploadMedia={onUploadMedia}
      onUploadFile={onUploadFile}
      onReschedule={onReschedule}
      onUnschedule={onUnschedule}
      {...overrides}
    />,
  );
  return { onUploadMedia, onUploadFile, onReschedule, onUnschedule, onNotice };
}

describe('CreatorContentPanel — AttachmentUploadSection', () => {
  test('awaiting state renders theme treatment + URL field + Upload button', () => {
    renderPanel();
    expect(screen.getByText(/Attachment-required: reel/i)).toBeInTheDocument();
    expect(screen.getByText(/Theme treatment/i)).toBeInTheDocument();
    expect(screen.getByText(/open with question/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit URL/i })).toBeInTheDocument();
    expect(screen.getByText(/Awaiting media upload/i)).toBeInTheDocument();
  });

  test('URL submit invokes onUploadMedia with mediaUrl + source + expectedRevision from row', async () => {
    const { onUploadMedia } = renderPanel();
    const input = screen.getByPlaceholderText(/mp4 or platform link/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit URL/i }));
    await waitFor(() => {
      expect(onUploadMedia).toHaveBeenCalledTimes(1);
    });
    expect(onUploadMedia.mock.calls[0][0]).toMatchObject({
      mediaUrl: 'https://youtu.be/abc',
      source: 'external_link',
      expectedRevision: 1,
    });
  });

  test('drop zone triggers onUploadFile with the dropped File and forwards AbortSignal', async () => {
    const { onUploadFile } = renderPanel();
    const zone = screen.getByRole('button', { name: /Drop a video file/i });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    const arg = onUploadFile.mock.calls[0][0];
    expect(arg.file).toBe(file);
    expect(arg.source).toBe('direct_upload');
    expect(arg.expectedRevision).toBe(1);
    expect(arg.signal).toBeInstanceOf(AbortSignal);
  });

  test('Cancel button appears during upload + aborts via signal; aborted result does NOT mutate lifecycle', async () => {
    // Force a never-resolving upload so we can verify the Cancel button.
    let abortSignal: AbortSignal | null = null;
    let resolveUpload: ((value: any) => void) | null = null;
    const slowUploadFile = jest.fn((args: any) => {
      abortSignal = args.signal;
      args.onProgress?.(50);
      return new Promise<any>((resolve) => { resolveUpload = resolve; });
    });
    const { onNotice } = renderPanel({ onUploadFile: slowUploadFile as any });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' });
    const zone = screen.getByRole('button', { name: /Drop a video file/i });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    // Cancel button should now be visible
    const cancelBtn = await screen.findByText(/^Cancel$/);
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
    // The abort fired
    expect(abortSignal?.aborted).toBe(true);
    // Resolve the upload promise with aborted: true (the real handler does this)
    await act(async () => {
      resolveUpload?.({ ok: false, aborted: true, message: 'Upload aborted.' });
    });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('info', 'Upload cancelled.'));
  });

  test('conflict response surfaces "changed in another tab" copy', async () => {
    const conflictUploadMedia = jest.fn(async () => ({ ok: false, conflict: true, message: 'Stale tab' }));
    renderPanel({ onUploadMedia: conflictUploadMedia });
    fireEvent.change(screen.getByPlaceholderText(/mp4 or platform link/i), { target: { value: 'https://x.test/y.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit URL/i }));
    await screen.findByText(/Stale tab/i);
  });

  test('validation failure surfaces structured errors', async () => {
    const failingUpload = jest.fn(async () => ({
      ok: false,
      validation: { valid: false, errors: ['bad mime', 'too small'] },
      message: 'bad mime | too small',
    }));
    renderPanel({ onUploadMedia: failingUpload });
    fireEvent.change(screen.getByPlaceholderText(/mp4 or platform link/i), { target: { value: 'https://x.test/y.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit URL/i }));
    // The combined message renders as the localError
    await screen.findByText(/bad mime/i);
  });

  test('scheduled row reveals Replace Media + Reschedule + Unschedule buttons', () => {
    renderPanel({
      attachmentRowState: baseRowState({
        lifecycle: 'scheduled',
        uploadedMediaUrl: 'https://x.test/y.mp4',
        uploadedMimeType: 'video/mp4',
        scheduledPostId: 'sp-1',
      }),
    });
    expect(screen.getByText(/^Scheduled$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace media/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reschedule$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unschedule$/i })).toBeInTheDocument();
  });

  test('Unschedule confirmation flow calls onUnschedule on confirm', async () => {
    const { onUnschedule } = renderPanel({
      attachmentRowState: baseRowState({
        lifecycle: 'scheduled',
        uploadedMediaUrl: 'https://x.test/y.mp4',
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: /^Unschedule$/i }));
    // Confirmation copy appears
    await screen.findByText(/Unscheduling cancels the queued publish/i);
    fireEvent.click(screen.getByRole('button', { name: /Confirm unschedule/i }));
    await waitFor(() => expect(onUnschedule).toHaveBeenCalledTimes(1));
    expect(onUnschedule.mock.calls[0][0]).toMatchObject({ expectedRevision: 1 });
  });

  test('Replace media unlocks the upload zone for scheduled rows', () => {
    renderPanel({
      attachmentRowState: baseRowState({
        lifecycle: 'scheduled',
        uploadedMediaUrl: 'https://x.test/y.mp4',
      }),
    });
    // Initially the drop-zone idle copy is the locked variant
    expect(screen.getByText(/Click "Replace media" above to upload/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replace media/i }));
    // After clicking, the unlocked drag-and-drop copy is shown.
    expect(screen.getByText(/Drag .* drop your video file/i)).toBeInTheDocument();
  });

  test('resume banner appears for awaiting + persisted handle; Discard clears it', async () => {
    const onResumeUpload = jest.fn(async () => ({ ok: false, message: 'Re-select the file to continue.' }));
    const onDiscardResumableUpload = jest.fn(async () => undefined);
    const { onNotice } = renderPanel({
      attachmentRowState: baseRowState({ lifecycle: 'awaiting_media_upload' }),
      resumableUploadHandle: {
        tusUploadUrl: 'https://supabase.test/storage/v1/upload/resumable/abc',
        uploadSessionId: 'sess-1',
        objectPath: 'plan-1/video/clip.mp4',
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        hasPersistedFingerprint: true,
      },
      onResumeUpload,
      onDiscardResumableUpload,
    });
    expect(screen.getByText(/Resume previous upload\?/i)).toBeInTheDocument();
    // Resume click invokes the handler
    fireEvent.click(screen.getByRole('button', { name: /Resume upload/i }));
    await waitFor(() => expect(onResumeUpload).toHaveBeenCalledTimes(1));
    // Discard click invokes the discard handler + emits an info notice
    fireEvent.click(screen.getByRole('button', { name: /Discard & start over/i }));
    await waitFor(() => expect(onDiscardResumableUpload).toHaveBeenCalledTimes(1));
    expect(onNotice).toHaveBeenCalledWith('info', expect.stringMatching(/Discarded/i));
  });

  test('resume banner is suppressed for ready_for_schedule and scheduled rows', () => {
    renderPanel({
      attachmentRowState: baseRowState({ lifecycle: 'ready_for_schedule', uploadedMediaUrl: 'https://x.test/y.mp4' }),
      resumableUploadHandle: { tusUploadUrl: 'x', uploadSessionId: 's', hasPersistedFingerprint: true, createdAt: new Date().toISOString() },
      onResumeUpload: jest.fn(),
      onDiscardResumableUpload: jest.fn(),
    });
    expect(screen.queryByText(/Resume previous upload\?/i)).not.toBeInTheDocument();
  });

  test('upload_failed lifecycle shows "Upload failed — retry" badge + retry button copy', () => {
    renderPanel({
      attachmentRowState: baseRowState({
        lifecycle: 'upload_failed',
        uploadValidation: { valid: false, errors: ['bad mime', 'too small'] },
      }),
    });
    expect(screen.getByText(/Upload failed — retry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry URL upload/i })).toBeInTheDocument();
  });
});
