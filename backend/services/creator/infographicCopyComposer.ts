/**
 * Infographic Copy Composer.
 *
 * STEP 1 of a two-step pipeline. This module's only job is to produce
 * DENSE, INFORMATION-RICH copy for every section of an infographic.
 * The renderer (step 2) decides how to lay those parts out across
 * each card so the page reads as a "busy page" — title + lead +
 * bullets + stat + example — not a sparse poster.
 *
 * For each section the composer returns FIVE pieces of content:
 *
 *   lead    — 1–2 sentence summary (≤200 chars). Sets context.
 *   bullets — 3–5 short supporting points (≤80 chars each). Carries
 *             the bulk of the information density.
 *   stat    — optional numeric callout (value + label). Renderer
 *             pulls this out as a sidebar widget when present.
 *   example — optional concrete worked example (≤140 chars).
 *             Renderer places it as a footer accent box when present.
 *   take    — optional one-line takeaway/insight (≤90 chars). Used
 *             as a closing line.
 *
 * Plus deck-level:
 *
 *   narrative — ≤200 char line that ties the whole deck together.
 *   cta       — pass-through or generated CTA.
 *
 * Mode:
 *   - `company-context`  → brand identity grounds the copy.
 *   - `independent`      → generic second-person voice.
 *
 * Fail-open: returns operator-typed bodies unchanged on any failure.
 * Never throws.
 */

import { runCompletionWithOperation } from '../aiGateway';

export type InfographicCopyMode = 'company-context' | 'independent';

export type InfographicCopyCompanyContext = {
  name?: string;
  industry?: string;
  audience?: string;
  tone?: string;
  tagline?: string;
};

export type InfographicSectionCopy = {
  /** Operator-supplied or fallback title. Pass-through unchanged. */
  title: string;
  /** 1–2 sentence lead — sets the context for the section. */
  lead: string;
  /** 3–5 short supporting points (each ≤80 chars). Renderer
   *  bullet-lists them in the card body. */
  bullets: string[];
  /** Optional numeric callout. When present, the renderer pulls it
   *  out as a side stat widget. */
  stat: { value: string; label: string } | null;
  /** Optional concrete worked example. Renderer places it in a
   *  highlighted footer box on the card. */
  example: string | null;
  /** Optional one-line takeaway. */
  take: string | null;
  /** Positive impact — the upside of acting on this section. Renderer
   *  pulls into a green-accent "+IMPACT" mini-panel. Operator feedback
   *  flagged this as missing for enterprise-class output. */
  impact: string | null;
  /** Risk or caveat — what to watch out for. Renderer pulls into an
   *  amber-accent "RISK" mini-panel alongside the impact panel. */
  risk: string | null;
  /** True when the LLM generated this section's copy. False when it
   *  passed through from operator input or failed open. */
  generated: boolean;
};

export type InfographicCopyResult = {
  sections: InfographicSectionCopy[];
  narrative: string;
  cta: string;
  ok: boolean;
};

export type InfographicCopyInput = {
  topic: string;
  layout: string;
  sectionTitles: string[];
  sectionBodies: string[];
  cta: string;
  mode: InfographicCopyMode;
  companyContext?: InfographicCopyCompanyContext;
  companyId?: string | null;
};

function buildSystemPrompt(input: InfographicCopyInput): string {
  const lines = [
    'You are a senior infographic copywriter producing the editorial copy that will be laid out by a designer.',
    'Your job: write information-DENSE copy for each section so the infographic reads as a busy reference page — NOT a minimal poster.',
    'For every section you MUST produce all seven pieces:',
    '  • lead: 1–2 specific sentences (≤200 chars) that frame the section concretely.',
    '  • bullets: 3–5 short supporting points (each ≤80 chars). These carry the body of the information.',
    '  • stat: a numeric callout {value, label} when one is genuinely relevant — otherwise null. Do NOT fabricate stats.',
    '  • example: one concrete worked example or scenario (≤140 chars) when it helps — otherwise null.',
    '  • take: one-line takeaway sentence (≤90 chars) that lands the section.',
    '  • impact: the upside / positive outcome of acting on this section (≤80 chars).',
    '  • risk: the risk / caveat / what to watch out for (≤80 chars).',
    'IMPACT and RISK are required — they make the infographic feel balanced and enterprise-grade. Never leave them blank.',
    'The deck must read as one coherent message ending in the CTA. No emoji, no markdown, no fluff.',
    'No design directives ("use a clean font", "make sure to...") — only reader-facing content.',
  ];
  if (input.mode === 'company-context' && input.companyContext) {
    lines.push('Ground the copy in the supplied company context (audience, tone). Reference the company by name at most ONCE across the entire deck.');
  } else {
    lines.push('Independent mode — do NOT invent or use any company name; speak in second person ("you") to a generic operator-level reader.');
  }
  return lines.join(' ');
}

function buildUserPayload(input: InfographicCopyInput): string {
  const payload = {
    topic: input.topic,
    layout: input.layout,
    cta: input.cta || '(generate one)',
    company: input.mode === 'company-context' ? (input.companyContext ?? null) : null,
    sections: input.sectionTitles.map((title, idx) => ({
      index: idx,
      title,
      existing_body: input.sectionBodies[idx] ?? '',
    })),
    output_schema: {
      sections: '[{ index, lead, bullets: string[], stat: {value, label} | null, example: string | null, take: string | null, impact: string, risk: string }]',
      narrative: 'string ≤200 chars',
      cta: 'string ≤40 chars',
    },
    instruction: 'Return STRICT JSON matching output_schema. No prose outside the JSON object.',
  };
  return JSON.stringify(payload);
}

