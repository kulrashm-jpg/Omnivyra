/**
 * G18.3 — Shortform manual-mode payload stub.
 *
 * "Write my own" mode for shortform Posts cannot land the user in an editor
 * (ShortformResultPage is a viewer, not an editor). Instead it lands them on
 * the result page with a sentinel-marked empty payload. The result page
 * detects the sentinel and shows a "Continue to scheduler" CTA — the scheduler
 * is where editing actually happens.
 *
 * This helper builds the sentinel payload. It is intentionally minimal:
 * empty `generated_content`, explicit `creation_mode: 'manual'`. Not a "fake
 * generated payload" — the empty `generated_content` signals "nothing was
 * generated; user is writing by hand."
 */

export type ShortformManualStub = {
  output: {
    success: true;
    content_type: 'post';
    template_used: null;
    master_content: { content: '' };
    platform_variant: {
      platform: string;
      generated_content: '';
      discoverability_meta: { hashtags: [] };
      adaptation_trace: {
        style_strategy: string;
        format_family: string;
        actual_length_used: null;
      };
    };
  };
  topic: string;
  platform: string;
  creation_mode: 'manual';
};

export function buildShortformManualStub(input?: {
  platform?: string;
  topic?: string;
  formatFamily?: string;
}): ShortformManualStub {
  const platform = input?.platform || 'linkedin';
  const topic = input?.topic || 'New post draft';
  const formatFamily = input?.formatFamily || 'authority-post';
  return {
    output: {
      success: true,
      content_type: 'post',
      template_used: null,
      master_content: { content: '' },
      platform_variant: {
        platform,
        generated_content: '',
        discoverability_meta: { hashtags: [] },
        adaptation_trace: {
          style_strategy: 'Manual draft — written by hand in the scheduler.',
          format_family: formatFamily,
          actual_length_used: null,
        },
      },
    },
    topic,
    platform,
    creation_mode: 'manual',
  };
}
