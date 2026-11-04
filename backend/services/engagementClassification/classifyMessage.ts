/**
 * THE entry point for a canonical message classification (SC-7, DRAFT).
 *
 *   1. Deterministic governance detection (governanceDetection.ts) — always first,
 *      always authoritative.
 *   2. The EXISTING classifiers, through their mapping tables. By default this is
 *      the conversation-intelligence rule-based pass (pure, no AI call). Outputs a
 *      caller already holds — a stored triage category, a stored message intent, a
 *      lead-detection intent — are passed in as `legacy` and mapped, not recomputed.
 *
 * This is not a fourth classifier: it has no prompt, makes no AI call and adds no
 * rules beyond governance. Any classifier a caller injects (`deps.classifiers`) may
 * ADD labels; it can never remove or replace a governance class, and a governance
 * class it suggests is reported as a `governanceCandidate` for review, never as
 * governance.
 */

import { ruleBasedAnalysis } from '../engagementConversationIntelligenceService';
import {
  GOVERNANCE_DETECTOR_VERSION,
  detectGovernanceClasses,
  type GovernanceChannelSignals,
  type GovernanceMatch,
} from './governanceDetection';
import { mapLegacyLabel, type LegacyMappingEntry, type LegacySource } from './legacyMappings';
import {
  CLASSIFICATION_VOCABULARY_VERSION,
  isCanonicalClassificationCode,
  isGovernanceClassificationCode,
  type CanonicalClassificationCode,
  type GovernanceClassificationCode,
} from './vocabulary';

export interface ClassifyMessageInput {
  readonly text: string | null | undefined;
  readonly channel?: string | null;
  readonly signals?: GovernanceChannelSignals | null;
  /** engagement_messages.sentiment_score, used by the existing rule-based pass. */
  readonly sentimentScore?: number | null;
  /** Labels already produced by the existing classifiers (e.g. read from their tables). */
  readonly legacy?: {
    readonly triageCategory?: string | null;
    readonly intelligenceIntent?: string | null;
    readonly policyIntent?: string | null;
    readonly leadIntent?: string | null;
  } | null;
}

/** `canonical` lets an injected classifier speak canonical codes directly. */
export type ClassifierLabelSource = LegacySource | 'canonical';

export interface ClassifierLabel {
  readonly source: ClassifierLabelSource;
  readonly value: string | null | undefined;
}

/** An existing classifier adapted to this entry point. Must not be a new AI call. */
export type ExistingClassifier = (input: ClassifyMessageInput) => readonly ClassifierLabel[] | Promise<readonly ClassifierLabel[]>;

export interface ClassifyMessageDeps {
  readonly classifiers?: readonly ExistingClassifier[];
}

export interface ClassificationSourceRecord {
  readonly source: ClassifierLabelSource;
  readonly value: string | null;
  readonly code: CanonicalClassificationCode;
  readonly fit: LegacyMappingEntry['fit'];
}

export interface CanonicalClassification {
  readonly vocabularyVersion: string;
  readonly detectorVersion: string;
  /** Primary class: the first governance class if any, else the most specific classifier label, else `ambiguous`. */
  readonly code: CanonicalClassificationCode;
  /** Authoritative governance classes, most restrictive first. Empty when none. */
  readonly governance: readonly GovernanceClassificationCode[];
  readonly governanceMatches: readonly GovernanceMatch[];
  /** Every distinct class, governance first, then classifier labels; `ambiguous` only when nothing else. */
  readonly labels: readonly CanonicalClassificationCode[];
  /** Governance classes a classifier hinted at but the detector did not find. Review only; never enforced. */
  readonly governanceCandidates: readonly GovernanceClassificationCode[];
  readonly sources: readonly ClassificationSourceRecord[];
  /** Injected/default classifiers that threw. Governance is unaffected by these. */
  readonly classifierErrors: number;
}

