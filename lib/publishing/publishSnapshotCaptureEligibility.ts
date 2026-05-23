// Capture Eligibility Rules
//
// Deterministic, advisory-only utilities that decide whether a publish snapshot
// can be captured and which capture intent/mode applies. These NEVER gate
// runtime — callers read the advisory result and decide for themselves.

import type { PublishMode } from './universalPublishingContract';

export type PublishCaptureLifecyclePhase =
  | 'scheduling'
  | 'finalization'
  | 'publish_ready'
  | 'manual_publish';

export type PublishCaptureIntent =
  | 'draft_capture'
  | 'scheduled_capture'
  | 'publish_ready_capture'
  | 'manual_publish_capture';

export const PUBLISH_CAPTURE_INTENTS: readonly PublishCaptureIntent[] = [
  'draft_capture',
  'scheduled_capture',
  'publish_ready_capture',
  'manual_publish_capture',
];

export interface PublishCaptureEligibilityInput {
  companyId: string;
  renderedHtml: string;
  contentBlockCount: number;
  title: string;
  slug: string;
}

export interface PublishCaptureEligibility {
  eligible: boolean;
  reasons: readonly string[];
}

// Advisory eligibility — never blocks; the capture service reads `eligible`.
export function canCapturePublishSnapshot(
  input: PublishCaptureEligibilityInput,
): PublishCaptureEligibility {
  const reasons: string[] = [];
  if (!input.companyId.trim()) reasons.push('missing company id');
  if (!input.renderedHtml.trim() && input.contentBlockCount === 0) reasons.push('no publishable content');
  if (!input.title.trim()) reasons.push('missing title');
  if (!input.slug.trim()) reasons.push('missing slug');
  return { eligible: reasons.length === 0, reasons };
}

export interface PublishCaptureIntentInput {
  lifecyclePhase: PublishCaptureLifecyclePhase;
  scheduledTimestamp: string | null;
  blogStatus: string;
}

// Deterministic: lifecycle phase + scheduled timestamp fully determine intent.
export function derivePublishCaptureIntent(input: PublishCaptureIntentInput): PublishCaptureIntent {
  if (input.lifecyclePhase === 'scheduling' || input.scheduledTimestamp) return 'scheduled_capture';
  if (input.lifecyclePhase === 'manual_publish') return 'manual_publish_capture';
  if (input.lifecyclePhase === 'finalization' || input.lifecyclePhase === 'publish_ready') {
    return 'publish_ready_capture';
  }
  return 'draft_capture';
}

// Deterministic: maps a capture intent to a concrete publish mode.
export function derivePublishCaptureMode(input: {
  scheduledTimestamp: string | null;
  captureIntent: PublishCaptureIntent;
}): PublishMode {
  if (input.scheduledTimestamp || input.captureIntent === 'scheduled_capture') return 'schedule';
  if (input.captureIntent === 'draft_capture') return 'cms_draft';
  return 'publish_now';
}
