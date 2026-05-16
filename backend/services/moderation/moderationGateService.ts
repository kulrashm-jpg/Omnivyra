/**
 * Phase 3 — Mandatory moderation gate.
 *
 * Every raw signal MUST pass through `evaluateModeration` before it reaches
 * canonicalLeadSignalService. The pipeline rejects blocked content at this
 * layer; blocked content NEVER enters lead_signals. The decision is
 * recorded in `moderation_decisions` for audit.
 *
 * Pipeline order (deterministic, fail-fast on hard blocks):
 *   1. content_length_guard       — too short / too long
 *   2. blocklist_regex            — slurs, prohibited terms
 *   3. spam_pattern_regex         — common spam shapes
 *   4. pii_detection              — emails / phone numbers / SSNs (flags only)
 *   5. ai_classifier_hook         — pluggable; off by default in Phase 3
 *
 * Pure functions. No I/O. The caller persists the decision to the DB.
 */

import { createHash } from 'crypto';

export type ModerationOutcome = 'approved' | 'flagged' | 'blocked' | 'requires_review';

export type ModerationReason =
  | 'content_too_short'
  | 'content_too_long'
  | 'blocklist_term'
  | 'spam_pattern'
  | 'pii_detected'
  | 'ai_classifier_blocked'
  | 'ai_classifier_flagged';

export type ModerationDecision = {
  outcome: ModerationOutcome;
  reasons: ModerationReason[];
  content_hash: string;
  metadata: {
    length: number;
    pii_findings: string[];
    blocklist_hits: string[];
    spam_hits: string[];
  };
};

const MIN_CONTENT_LENGTH = 20;
const MAX_CONTENT_LENGTH = 20_000;

// Intentionally conservative. False positives are blocked; we'd rather miss
// the occasional valid signal than surface abusive content. Operators can
// extend via env / config in later phases.
const BLOCKLIST_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'csam_pattern', pattern: /\b(child(?:ren)?\s+porn|cp\b|loli|shota)\b/i },
  { key: 'explicit_violence', pattern: /\b(kill\s+yourself|kys|kms|suicide\s+(now|tonight|method))\b/i },
];

const SPAM_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'crypto_pump', pattern: /\b(100x|moon|pump\s+and\s+dump|guaranteed\s+returns)\b/i },
  { key: 'shortlink_spam', pattern: /\b(bit\.ly|tinyurl\.com|t\.co\/\w+|goo\.gl)\b/i },
  { key: 'all_caps_long', pattern: /^[A-Z\s!?.,'"-]{50,}$/ },
  { key: 'excessive_emoji', pattern: /(\p{Emoji}\s*){10,}/u },
];

const PII_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'email', pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { key: 'phone', pattern: /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}/ },
  { key: 'ssn_us', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
];

export function computeContentHash(content: string, platform: string): string {
  const canonical = `${platform.toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Pure moderation decision. The caller is responsible for persisting it.
 */
export function evaluateModeration(input: {
  content: string;
  platform: string;
  /** Optional AI moderation hook. Defaults to a no-op `approve` to keep the
      contract concrete without forcing AI cost in Phase 3. */
  aiClassifier?: (text: string) => Promise<{ outcome: ModerationOutcome; reasons: string[] }> | { outcome: ModerationOutcome; reasons: string[] };
}): ModerationDecision | Promise<ModerationDecision> {
  const text = (input.content ?? '').trim();
  const reasons: ModerationReason[] = [];
  const blocklistHits: string[] = [];
  const spamHits: string[] = [];
  const piiFindings: string[] = [];
  const length = text.length;

  if (length < MIN_CONTENT_LENGTH) {
    return {
      outcome: 'blocked',
      reasons: ['content_too_short'],
      content_hash: computeContentHash(text, input.platform),
      metadata: { length, pii_findings: [], blocklist_hits: [], spam_hits: [] },
    };
  }
  if (length > MAX_CONTENT_LENGTH) {
    return {
      outcome: 'blocked',
      reasons: ['content_too_long'],
      content_hash: computeContentHash(text, input.platform),
      metadata: { length, pii_findings: [], blocklist_hits: [], spam_hits: [] },
    };
  }

  for (const { key, pattern } of BLOCKLIST_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push('blocklist_term');
      blocklistHits.push(key);
      // Blocklist is a hard block; short-circuit.
      return {
        outcome: 'blocked',
        reasons,
        content_hash: computeContentHash(text, input.platform),
        metadata: { length, pii_findings: piiFindings, blocklist_hits: blocklistHits, spam_hits: spamHits },
      };
    }
  }

  for (const { key, pattern } of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push('spam_pattern');
      spamHits.push(key);
    }
  }

  for (const { key, pattern } of PII_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push('pii_detected');
      piiFindings.push(key);
    }
  }

  let outcome: ModerationOutcome = 'approved';
  if (spamHits.length >= 2) outcome = 'blocked';
  else if (spamHits.length === 1) outcome = 'flagged';
  else if (piiFindings.length > 0) outcome = 'flagged';

  // AI hook last — pure functions above already produced a verdict. AI can
  // *escalate* (approved → flagged → blocked) but cannot *de-escalate* a
  // hard rule-based block.
  if (input.aiClassifier) {
    const ranked: ModerationOutcome[] = ['approved', 'flagged', 'requires_review', 'blocked'];
    const apply = (aiOutcome: { outcome: ModerationOutcome; reasons: string[] }): ModerationDecision => {
      const finalOutcome: ModerationOutcome =
        ranked.indexOf(aiOutcome.outcome) > ranked.indexOf(outcome) ? aiOutcome.outcome : outcome;
      const finalReasons = [...reasons];
      if (aiOutcome.outcome === 'blocked' && !finalReasons.includes('ai_classifier_blocked')) finalReasons.push('ai_classifier_blocked');
      if (aiOutcome.outcome === 'flagged' && !finalReasons.includes('ai_classifier_flagged')) finalReasons.push('ai_classifier_flagged');
      return {
        outcome: finalOutcome,
        reasons: finalReasons,
        content_hash: computeContentHash(text, input.platform),
        metadata: { length, pii_findings: piiFindings, blocklist_hits: blocklistHits, spam_hits: spamHits },
      };
    };
    const ai = input.aiClassifier(text);
    if (ai instanceof Promise) return ai.then(apply);
    return apply(ai);
  }

  return {
    outcome,
    reasons,
    content_hash: computeContentHash(text, input.platform),
    metadata: { length, pii_findings: piiFindings, blocklist_hits: blocklistHits, spam_hits: spamHits },
  };
}