/** The default existing classifier: the conversation-intelligence rule-based pass. Pure. */
export const ruleBasedIntelligenceClassifier: ExistingClassifier = (input) => [
  { source: 'intelligence_intent', value: ruleBasedAnalysis(input.text ?? '', input.sentimentScore ?? null).intent },
];

/** Most specific producer first; decides the primary non-governance class. */
const SOURCE_PRECEDENCE: readonly ClassifierLabelSource[] = [
  'canonical',
  'lead_intent',
  'policy_intent',
  'intelligence_intent',
  'triage_category',
];

function mapLabel(label: ClassifierLabel): { entry: LegacyMappingEntry; candidate?: GovernanceClassificationCode } {
  if (label.source === 'canonical') {
    const v = (label.value ?? '').toString().trim().toLowerCase();
    if (isGovernanceClassificationCode(v)) return { entry: { code: 'ambiguous', fit: 'none' }, candidate: v };
    if (isCanonicalClassificationCode(v)) return { entry: { code: v as LegacyMappingEntry['code'], fit: 'exact' } };
    return { entry: { code: 'ambiguous', fit: 'none' } };
  }
  const entry = mapLegacyLabel(label.source, label.value);
  return { entry, candidate: entry.governanceCandidate };
}

function legacyLabels(input: ClassifyMessageInput): ClassifierLabel[] {
  const l = input.legacy ?? {};
  const out: ClassifierLabel[] = [];
  if (l.leadIntent) out.push({ source: 'lead_intent', value: l.leadIntent });
  if (l.policyIntent) out.push({ source: 'policy_intent', value: l.policyIntent });
  if (l.intelligenceIntent) out.push({ source: 'intelligence_intent', value: l.intelligenceIntent });
  if (l.triageCategory) out.push({ source: 'triage_category', value: l.triageCategory });
  return out;
}

export async function classifyMessage(
  input: ClassifyMessageInput,
  deps: ClassifyMessageDeps = {},
): Promise<CanonicalClassification> {
  // 1. Governance first. Computed before any classifier runs and never revisited.
  const gov = detectGovernanceClasses({ text: input.text, channel: input.channel, signals: input.signals });
  const governance = gov.codes;

  // 2. Existing classifiers, then labels the caller already holds.
  const labels: ClassifierLabel[] = [];
  let classifierErrors = 0;
  for (const classify of deps.classifiers ?? [ruleBasedIntelligenceClassifier]) {
    try {
      labels.push(...(await classify(input)));
    } catch {
      classifierErrors += 1;
    }
  }
  labels.push(...legacyLabels(input));

  const sources: ClassificationSourceRecord[] = [];
  const candidates = new Set<GovernanceClassificationCode>();
  for (const label of labels) {
    const { entry, candidate } = mapLabel(label);
    const value = label.value == null ? null : String(label.value);
    sources.push({ source: label.source, value, code: entry.code, fit: entry.fit });
    if (candidate && !governance.includes(candidate)) candidates.add(candidate);
  }

  // 3. Merge: governance is fixed; classifiers only append.
  const ordered = [...sources].sort(
    (a, b) => SOURCE_PRECEDENCE.indexOf(a.source) - SOURCE_PRECEDENCE.indexOf(b.source),
  );
  const classifierCodes: CanonicalClassificationCode[] = [];
  for (const s of ordered) {
    if (s.code !== 'ambiguous' && !classifierCodes.includes(s.code)) classifierCodes.push(s.code);
  }

  const merged: CanonicalClassificationCode[] = [...governance, ...classifierCodes.filter((c) => !isGovernanceClassificationCode(c))];
  const allLabels: CanonicalClassificationCode[] = merged.length > 0 ? merged : ['ambiguous'];

  return {
    vocabularyVersion: CLASSIFICATION_VOCABULARY_VERSION,
    detectorVersion: GOVERNANCE_DETECTOR_VERSION,
    code: allLabels[0],
    governance,
    governanceMatches: gov.matches,
    labels: allLabels,
    governanceCandidates: [...candidates],
    sources,
    classifierErrors,
  };
}
