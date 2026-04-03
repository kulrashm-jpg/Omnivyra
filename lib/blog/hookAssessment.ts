/**
 * Hook Strength Assessment
 *
 * Extracted from pages/api/admin/blog/generate.ts so both:
 *   - /api/admin/blog/generate  (Super Admin)
 *   - /api/blogs/generate       (Company Admin)
 * can import without duplication.
 *
 * No DB calls. Uses AI gateway only.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HookAssessment {
  strength: 'strong' | 'moderate' | 'weak';
  note:     string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractFirstParagraph(html: string): string {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function checkHookStrength(
  paragraph: string,
  companyId: string | null,
): Promise<HookAssessment> {
  if (!paragraph) return { strength: 'moderate', note: 'No opening paragraph found.' };

  try {
    const result = await runCompletionWithOperation({
      operation:       'blogGeneration',
      companyId,
      model:           'gpt-4o-mini',
      temperature:     0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: `Evaluate the hook strength of this blog post opening paragraph.

STRONG: Opens with a specific claim, counterintuitive insight, concrete problem, or surprising data point. Creates immediate tension or curiosity. Reader MUST continue.
MODERATE: Readable and relevant, but doesn't create urgency. Could be stronger.
WEAK: Generic, vague, sounds like AI-written padding, or could apply to any topic.

Return ONLY valid JSON:
{ "strength": "strong" | "moderate" | "weak", "note": "one specific sentence of feedback" }`,
        },
        { role: 'user', content: `Opening paragraph:\n"${paragraph}"` },
      ],
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    if (raw && typeof raw.strength === 'string' && typeof raw.note === 'string') {
      return {
        strength: ['strong', 'moderate', 'weak'].includes(raw.strength)
          ? (raw.strength as HookAssessment['strength'])
          : 'moderate',
        note: raw.note,
      };
    }
  } catch { /* fall through to default */ }

  return { strength: 'moderate', note: 'Review the opening paragraph before publishing.' };
}
