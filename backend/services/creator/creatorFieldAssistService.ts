/**
 * Creator Field-Level AI Assist — service.
 *
 * Implements user-invoked, field-scoped AI assistance for template forms.
 * AI is an ASSISTANT: it operates ONLY on the explicitly targeted field(s),
 * returns ONLY updated field values, and NEVER regenerates a whole asset or
 * overwrites content without an explicit user action.
 *
 * Pure + decoupled. The LLM call is injected (`llm`) so the endpoint wires the
 * billed gateway while tests run offline. A deterministic transform backs every
 * action, so the endpoint always returns updated values even if the LLM is
 * unavailable.
 */

import {
  getTemplateById,
  type CreatorTemplate,
  type TemplateField,
  type TemplateAssetFamily,
  type TemplateFieldAssistAction,
  TEMPLATE_FIELD_ASSIST_ACTIONS,
  isTemplateAssetFamily,
} from '../../../lib/creator-templates';
import { buildCreatorGroundingBlock, type CreatorCompanyContext, type CreatorBrandVoice } from './creatorCopyContextResolver';
import { validateCreatorCopyValue, type CopyViolation } from './creatorCopyValidation';

export type FieldAssistScope = 'flat' | 'slide' | 'section' | 'overlay' | 'brief';

/**
 * The creation "brief" (Tell us once) is the up-front intake — a free-text brief plus audience /
 * tone / CTA / offer — that feeds every downstream field. Suggesting it with AI is the same
 * field-assist path over synthetic, role-labeled fields, grounded in the company + the chosen goal.
 */
