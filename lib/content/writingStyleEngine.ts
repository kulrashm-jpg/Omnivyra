/**
 * Writing Style Engine
 *
 * Pure function module. Zero AI calls. Deterministic. Synchronous.
 *
 * Parses a CompanyProfile into a structured WritingStyleProfile that captures:
 *   - Voice descriptors (brand_voice_list / brand_voice)
 *   - Tone and positioning summary
 *   - Structural preferences (how to open, CTA style, reader emotion target)
 *   - Authority domains and key message pillars
 *   - Unique voice note derived from value proposition
 *   - Patterns/words to avoid
 *   - A formatStyleInstructions() method ready for injection into any AI prompt
 *
 * Usable at every generation stage:
 *   - Blog generation   → lib/blog/runBlogGeneration.ts
 *   - Content Studio    → pages/content-studio/[format].tsx
 *   - Social posts      → any social generation API route
 *   - Whitepapers / Stories / Reports
 *
 * Exports:
 *   buildWritingStyleProfile(profile) → WritingStyleProfile
 *   formatStyleInstructions(style)    → string  (prompt-ready block)
 */

import type { CompanyProfile } from '../../backend/services/companyProfileService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WritingStyleProfile {
  /** Voice descriptors parsed from brand_voice_list or brand_voice string. */
  voice_descriptors: string[];
  /** Human-readable tone summary for display and quick injection. */
  tone_summary: string;
  /** How content should open (instruction for the AI). */
  open_with: string;
  /** CTA style aligned to campaign purpose (e.g. "Soft educational", "Direct"). */
  cta_style: string;
  /** Target reader emotional state (e.g. "confident", "curious", "urgent"). */
  reader_emotion_target: string;
  /** Subject-matter authority domains from profile. */
  authority_domains: string[];
  /** Core messaging pillars parsed from key_messages. */
  key_message_pillars: string[];
  /** Unique voice note synthesised from unique_value + transformation_mechanism. */
  unique_voice_note: string;
  /** Generic + context-derived words/phrases to avoid. */
  forbidden_patterns: string[];
  /**
   * Single condensed paragraph ready for AI prompt injection.
   * Use this when you want a one-liner style guide in a system or user prompt.
   */
  prompt_instruction: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FORBIDDEN_PATTERNS: string[] = [
  'game-changing',
  'revolutionary',
  'leverage',
  'synergy',
  'synergize',
  'paradigm shift',
  'disruptive',
  'holistic approach',
  "it's important to note",
  'going forward',
  'at the end of the day',
  'in today\'s fast-paced world',
  'in conclusion',
];

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => String(v).split(/[,;|\n]+/)).map((s) => s.trim()).filter(Boolean);
  }
  return String(value).split(/[,;|\n]+/).map((s) => s.trim()).filter(Boolean);
}

function truncate(s: string, length: number): string {
  return s.length > length ? s.slice(0, length).trimEnd() + '…' : s;
}

function deriveOpenWith(profile: CompanyProfile): string {
  if (profile.core_problem_statement) {
    return `Open with the core problem your readers face: "${truncate(profile.core_problem_statement, 100)}"`;
  }
  if (profile.desired_transformation) {
    return `Open by contrasting the current pain state with the desired outcome: "${truncate(profile.desired_transformation, 90)}"`;
  }
  if (profile.pain_symptoms && profile.pain_symptoms.length > 0) {
    return `Open with a sharp observation about: ${profile.pain_symptoms[0]}`;
  }
  if (profile.awareness_gap) {
    return `Open by exposing the common misconception: "${truncate(profile.awareness_gap, 90)}"`;
  }
  return 'Open with a concrete, specific business problem or unexpected insight — never with a question, never with generic framing';
}

function deriveToneSummary(profile: CompanyProfile): string {
  const voiceList = parseList(profile.brand_voice_list || profile.brand_voice);

  const parts: string[] = [];

  if (voiceList.length > 0) {
    parts.push(voiceList.slice(0, 3).join(', '));
  }

  const positioningSnippet = profile.brand_positioning
    ? profile.brand_positioning.split(/[.!?]/)[0]?.trim()
    : null;
  if (positioningSnippet && positioningSnippet.length > 5 && positioningSnippet.length < 100) {
    parts.push(positioningSnippet);
  }

  if (parts.length === 0) return 'Authoritative, direct, and analytically grounded';
  return parts.join('. ');
}

