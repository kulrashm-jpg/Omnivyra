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
import { promptSchemaFor, validateRoleResponse, staticRoleContent, type ContractResult } from './infographicSemanticContract';

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
  /** CREATOR-110: skip the AI call and use the deterministic static builder. Used by
   *  Sample Gallery preview population (no AI provider) so the production renderer runs
   *  locally without hanging on an unconfigured LLM gateway. */
  staticOnly?: boolean;
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

/**
 * Deterministic text builder. Generates real, contextual content for
 * every section regardless of whether the LLM call succeeded — so
 * the rendered infographic NEVER has empty bullet / impact / risk /
 * example zones.
 *
 * Strategy: each section's icon role (cycled by index — lightbulb,
 * target, growth, check, bolt, gear) implies a SEMANTIC ROLE
 * (insight, focus, growth, validation, impact, system). The
 * generator stitches the section title into a topic-aware template
 * family chosen by that role. Output is dense and reads as written
 * editorial copy, not Lorem Ipsum.
 *
 * When the LLM also returns content, the LLM value wins; the
 * generator value is the floor. Either way, every field is filled.
 */
function buildStaticSectionContent(input: {
  topic: string;
  title: string;
  iconIndex: number;
}): {
  lead: string;
  bullets: string[];
  impact: string;
  risk: string;
  example: string;
  take: string;
} {
  const title = String(input.title || '').trim() || 'This section';
  const topic = String(input.topic || '').trim() || 'this topic';
  const titleLower = title.toLowerCase();
  const role = input.iconIndex % 6;

  // Role-tuned content templates. Each writes lead + bullets +
  // impact + risk + example + take that reads as written copy. The
  // section title is the anchor; templates compose around it without
  // sounding mechanical.
  switch (role) {
    case 0: // lightbulb — insight / blind spot
      return {
        lead: `${title} is the assumption operators carry into ${topic} without naming it. When the assumption holds you ship faster; when it breaks you spend weeks unwinding decisions you cannot easily reverse.`,
        bullets: [
          `Assumptions nobody wrote down still drive the call`,
          `Trade-offs surface only after the decision is made`,
          `Stakeholder context arrives later than it should`,
          `What looks irreversible is usually recoverable`,
        ],
        impact: `Naming the unspoken assumption removes the biggest hidden risk`,
        risk: `Calling it out can feel personal — frame as process, not blame`,
        example: `A team picks vendor A on price; six months in the integration cost is 3x the savings they modeled.`,
        take: `What you do not name still drives the outcome`,
      };
    case 1: // target — focus / alignment
      return {
        lead: `${title} is what keeps the team pointing at the same outcome when scope expands. Without it, ${topic} becomes a moving target and every meeting relitigates last week's decision.`,
        bullets: [
          `One sentence everyone repeats in any room`,
          `A single owner accountable for the outcome`,
          `A scope boundary written down and dated`,
          `A pre-mortem of what success will look like`,
        ],
        impact: `The team stops re-debating settled decisions and ships faster`,
        risk: `Over-tightening focus can blind the team to a better path`,
        example: `A product re-org with no written focus statement re-prioritized the roadmap three times in one quarter.`,
        take: `Alignment is a written sentence, not a meeting`,
      };
    case 2: // growth arrow — trajectory / compounding
      return {
        lead: `${title} compounds when applied consistently. Most teams treat ${topic} as a one-time exercise; the leverage is in repeating it through every cycle so each round starts from a higher floor.`,
        bullets: [
          `Apply the same lens every quarter, not once`,
          `Track the inputs, not just the outputs`,
          `Reinvest learnings into the next iteration`,
          `Set a cadence the team can defend`,
        ],
        impact: `Each cycle compounds — the system improves while the cost stays flat`,
        risk: `Without measurement the compounding is invisible and the budget gets cut`,
        example: `A growth team that ran the same retro template weekly cut time-to-experiment from 9 days to 2 in six months.`,
        take: `Compounding only happens when the cadence holds`,
      };
    case 3: // checkmark — validation / proof
      return {
        lead: `${title} has been validated across multiple teams and produces a measurable result when executed correctly. ${topic} works because operators have road-tested the steps — not because the theory is elegant.`,
        bullets: [
          `Field-tested across multiple team sizes`,
          `Outcome measurable within a single cycle`,
          `Failure modes documented from real attempts`,
          `Replication kit exists — not just a writeup`,
        ],
        impact: `Reduces risk: someone else already paid the tuition for this lesson`,
        risk: `Validated playbooks can ossify; revisit assumptions every quarter`,
        example: `A 12-week onboarding redesign at three companies cut ramp time from 90 days to 45 with the same hiring bar.`,
        take: `Proof beats novelty — copy what already works`,
      };
    case 4: // bolt — impact / leverage
      return {
        lead: `${title} is the highest-leverage move in ${topic}. Small input, outsized output: when the conditions line up this is the action that delivers more visible result than the next ten combined.`,
        bullets: [
          `Highest impact-to-effort ratio in the workflow`,
          `Triggers a chain reaction across adjacent steps`,
          `Visible enough to build organizational momentum`,
          `Reversible if the early signal is wrong`,
        ],
        impact: `One decisive move that shifts the trajectory of the entire effort`,
        risk: `Moving fast on the wrong lever wastes the political capital`,
        example: `A pricing change shipped on a Tuesday lifted activation 18% by Friday — the team had debated it for six months.`,
        take: `Find the leverage point, then move decisively`,
      };
    default: // gear — system / repeatability
      return {
        lead: `${title} is the repeatable system underneath ${topic}. When it works, the team stops relying on heroics and instead runs a process that scales with the company without re-explaining the steps every cycle.`,
        bullets: [
          `Written down so a new hire can execute it`,
          `Inputs and outputs measurable end-to-end`,
          `Failure modes have defined recovery paths`,
          `The system improves the next person who runs it`,
        ],
        impact: `Removes hero dependency — the system runs whether the founder is in the room or not`,
        risk: `Over-systematizing kills the ability to adapt when the context shifts`,
        example: `A revenue ops team documented their pipeline review in 14 steps; new AEs hit quota in cycle 2 instead of cycle 4.`,
        take: `A repeatable system beats a brilliant operator`,
      };
  }
}

