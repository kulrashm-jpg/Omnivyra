/**
 * Readable copy for Creator generation failures.
 *
 * Render failures reach the client as machine codes, e.g.
 * `governed_render_failed_closed:render_manifest_rejected:text_density_exceeds_profile`.
 * Shown raw, they tell the user nothing about what to do — and when the real cause
 * was the AI image provider, a downstream copy code hid it completely. This maps the
 * known codes to plain language, most fundamental cause first, and keeps the code at
 * the end for support. Unknown messages pass through unchanged.
 */

type Rule = { test: RegExp; message: string };

// Ordered: a provider failure explains everything after it, so it wins.
const RULES: readonly Rule[] = [
  {
    test: /provider_image_unavailable:model_unavailable/,
    message: 'AI image generation is unavailable right now: the image model configured for this workspace is not available to its AI provider account. Your text and settings are kept — an administrator needs to enable an available image model.',
  },
  {
    test: /provider_image_unavailable:auth/,
    message: 'AI image generation is unavailable right now: the AI provider rejected this workspace\'s credentials. Your text and settings are kept — an administrator needs to update the image provider key.',
  },
  {
    test: /provider_image_unavailable:quota/,
    message: 'AI image generation is unavailable right now: the AI provider account has no remaining quota. Your text and settings are kept — try again once the account is topped up.',
  },
  {
    test: /text_density_exceeds_profile|text_area_exceeds_profile|platform_density_mismatch/,
    message: 'The text is longer than this design can hold. Shorten the headline or the supporting line and generate again.',
  },
  {
    test: /paragraph_overlay_forbidden/,
    message: 'Text on the image must be short lines, not paragraphs. Keep each field to one short sentence and generate again.',
  },
  {
    test: /typography_overlap_risk|tiny_text_risk/,
    message: 'The text would not fit legibly on this design. Use fewer or shorter text fields and generate again.',
  },
  {
    test: /cta_policy_violation/,
    message: 'This format cannot carry a call to action on the image. Remove the CTA or choose "Text inside image".',
  },
];

/** A machine code such as `governed_render_failed_closed:…` (no spaces, colon-separated). */
function extractCode(raw: string): string | null {
  const match = raw.match(/[a-z_]+(?::[a-z_]+)+/);
  return match ? match[0] : null;
}

export function describeCreatorGenerationError(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return 'Failed to generate creator content.';
  const rule = RULES.find((r) => r.test.test(text));
  if (!rule) return text;
  const code = extractCode(text);
  return code ? `${rule.message} (code: ${code})` : rule.message;
}