type ParsedSection = {
  index: number;
  lead: string;
  bullets: string[];
  stat: { value: string; label: string } | null;
  example: string | null;
  take: string | null;
  impact: string | null;
  risk: string | null;
};

function parseLlmResponse(raw: string): {
  sections: ParsedSection[];
  narrative: string;
  cta: string;
} | null {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (!obj || typeof obj !== 'object') return null;
    const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
    const sections: ParsedSection[] = sectionsRaw
      .filter((s: unknown) => s && typeof s === 'object' && !Array.isArray(s))
      .map((s: Record<string, unknown>) => {
        const stat = s.stat && typeof s.stat === 'object' && !Array.isArray(s.stat)
          ? {
              value: typeof (s.stat as Record<string, unknown>).value === 'string' ? String((s.stat as Record<string, unknown>).value).trim() : '',
              label: typeof (s.stat as Record<string, unknown>).label === 'string' ? String((s.stat as Record<string, unknown>).label).trim() : '',
            }
          : null;
        return {
          index: typeof s.index === 'number' ? s.index : -1,
          lead: typeof s.lead === 'string' ? s.lead.trim() : '',
          // Stricter bullet filter — the previous .filter(Boolean)
          // let whitespace-only strings through, which surfaced as
          // visible bullet dots with no readable text on the card.
          bullets: Array.isArray(s.bullets)
            ? s.bullets
                .map((b: unknown) => String(b || '').trim())
                .filter((b: string) => b.length >= 4)
            : [],
          stat: stat && stat.value && stat.label ? stat : null,
          example: typeof s.example === 'string' && s.example.trim().length > 0 ? s.example.trim() : null,
          take: typeof s.take === 'string' && s.take.trim().length > 0 ? s.take.trim() : null,
          impact: typeof s.impact === 'string' && s.impact.trim().length > 0 ? s.impact.trim() : null,
          risk: typeof s.risk === 'string' && s.risk.trim().length > 0 ? s.risk.trim() : null,
        };
      })
      .filter((s: ParsedSection) => s.index >= 0 && (s.lead.length > 0 || s.bullets.length > 0));
    const narrative = typeof obj.narrative === 'string' ? obj.narrative.trim() : '';
    const cta = typeof obj.cta === 'string' ? obj.cta.trim() : '';
    return { sections, narrative, cta };
  } catch {
    return null;
  }
}

function clamp(text: string, max: number): string {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export async function composeInfographicCopy(
  input: InfographicCopyInput,
): Promise<InfographicCopyResult> {
  const passthrough = (): InfographicCopyResult => ({
    sections: input.sectionTitles.map((title, idx) => ({
      title,
      lead: clamp(input.sectionBodies[idx] ?? '', 200),
      bullets: [],
      stat: null,
      example: null,
      take: null,
      impact: null,
      risk: null,
      generated: false,
    })),
    narrative: '',
    cta: input.cta || '',
    ok: false,
  });

  if (!Array.isArray(input.sectionTitles) || input.sectionTitles.length === 0) {
    return passthrough();
  }

  try {
    const response = await runCompletionWithOperation({
      operation: 'creator.infographic.copy',
      companyId: input.companyId ?? null,
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt(input) },
        { role: 'user', content: buildUserPayload(input) },
      ],
      // Up from 600 — the new schema (lead + 3–5 bullets + stat +
      // example + take per section, plus narrative + cta) is roughly
      // 4× the output volume of the previous one-liner schema. 1800
      // gives ~7 sections worth of room with headroom.
      max_tokens: 1800,
      temperature: 0.55,
      response_format: { type: 'json_object' },
    });
    const parsed = parseLlmResponse(String(response?.output || ''));
    if (!parsed) return passthrough();

    const sections: InfographicSectionCopy[] = input.sectionTitles.map((title, idx) => {
      const operatorBody = String(input.sectionBodies[idx] ?? '').trim();
      const llmEntry = parsed.sections.find((s) => s.index === idx);
      if (operatorBody && !llmEntry) {
        return {
          title,
          lead: clamp(operatorBody, 200),
          bullets: [],
          stat: null,
          example: null,
          take: null,
          impact: null,
          risk: null,
          generated: false,
        };
      }
      const bullets = (llmEntry?.bullets ?? [])
        .slice(0, 5)
        .map((b) => clamp(b, 80))
        .filter((b) => b.length >= 4);
      const stat = llmEntry?.stat
        ? {
            value: clamp(llmEntry.stat.value, 12),
            label: clamp(llmEntry.stat.label, 60),
          }
        : null;
      return {
        title,
        lead: clamp(llmEntry?.lead ?? operatorBody ?? '', 200),
        bullets,
        stat,
        example: llmEntry?.example ? clamp(llmEntry.example, 140) : null,
        take: llmEntry?.take ? clamp(llmEntry.take, 90) : null,
        impact: llmEntry?.impact ? clamp(llmEntry.impact, 80) : null,
        risk: llmEntry?.risk ? clamp(llmEntry.risk, 80) : null,
        generated: Boolean(llmEntry && (llmEntry.lead || llmEntry.bullets.length > 0)),
      };
    });

    const generatedCount = sections.filter((s) => s.generated).length;
    return {
      sections,
      narrative: clamp(parsed.narrative, 200),
      cta: parsed.cta || input.cta || '',
      ok: generatedCount > 0,
    };
  } catch {
    return passthrough();
  }
}