function deriveUniqueVoiceNote(profile: CompanyProfile): string {
  const parts: string[] = [];
  if (profile.unique_value) {
    parts.push(`Company's unique angle: ${truncate(profile.unique_value, 120)}`);
  }
  if (profile.transformation_mechanism) {
    parts.push(`Solution mechanism: ${truncate(profile.transformation_mechanism, 100)}`);
  }
  if (parts.length === 0) {
    if (profile.brand_positioning) {
      return `Ground content in this positioning: ${truncate(profile.brand_positioning, 120)}`;
    }
    return 'Ground content in company-specific expertise and a differentiated perspective';
  }
  return parts.join('. ');
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Builds a structured WritingStyleProfile from a CompanyProfile.
 * Pure function — no async, no AI calls, no side effects.
 */
export function buildWritingStyleProfile(profile: CompanyProfile): WritingStyleProfile {
  const voice_descriptors = parseList(profile.brand_voice_list || profile.brand_voice);
  const tone_summary = deriveToneSummary(profile);
  const open_with = deriveOpenWith(profile);

  const cta_style =
    (profile.campaign_purpose_intent?.recommended_cta_style) ||
    'Soft educational — invite further reading, do not hard-sell';

  const reader_emotion_target =
    (profile.campaign_purpose_intent?.reader_emotion_target) ||
    'confident and informed';

  const authority_domains = parseList(profile.authority_domains);

  // Parse key_messages — could be a multi-line string or comma-separated
  const key_message_pillars = parseList(profile.key_messages);

  const unique_voice_note = deriveUniqueVoiceNote(profile);

  // Build forbidden list — defaults plus any brand-specific signals
  const forbidden_patterns = [...DEFAULT_FORBIDDEN_PATTERNS];

  // Build the condensed prompt_instruction paragraph
  const instructionParts: string[] = [];

  if (tone_summary) instructionParts.push(`Tone: ${tone_summary}.`);
  if (open_with) instructionParts.push(`${open_with}.`);
  if (cta_style) instructionParts.push(`CTA style: ${cta_style}.`);
  if (reader_emotion_target) {
    instructionParts.push(`The reader should leave feeling: ${reader_emotion_target}.`);
  }
  if (authority_domains.length > 0) {
    instructionParts.push(`Draw authority from: ${authority_domains.slice(0, 3).join(', ')}.`);
  }
  if (key_message_pillars.length > 0) {
    instructionParts.push(`Reinforce these message pillars: ${key_message_pillars.slice(0, 2).join('; ')}.`);
  }
  if (unique_voice_note) instructionParts.push(unique_voice_note + '.');
  instructionParts.push(`Avoid these words/phrases: ${DEFAULT_FORBIDDEN_PATTERNS.slice(0, 6).join(', ')}.`);

  const prompt_instruction = instructionParts.join(' ');

  return {
    voice_descriptors,
    tone_summary,
    open_with,
    cta_style,
    reader_emotion_target,
    authority_domains,
    key_message_pillars,
    unique_voice_note,
    forbidden_patterns,
    prompt_instruction,
  };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

/**
 * Renders a WritingStyleProfile as a structured block ready for AI prompt injection.
 * Suitable for system prompt or user prompt context sections.
 *
 * @example
 *   const style = buildWritingStyleProfile(profile);
 *   const block = formatStyleInstructions(style);
 *   // Inject block into buildGenerationUserPrompt, content-studio prompts, etc.
 */
export function formatStyleInstructions(style: WritingStyleProfile): string {
  const lines: string[] = ['WRITING STYLE GUIDE:'];

  if (style.tone_summary) {
    lines.push(`  Tone & voice: ${style.tone_summary}`);
  }
  if (style.voice_descriptors.length > 0) {
    lines.push(`  Voice descriptors: ${style.voice_descriptors.join(', ')}`);
  }
  if (style.open_with) {
    lines.push(`  Opening instruction: ${style.open_with}`);
  }
  if (style.cta_style) {
    lines.push(`  CTA style: ${style.cta_style}`);
  }
  if (style.reader_emotion_target) {
    lines.push(`  Reader should feel: ${style.reader_emotion_target}`);
  }
  if (style.authority_domains.length > 0) {
    lines.push(`  Authority domains: ${style.authority_domains.join(', ')}`);
  }
  if (style.key_message_pillars.length > 0) {
    lines.push(`  Key message pillars: ${style.key_message_pillars.join(' | ')}`);
  }
  if (style.unique_voice_note) {
    lines.push(`  Voice note: ${style.unique_voice_note}`);
  }
  if (style.forbidden_patterns.length > 0) {
    lines.push(`  Avoid: ${style.forbidden_patterns.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Convenience: build a style profile AND format it in one call.
 * Returns the formatted string block directly.
 */
export function buildFormattedStyleInstructions(profile: CompanyProfile): string {
  return formatStyleInstructions(buildWritingStyleProfile(profile));
}
