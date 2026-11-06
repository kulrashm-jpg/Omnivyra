/**
 * Prompt 5 — classify an inbound reply and say what it would do to a journey. SWITCHED OFF.
 *
 * Behind replyClassificationFlag.ts, which defaults OFF; turning it on requires SC7-R (see
 * that file). While it is off this returns the abstention consequence (`suspend`, the R1
 * default) WITHOUT calling the classifier, so no label reaches a journey consequence.
 *
 * The Outreach conditions (2026-11-06), each pinned by a guard test:
 *   - read-only and deterministic: `classifyMessage` with NO injected classifier, so only
 *     the deterministic governance detector and the existing rule-based pass run;
 *   - no AI Gateway call and no network;
 *   - the message content is used in memory only: nothing here persists or logs it, and the
 *     result carries codes, never text;
 *   - even on, a label can never end a journey or override STOP, complaint, unsubscribe or
 *     a bounce: the consequence comes from replyConsequence.ts, where governance decides
 *     first and no label ever exits.
 *
 * NOT WIRED: nothing in the sweeper (workflowProgressionSweeper.ts), an engine adapter or a
 * journey module imports this.
 */

import { classifyMessage } from '../engagementClassification/classifyMessage';
import type { GovernanceChannelSignals } from '../engagementClassification/governanceDetection';
import type { CanonicalClassificationCode } from '../engagementClassification/vocabulary';
import { isReplyClassificationEnabled } from './replyClassificationFlag';
import { replyConsequence, type AbstentionReason, type ReplyConsequence } from './replyConsequence';

export interface InboundReplyInput {
  /** Used in memory for this call only. Never persisted, never logged, never returned. */
  readonly text: string | null | undefined;
  readonly channel: string | null;
  readonly signals?: GovernanceChannelSignals | null;
  /** Canonical restriction types in force on the person. */
  readonly restrictions: readonly string[];
  readonly controlRefusal: string | null;
}

export interface ReplyClassificationResult {
  /** False when the flag is off or the classifier abstained. */
  readonly classified: boolean;
  readonly consequence: ReplyConsequence;
  /** Codes only; never the text. */
  readonly codes: readonly CanonicalClassificationCode[];
  readonly vocabularyVersion: string | null;
}

export async function classifyReplyConsequence(
  input: InboundReplyInput,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ReplyClassificationResult> {
  const governance = { restrictions: input.restrictions, controlRefusal: input.controlRefusal };
  const abstain = (reason: AbstentionReason): ReplyClassificationResult => ({
    classified: false,
    consequence: replyConsequence({ ...governance, signal: { kind: 'abstain', reason } }),
    codes: [],
    vocabularyVersion: null,
  });

  if (!isReplyClassificationEnabled(env)) return abstain('classification_disabled');
  if (typeof input.text !== 'string' || input.text.trim() === '') return abstain('no_content');

  let c: Awaited<ReturnType<typeof classifyMessage>>;
  try {
    // No second argument: no injected classifier, so no AI call can reach here.
    c = await classifyMessage({ text: input.text, channel: input.channel, signals: input.signals ?? null });
  } catch {
    return abstain('classifier_unavailable');
  }
  if (c.classifierErrors > 0 && c.governance.length === 0) return abstain('classifier_unavailable');

  return {
    classified: true,
    consequence: replyConsequence({ ...governance, signal: { kind: 'classification', code: c.code, labels: c.labels, governance: c.governance } }),
    codes: c.labels,
    vocabularyVersion: c.vocabularyVersion,
  };
}