const BRIEF_ROLE_FIELDS: Record<string, TemplateField> = {
  freeText: { key: 'freeText', label: 'Creative brief (2–3 sentences: what to create, the angle, and why it lands for this audience)', control: 'textarea', required: false, maxLength: 320, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  audience: { key: 'audience', label: 'Audience (who this asset is for)', control: 'text', required: false, maxLength: 90, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  tone: { key: 'tone', label: 'Tone (e.g. confident and friendly, bold, expert)', control: 'text', required: false, maxLength: 60, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  cta: { key: 'cta', label: 'Call to action (a short action, not a headline)', control: 'text', required: false, maxLength: 40, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  offer: { key: 'offer', label: 'Offer / product (what is being promoted)', control: 'text', required: false, maxLength: 90, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
};

/**
 * The overlay-text panel (hook / headline / supporting text / key insight / CTA) is NOT a set of
 * template-defined fields — it is the copy baked onto the creative. Each role is a synthetic field
 * so the SAME field-assist path can generate role-framed copy for it (a "hook" reads differently
 * from a "key insight"), with the same distinctness + brand-voice grounding as template fields.
 */
const OVERLAY_ROLE_FIELDS: Record<string, TemplateField> = {
  hook: { key: 'hook', label: 'Hook (the attention line that stops the scroll)', control: 'text', required: false, maxLength: 76, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  headline: { key: 'headline', label: 'Headline (the main line on the creative)', control: 'text', required: false, maxLength: 84, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  supportingText: { key: 'supportingText', label: 'Supporting text (one short proof, context, or benefit line)', control: 'text', required: false, maxLength: 96, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  keyInsight: { key: 'keyInsight', label: 'Key insight (the strongest positioning statement or takeaway)', control: 'textarea', required: false, maxLength: 132, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
  // maxLength mirrors the client overlay clamp (setOverlayField limits) — keep in sync.
  cta: { key: 'cta', label: 'Call to action (a short action, not a headline)', control: 'text', required: false, maxLength: 42, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } },
};

export interface FieldAssistTarget {
  scope: FieldAssistScope;
  fieldKey: string;
  index?: number;
  currentValue?: string;
  /** For carousel/infographic slides: this slide's role in the narrative arc (e.g. 'hook',
   *  'proof', 'cta') so generated copy is arc-aware and advances the story, not a generic repeat. */
  role?: string;
  /** Human intent for that role (e.g. "Open with a curiosity gap"). */
  roleIntent?: string;
}

export interface FieldAssistContext {
  topic?: string;
  audience?: string;
  objective?: string;
  tone?: string;
  brand?: string;
  /** Source content the asset is being BUILT FROM — the Writer post body, a campaign theme /
   *  weekly / daily card, or a longer brief. When present, generated copy (esp. carousel slides)
   *  must be derived from this content, preserving its facts and sequence — not invented from the
   *  short topic alone. */
  sourceContent?: string;
  /** Sibling fields already filled on the SAME asset — so generated copy stays DISTINCT
   *  (e.g. the subheadline must not restate the headline). Label + current value. */
  siblings?: Array<{ label: string; value: string }>;
  /** Canonical company context (business understanding) — server-resolved. */
  company?: CreatorCompanyContext;
  /** Canonical brand voice (communication style) — server-resolved. */
  brandVoice?: CreatorBrandVoice;
}

export interface FieldAssistRequest {
  assetFamily: TemplateAssetFamily;
  templateId: string;
  action: TemplateFieldAssistAction;
  targets: FieldAssistTarget[];
  context?: FieldAssistContext;
}

export interface FieldAssistUpdate {
  scope: FieldAssistScope;
  fieldKey: string;
  index?: number;
  value: string;
}

export type AssistLlm = (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;

const SCOPES: ReadonlySet<FieldAssistScope> = new Set(['flat', 'slide', 'section', 'overlay', 'brief']);
const MAX_TARGETS = 60;

/* ── Validation ─────────────────────────────────────────────────────── */

export function validateFieldAssistRequest(raw: unknown): { ok: boolean; request?: FieldAssistRequest; errors: string[] } {
  const errors: string[] = [];
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const assetFamily = body.asset_family ?? body.assetFamily;
  if (!isTemplateAssetFamily(assetFamily)) errors.push('asset_family must be image | carousel | infographic');

  const templateId = String(body.template_id ?? body.templateId ?? '').trim();
  if (!templateId) errors.push('template_id is required');

  const action = body.action;
  if (!TEMPLATE_FIELD_ASSIST_ACTIONS.includes(action as TemplateFieldAssistAction)) {
    errors.push(`action must be one of ${TEMPLATE_FIELD_ASSIST_ACTIONS.join(', ')}`);
  }

  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  if (rawTargets.length === 0) errors.push('at least one target is required');
  if (rawTargets.length > MAX_TARGETS) errors.push(`too many targets (max ${MAX_TARGETS})`);

  const targets: FieldAssistTarget[] = [];
  for (const t of rawTargets) {
    const obj = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const scope = obj.scope as FieldAssistScope;
    const fieldKey = String(obj.field_key ?? obj.fieldKey ?? '').trim();
    if (!SCOPES.has(scope) || !fieldKey) {
      errors.push('each target needs a valid scope (flat|slide|section|overlay|brief) and field_key');
      continue;
    }
    const idxRaw = obj.index ?? obj.idx;
    const index = typeof idxRaw === 'number' && Number.isInteger(idxRaw) && idxRaw >= 0 ? idxRaw : undefined;
    // Every client string is length-capped before it reaches the billed prompt.
    const role = str(obj.role).slice(0, 60) || undefined;
    const roleIntent = str(obj.role_intent ?? obj.roleIntent).slice(0, 300) || undefined;
    targets.push({ scope, fieldKey: fieldKey.slice(0, 80), index, currentValue: String(obj.current_value ?? obj.currentValue ?? '').slice(0, 1000), role, roleIntent });
  }

  if (errors.length > 0) return { ok: false, errors };

  const rawContext = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
  // Every client string is length-capped before it reaches the billed prompt (cost + injection
  // surface). Server-resolved grounding (company/brandVoice) is attached later by the route.
  const context: FieldAssistContext = {
    topic: str(rawContext.topic).slice(0, 300),
    audience: str(rawContext.audience).slice(0, 300),
    objective: str(rawContext.objective).slice(0, 300),
    tone: str(rawContext.tone).slice(0, 120),
    brand: str(rawContext.brand).slice(0, 120),
    sourceContent: str(rawContext.source_content ?? rawContext.sourceContent).slice(0, 6000) || undefined,
    siblings: Array.isArray(rawContext.siblings)
      ? (rawContext.siblings as unknown[])
          .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
          .map((s) => ({ label: str(s.label).slice(0, 80), value: str(s.value).slice(0, 400) }))
          .filter((s) => s.label && s.value)
          .slice(0, 12)
      : undefined,
  };

  return {
    ok: true,
    errors: [],
    request: { assetFamily: assetFamily as TemplateAssetFamily, templateId, action: action as TemplateFieldAssistAction, targets, context },
  };
}

/* ── Field resolution (AI may only touch template-defined fields) ───── */

export function resolveTemplateField(template: CreatorTemplate, scope: FieldAssistScope, fieldKey: string): TemplateField | null {
  // Overlay + brief roles are synthetic (baked-onto-creative copy / up-front intake), not
  // template-defined fields.
  if (scope === 'overlay') return OVERLAY_ROLE_FIELDS[fieldKey] ?? null;
  if (scope === 'brief') return BRIEF_ROLE_FIELDS[fieldKey] ?? null;
  const def = template.formDefinition;
  const pool = scope === 'slide' ? def.slides?.fields : scope === 'section' ? def.sections?.fields : def.fields;
  return (pool ?? []).find((f) => f.key === fieldKey) ?? null;
}

/** Whether the field permits the requested action (template-declared). */
export function fieldAllowsAction(field: TemplateField, action: TemplateFieldAssistAction): boolean {
  const a = field.aiAssist;
  switch (action) {
    case 'generate': return a.generate;
    case 'rewrite': return a.rewrite;
    case 'expand': return a.expand !== false && a.generate; // expand/shorten/improve default-on when generate is on
    case 'shorten': return a.shorten !== false && a.generate;
    case 'improve': return a.improve !== false && a.generate;
    default: return false;
  }
}

/* ── Prompt construction (pure) ─────────────────────────────────────── */

export function buildFieldAssistMessages(
  template: CreatorTemplate,
  request: FieldAssistRequest,
  resolved: Array<{ target: FieldAssistTarget; field: TemplateField }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const ctx = request.context ?? {};
  const actionVerb: Record<TemplateFieldAssistAction, string> = {
    generate: 'Write a fresh value',
    rewrite: 'Rewrite the existing value',
    expand: 'Expand the existing value with a bit more detail',
    shorten: 'Shorten the existing value while keeping its meaning',
    improve: 'Improve the wording of the existing value without changing its meaning',
  };
  // Canonical grounding — the SAME company + brand-voice block every Creator
  // AI prompt uses (field assist + master generation).
  const { brandVoiceLines, companyLines } = buildCreatorGroundingBlock({
    company: request.context?.company,
    brandVoice: request.context?.brandVoice,
  });

  const system = [
    `You are a marketing copy assistant for a ${template.assetFamily} asset ("${template.name}").`,
    'You ONLY produce text for the specific fields requested. You NEVER return a whole asset, extra fields, commentary, or markdown.',
    'Return STRICT JSON of the shape {"updates":[{"scope":"flat|slide|section|overlay|brief","field_key":"...","index":<number|optional>,"value":"..."}]}.',
    'Keep each value within its max length. Match the platform-native, concise tone of social creative copy.',
    'Every field on an asset must be DISTINCT: never repeat or lightly reword another field. A subheadline must ADD new information or angle, not restate the headline; a CTA is an action, not a headline. If a value would duplicate a sibling field shown below, write something genuinely different.',
    // Brand voice (communication style) — canonical, server-resolved.
    ...(brandVoiceLines.length ? ['Write in the brand voice:', ...brandVoiceLines] : []),
    // Ground copy in the company's ACTUAL business — never invent company facts.
    'Ground the copy in the company context provided below; do not invent products, claims, or company facts that are not given.',
  ].join(' ');

  const fieldLines = resolved.map(({ target, field }) => {
    const where = target.scope === 'slide' ? ` (slide ${Number(target.index) + 1})`
      : target.scope === 'section' ? ` (section ${Number(target.index) + 1})`
        : '';
    // Carousel/infographic slides carry a narrative-arc role so each slide advances the story.
    const roleHint = target.role
      ? ` [arc role: ${target.role}${target.roleIntent ? ` — ${target.roleIntent}` : ''}]`
      : '';
    const max = field.maxLength ? `, max ${field.maxLength} chars` : '';
    const cur = target.currentValue ? ` — current: "${target.currentValue}"` : ' — current: (empty)';
    return `- scope=${target.scope} field_key=${field.key}${where}${roleHint}: "${field.label}"${max}${cur}`;
  }).join('\n');

  // When the batch spans a slide arc, tell the model to treat it as ONE narrative sequence.
  const hasArc = resolved.some(({ target }) => Boolean(target.role));

  const contextLines = [
    ctx.topic ? `Topic: ${ctx.topic}` : '',
    ctx.audience ? `Audience (this asset): ${ctx.audience}` : '',
    ctx.objective ? `Objective: ${ctx.objective}` : '',
    ctx.tone ? `Requested tone: ${ctx.tone}` : '',
    // Canonical company context (business understanding) — shared grounding.
    ...companyLines,
  ].filter(Boolean).join('\n');

  // Source content the asset is built FROM (Writer post / campaign card / brief). For a carousel
  // arc this is the raw material to turn into slides; for any field it's the ground truth to draw
  // from rather than inventing from the topic.
  const sourceBlock = ctx.sourceContent
    ? `\nSource content to build from${hasArc ? ' (turn this into the slide sequence — preserve its facts, order, and specifics; do not invent beyond it)' : ' (draw from this; do not contradict or invent beyond it)'}:\n"""\n${ctx.sourceContent}\n"""`
    : '';

  // Sibling fields already on the asset — the generated value(s) MUST NOT duplicate these.
  const siblingLines = (ctx.siblings ?? [])
    .filter((s) => !resolved.some(({ field }) => field.label === s.label)) // don't list the field being written
    .map((s) => `- ${s.label}: "${s.value}"`)
    .join('\n');

  const user = [
    `${actionVerb[request.action]} for the following field(s):`,
    fieldLines,
    hasArc
      ? '\nThese slides form ONE narrative carousel: honour each slide\'s arc role, advance the story slide to slide, and NEVER repeat another slide\'s point. The hook opens with tension/curiosity; the CTA closes with a concrete next step; the middle slides build and prove.'
      : '',
    siblingLines ? `\nAlready on this asset — do NOT repeat or restate these; make the new value distinct:\n${siblingLines}` : '',
    contextLines ? `\nContext:\n${contextLines}` : '',
    sourceBlock,
    '\nReturn ONLY the JSON object.',
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/* ── Deterministic fallback transforms (pure) ───────────────────────── */

export function deterministicTransform(
  action: TemplateFieldAssistAction,
  field: TemplateField,
  currentValue: string,
  context: FieldAssistContext,
): string {
  const cur = str(currentValue);
  const topic = str(context.topic);
  const key = field.key.toLowerCase();

  const generateSeed = (): string => {
    if (key.includes('cta')) return 'Learn more';
    if (key.includes('author')) return '';
    // Role-aligned seeds so a fallback never fills every field with the goal
    // label. "Audience"/"tone" describe WHO/HOW — the goal is neither, so we
    // give a field-appropriate value (or leave audience blank) instead of a
    // duplicate. Offer/headline/body/brief legitimately restate the topic.
    if (key.includes('audience')) return '';                     // don't guess "who" — leave for the operator/LLM
    if (key.includes('tone') || key.includes('voice')) return 'Confident and clear';
    // A creative brief / description is a sentence, not the bare goal label —
    // keep it distinct from the short "offer" field.
    if (key.includes('freetext') || key.includes('brief') || key.includes('description')) {
      return topic ? `${capitalize(topic)} — a clear, benefit-led message for the right audience.` : field.label;
    }
    if (key.includes('metric')) return '100%';
    if (key.includes('year') || key.includes('date')) return '2024';
    if (key.includes('step')) return topic ? `${capitalize(topic)} step` : 'Key step';
    if (topic) return capitalize(topic);
    return field.label;
  };

  let out: string;
  switch (action) {
    case 'generate':
      out = generateSeed();
      break;
    case 'shorten':
      out = cur ? firstSentence(cur) : generateSeed();
      break;
    case 'expand':
      out = cur ? `${cur}${topic ? ` — built for ${topic}` : ' — with added detail'}` : generateSeed();
      break;
    case 'rewrite':
    case 'improve':
    default:
      out = cur ? capitalize(collapseWhitespace(cur)) : generateSeed();
      break;
  }
  return clamp(out, field.maxLength);
}

/* ── Response parsing (pure, tolerant) ──────────────────────────────── */

export function parseAssistResponse(
  text: string,
  resolved: Array<{ target: FieldAssistTarget; field: TemplateField }>,
): Map<string, string> {
  const byKey = new Map<string, string>();
  const parsed = tryParseJson(text);
  const updates = parsed && Array.isArray((parsed as Record<string, unknown>).updates)
    ? ((parsed as Record<string, unknown>).updates as unknown[])
    : [];
  for (const u of updates) {
    const obj = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
    const scope = String(obj.scope ?? '');
    const fieldKey = String(obj.field_key ?? obj.fieldKey ?? '');
    const index = typeof obj.index === 'number' ? obj.index : undefined;
    const value = typeof obj.value === 'string' ? obj.value : '';
    if (!scope || !fieldKey) continue;
    byKey.set(targetKey(scope as FieldAssistScope, fieldKey, index), value);
  }
  // Clamp to each field's max length.
  const out = new Map<string, string>();
  for (const { target, field } of resolved) {
    const k = targetKey(target.scope, target.fieldKey, target.index);
    if (byKey.has(k)) out.set(k, clamp(str(byKey.get(k)!), field.maxLength));
  }
  return out;
}

/* ── Orchestration ──────────────────────────────────────────────────── */

export interface RunFieldAssistResult {
  updates: FieldAssistUpdate[];
  usedFallback: boolean;
  invalidTargets: FieldAssistTarget[];
  /** Deterministic-validation violations that were repaired/flagged. */
  violations: CopyViolation[];
  /**
   * Why the LLM path was NOT used (so a silent degrade to the deterministic
   * transform is diagnosable instead of invisible): the LLM error message, or
   * 'llm_parsed_empty' when it returned unmappable output, or 'no_llm' when no
   * injector was provided. Undefined when the LLM produced usable values.
   */
  fallbackReason?: string;
}

/**
 * Produce updated values for ONLY the requested targets. Never returns more
 * than the targets asked for; never returns a full asset.
 */
export async function runCreatorFieldAssist(input: {
  template: CreatorTemplate;
  request: FieldAssistRequest;
  llm?: AssistLlm;
}): Promise<RunFieldAssistResult> {
  const { template, request } = input;

  const resolved: Array<{ target: FieldAssistTarget; field: TemplateField }> = [];
  const invalidTargets: FieldAssistTarget[] = [];
  for (const target of request.targets) {
    const field = resolveTemplateField(template, target.scope, target.fieldKey);
    if (!field || !fieldAllowsAction(field, request.action)) {
      invalidTargets.push(target);
      continue;
    }
    resolved.push({ target, field });
  }

  if (resolved.length === 0) {
    return { updates: [], usedFallback: false, invalidTargets, violations: [] };
  }

  let llmValues = new Map<string, string>();
  let usedFallback = false;
  let fallbackReason: string | undefined;
  if (input.llm) {
    try {
      const messages = buildFieldAssistMessages(template, request, resolved);
      const text = await input.llm(messages);
      llmValues = parseAssistResponse(text, resolved);
      if (llmValues.size === 0) {
        // The call succeeded but produced no mappable values (wrong shape / empty).
        usedFallback = true;
        fallbackReason = `llm_parsed_empty(raw_len=${typeof text === 'string' ? text.length : 0})`;
      }
    } catch (err) {
      usedFallback = true;
      fallbackReason = `llm_error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    usedFallback = true;
    fallbackReason = 'no_llm';
  }

  // Sibling values on the SAME asset — a supporting field (e.g. subheadline)
  // must ENHANCE, never be an exact copy of another field (e.g. the headline).
  const siblingValues = new Set(
    (request.context?.siblings ?? [])
      .map((s) => String(s?.value ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const updates: FieldAssistUpdate[] = [];
  const violations: CopyViolation[] = [];
  const brandVoice = request.context?.brandVoice;
  for (const { target, field } of resolved) {
    const k = targetKey(target.scope, target.fieldKey, target.index);
    let value = llmValues.get(k);
    if (value == null || value.length === 0) {
      value = deterministicTransform(request.action, field, target.currentValue ?? '', request.context ?? {});
      usedFallback = true;
    }
    // Canonical deterministic validation — repair forbidden words / prohibited
    // claims / banned CTAs / fabricated superlatives against the brand voice.
    let v = validateCreatorCopyValue(value, target.fieldKey, brandVoice);
    if (!v.ok) {
      // Repair emptied the value → deterministic fallback, then re-validate.
      value = deterministicTransform(request.action, field, target.currentValue ?? '', request.context ?? {});
      usedFallback = true;
      v = validateCreatorCopyValue(value, target.fieldKey, brandVoice);
    }
    if (v.repaired) usedFallback = true;
    // Distinctness safety net (mainly the deterministic fallback path — the LLM
    // is already told not to duplicate siblings): when a GENERATED value is an
    // exact copy of another field on the asset, drop it for OPTIONAL fields so
    // it is left blank/regenerated rather than echoing a sibling. Required
    // fields keep their value (an empty required field is worse than a dup).
    let finalValue = v.value;
    if (
      request.action === 'generate' &&
      !field.required &&
      finalValue.trim() &&
      siblingValues.has(finalValue.trim().toLowerCase())
    ) {
      finalValue = '';
      usedFallback = true;
    }
    violations.push(...v.violations);
    updates.push({ scope: target.scope, fieldKey: target.fieldKey, index: target.index, value: finalValue });
  }

  return { updates, usedFallback, invalidTargets, violations, fallbackReason };
}

/** Convenience: resolve the template then run assist (endpoint helper). */
export async function loadTemplateForAssist(request: FieldAssistRequest): Promise<CreatorTemplate | null> {
  return getTemplateById(request.templateId, request.assetFamily);
}

/* ── helpers ────────────────────────────────────────────────────────── */

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
function capitalize(s: string): string {
  const t = collapseWhitespace(s);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
function firstSentence(s: string): string {
  const m = collapseWhitespace(s).match(/^[^.!?]*[.!?]?/);
  return (m ? m[0] : s).trim();
}
function clamp(s: string, max?: number): string {
  const t = s.trim();
  return typeof max === 'number' && max > 0 && t.length > max ? t.slice(0, max).trim() : t;
}
function targetKey(scope: FieldAssistScope, fieldKey: string, index?: number): string {
  return `${scope}:${index ?? ''}:${fieldKey}`;
}
function tryParseJson(text: string): unknown {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    // Tolerate a JSON object embedded in surrounding prose.
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}