export async function composeInfographicCopy(
  input: InfographicCopyInput,
): Promise<InfographicCopyResult> {
  // CREATOR-115: ROLE-AWARE structured generation. The sample's layout defines the
  // semantic role of each slot; the LLM returns role-typed JSON validated against the
  // contract; the renderer paints validated objects — never inferred-from-prose.
  const slotCount = Array.isArray(input.sectionTitles) ? input.sectionTitles.length : 0;
  const toResult = (c: ContractResult): InfographicCopyResult => ({
    sections: c.sections.map((sec) => ({
      title: clamp(sec.title, 60),
      lead: clamp(sec.lead || sec.body, 200),
      bullets: (sec.bullets ?? []).map((b) => clamp(b, 80)),
      stat: sec.stat ?? null,
      example: sec.example ?? null,
      take: sec.take ?? null,
      impact: sec.impact ?? null,
      risk: sec.risk ?? null,
      generated: true,
    })),
    narrative: clamp(c.summary, 200),
    cta: c.cta || input.cta || 'Take the next step',
    ok: c.sections.length > 0,
  });
  // Deterministic role-typed fallback (no LLM): previews + rejected model output.
  const roleFallback = (): InfographicCopyResult => toResult(staticRoleContent(input.layout, slotCount, input.topic, input.sectionTitles));

  if (input.staticOnly || slotCount === 0) {
    return roleFallback();
  }

  try {
    const response = await runCompletionWithOperation({
      operation: 'creator.infographic.copy',
      companyId: input.companyId ?? null,
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildRoleSystemPrompt(input, slotCount) },
        { role: 'user', content: buildRoleUserPayload(input, slotCount) },
      ],
      max_tokens: 1800,
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });
    let parsed: unknown = null;
    try { parsed = JSON.parse(String(response?.output || '')); } catch { parsed = null; }
    // RULE 3: STRICT validation against the sample's semantic structure. A response that
    // is the wrong shape / count / role is REJECTED and degrades to the role fallback —
    // never silently repaired into a different structure.
    const validation = validateRoleResponse(input.layout, parsed, slotCount);
    if (!validation.ok || !validation.result) return roleFallback();
    return toResult(validation.result);
  } catch {
    return roleFallback();
  }
}

/** CREATOR-115: role-aware system prompt — the LLM fills the sample's semantic slots. */
function buildRoleSystemPrompt(input: InfographicCopyInput, slotCount: number): string {
  return [
    'You FILL predefined semantic slots for an infographic. Return VALID JSON ONLY — no prose, no markdown, no commentary, no extra fields.',
    `The infographic uses the "${input.layout}" structure. Return EXACTLY this JSON shape and nothing else:`,
    promptSchemaFor(input.layout, slotCount),
    'Rules: every field is required and non-empty; arrays must contain EXACTLY the stated number of items; do NOT add, remove, or rename any field; do NOT change the structure.',
    'Write content specific to each slot\'s ROLE — a KPI is a metric {label, value, explanation}; a process step is a sequential action {title, body, outcome}; a comparison side is {name, advantages, limitations}. Do not fabricate precise statistics you cannot justify.',
    input.mode === 'company-context' && input.companyContext
      ? 'Ground the copy in the supplied company context; reference the company by name at most once.'
      : 'Independent mode — do not invent or use any company name; address a generic operator-level reader in second person.',
  ].join('\n');
}

/** CREATOR-115: role-aware user payload — the brief + slot hints, no structure to invent. */
function buildRoleUserPayload(input: InfographicCopyInput, slotCount: number): string {
  return JSON.stringify({
    topic: input.topic,
    cta: input.cta || '(generate one)',
    slot_hints: (input.sectionTitles ?? []).slice(0, slotCount),
    company: input.mode === 'company-context' ? (input.companyContext ?? null) : null,
  });
}
