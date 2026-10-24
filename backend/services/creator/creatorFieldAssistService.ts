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
  /** THE MAIN MESSAGE (owner decision: the key). The primary on-image text; every
   *  generated field supports it — never contradicts, replaces or ignores it. */
  mainMessage?: string;
  /** What the viewer is asked to do (the brief's call to action). */
  cta?: string;
  /** The offer / product being promoted. */
  offer?: string;
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
  /** 0 (default) or up to MAX_ALTERNATIVES extra distinct candidates per field,
   *  returned as `alternatives` — the content-grounded suggestion chips. */
  alternatives?: number;
}

export interface FieldAssistUpdate {
  scope: FieldAssistScope;
  fieldKey: string;
  index?: number;
  value: string;
  /** Extra candidates for this field (only when the request asked for them). */
  alternatives?: string[];
}

export type AssistLlm = (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;

const SCOPES: ReadonlySet<FieldAssistScope> = new Set(['flat', 'slide', 'section', 'overlay', 'brief']);
const MAX_TARGETS = 60;
export const MAX_ALTERNATIVES = 3;

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
    mainMessage: clamp(str(rawContext.main_message ?? rawContext.mainMessage), 300) || undefined,
    cta: str(rawContext.cta).slice(0, 120) || undefined,
    offer: str(rawContext.offer).slice(0, 300) || undefined,
    sourceContent: str(rawContext.source_content ?? rawContext.sourceContent).slice(0, 6000) || undefined,
    siblings: Array.isArray(rawContext.siblings)
      ? (rawContext.siblings as unknown[])
          .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
          .map((s) => ({ label: str(s.label).slice(0, 80), value: str(s.value).slice(0, 400) }))
          .filter((s) => s.label && s.value)
          .slice(0, 12)
      : undefined,
  };

  const altRaw = Number(body.alternatives ?? 0);
  const alternatives = Number.isFinite(altRaw) ? Math.max(0, Math.min(MAX_ALTERNATIVES, Math.floor(altRaw))) : 0;

  return {
    ok: true,
    errors: [],
    request: {
      assetFamily: assetFamily as TemplateAssetFamily, templateId, action: action as TemplateFieldAssistAction, targets, context,
      ...(alternatives > 0 ? { alternatives } : {}),
    },
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
    request.alternatives
      ? `Return STRICT JSON of the shape {"updates":[{"scope":"flat|slide|section|overlay|brief","field_key":"...","index":<number|optional>,"value":"...","alternatives":["..."]}]} where "alternatives" holds EXACTLY ${request.alternatives} further distinct candidates for that same field (same role, same max length, each a genuinely different wording or angle grounded in the same content).`
      : 'Return STRICT JSON of the shape {"updates":[{"scope":"flat|slide|section|overlay|brief","field_key":"...","index":<number|optional>,"value":"..."}]}.',
    'Produce EXACTLY ONE update object per requested field, and echo back that field\'s EXACT scope, field_key, and index as shown in the list. The index is 0-BASED — copy the `index=` value verbatim; do NOT renumber, start at 1, or skip any index.',
    'Keep each value within its max length. Match the platform-native, concise tone of social creative copy.',
    'Every field on an asset must be DISTINCT: never repeat or lightly reword another field. A subheadline must ADD new information or angle, not restate the headline; a CTA is an action, not a headline. If a value would duplicate a sibling field shown below, write something genuinely different.',
    'On a carousel/infographic slide, the title/headline is the ONE scroll-stopping claim of that slide; the body/description must ADVANCE it with a concrete detail, proof point, benefit, or example — it must NEVER restate or lightly reword the title.',
    // Brand voice (communication style) — canonical, server-resolved.
    ...(brandVoiceLines.length ? ['Write in the brand voice:', ...brandVoiceLines] : []),
    // Ground copy in the company's ACTUAL business — never invent company facts.
    'Ground the copy in the company context provided below; do not invent products, claims, or company facts that are not given.',
    // Owner decision (2026-10-24): the main message is THE key of the asset.
    ...(ctx.mainMessage
      ? ['A MAIN MESSAGE is given below. It is the key of this asset: the headline/title/lead field EXPRESSES it (condensed to fit when needed, never replaced by a different idea), and every other field SUPPORTS it — adding proof, context, benefit or the next step for that same message. Never contradict it, drift to another topic, or ignore it.']
      : []),
    // Strength: a generic goal/category label is an ANGLE, not the message.
    // Owner decision (2026-10-24): the text the asset is made FOR drives the copy.
    'SOURCE ORDER: the user\'s own words come first — the main message (when given), the current value of the field, and the source content (the post, blog or brief this asset is made for). Build every value FROM that material. The company context only shapes tone, angle, audience and vocabulary: never copy positioning, differentiator or messaging-pillar text verbatim, never output analysis labels such as "trust model:", "audience distinction:" or "Differentiate through", and never replace the user\'s message with a company description. When source content or a current value is given for a brief/description field, refine and extend THAT text — do not replace it with a different idea.',
    'If the Topic is a generic goal or category label (e.g. "Explain a Process or How-To", "Promote an Event"), treat it ONLY as the angle/intent — when the user gave no message or source content, write specific, benefit-led copy about what the company actually offers, informed by (not copied from) the context below. NEVER output the goal/category label, a bare restatement of it, or a generic template phrase ("the detail that makes it land", "worth stopping for") as the value. Every line must say something concrete a competitor could not copy-paste.',
  ].join(' ');

  const fieldLines = resolved.map(({ target, field }) => {
    // Emit the 0-based index the mapper expects and tell the model this is the
    // Nth slide for context — without this the model returns 1-based indices and
    // the first slide (index 0) never maps back (it degrades to a placeholder).
    const idxPart = (target.scope === 'slide' || target.scope === 'section') && typeof target.index === 'number'
      ? ` index=${target.index}` : '';
    const where = target.scope === 'slide' ? ` (this is slide ${Number(target.index) + 1} of the deck)`
      : target.scope === 'section' ? ` (this is section ${Number(target.index) + 1})`
        : '';
    // Carousel/infographic slides carry a narrative-arc role so each slide advances the story.
    const roleHint = target.role
      ? ` [arc role: ${target.role}${target.roleIntent ? ` — ${target.roleIntent}` : ''}]`
      : '';
    const max = field.maxLength ? `, max ${field.maxLength} chars` : '';
    const cur = target.currentValue ? ` — current: "${target.currentValue}"` : ' — current: (empty)';
    return `- scope=${target.scope} field_key=${field.key}${idxPart}${where}${roleHint}: "${field.label}"${max}${cur}`;
  }).join('\n');

  // When the batch spans a slide arc, tell the model to treat it as ONE narrative sequence.
  const hasArc = resolved.some(({ target }) => Boolean(target.role));

  const contextLines = [
    ctx.topic ? `Topic: ${ctx.topic}` : '',
    ctx.audience ? `Audience (this asset): ${ctx.audience}` : '',
    ctx.objective ? `Objective: ${ctx.objective}` : '',
    ctx.tone ? `Requested tone: ${ctx.tone}` : '',
    ctx.mainMessage ? `MAIN MESSAGE (the key): ${ctx.mainMessage}` : '',
    ctx.offer ? `Offer / product: ${ctx.offer}` : '',
    ctx.cta ? `Viewer action (use it for any CTA field, keep it short): ${ctx.cta}` : '',
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

  // Server-resolved business facts — the company's OWN words. A fallback grounded
  // in these reads as contextual/strong; a fallback that echoes the goal label
  // ("Explain a Process or How-To") reads as broken filler. Distinct priority
  // orders per field so, when several facts exist, the fields don't collide.
  const company = context.company;
  const positioning = str(company?.positioning);
  const differentiator = str(company?.differentiators);
  const product = str(company?.products?.[0]);
  const pillar = str(company?.messagingPillars?.[0]);
  const firstOf = (...xs: Array<string | undefined>): string => xs.find((x) => !!x && x.trim().length > 0) ?? '';

  // The brief's own words outrank every derived fact: the main message IS the
  // lead line and the viewer action IS the CTA (owner decision 2026-10-24).
  const mainMessage = str(context.mainMessage);
  const briefCta = str(context.cta);
  const generateSeed = (): string => {
    if (key.includes('cta')) return briefCta ? clamp(briefCta, field.maxLength) : 'Learn more';
    if (mainMessage && (key === 'headline' || key === 'title' || key === 'quote')) {
      return clampWords(mainMessage, field.maxLength);
    }
    if (key.includes('author')) return '';
    // "Audience"/"tone" describe WHO/HOW — ground audience in the ICP when known,
    // never the goal label.
    if (key.includes('audience')) {
      const aud = firstOf(str(company?.icp), str(company?.audience?.[0]));
      return aud ? capitalize(aud) : '';
    }
    if (key.includes('tone') || key.includes('voice')) return 'Confident and clear';
    if (key.includes('metric')) return '100%';
    if (key.includes('year') || key.includes('date')) return '2024';
    if (key.includes('step')) return topic ? `${capitalize(topic)} step` : 'Key step';
    // Every MESSAGE-bearing field (body/brief, hook, key insight, headline) is built from
    // the USER'S material first — the main message, then the source content the asset is
    // made for. A company fact is only a fallback, and only as ONE short clause with the
    // profile's internal analysis labels removed: the profile informs the angle, it is
    // never pasted in as the message (a run-on "trust model: …; audience distinction: …"
    // paragraph had become the image's main message). The goal label is only ever an
    // ANGLE of last resort. Each field prefers a DIFFERENT fact so a multi-field fallback
    // stays distinct rather than repeating one positioning line.
    const userLine = firstOf(mainMessage, firstSentence(str(context.sourceContent)));
    const fact = (...xs: string[]): string => profileClause(firstOf(...xs));
    if (key.includes('freetext') || key.includes('brief') || key.includes('description') || key.includes('body')) {
      const s = firstOf(userLine, fact(positioning, differentiator, pillar));
      if (s) return clamp(capitalize(s), field.maxLength);
      return topic ? `${capitalize(topic)} — the detail that makes it land for your audience.` : field.label;
    }
    if (key.includes('hook')) {
      const s = firstOf(userLine, fact(pillar, differentiator, positioning));
      if (s) return clamp(capitalize(s), field.maxLength);
      return topic ? clamp(`${capitalize(topic)}: the part most people scroll right past.`, field.maxLength) : field.label;
    }
    if (key.includes('insight') || key.includes('takeaway')) {
      const s = firstOf(userLine, fact(differentiator, positioning, pillar));
      if (s) return clamp(capitalize(s), field.maxLength);
      return topic ? clamp(`The takeaway on ${collapseWhitespace(topic).toLowerCase()} that changes how your audience decides.`, field.maxLength) : field.label;
    }
    // Headline / offer / generic — the user's line, then a real product name, then one
    // short positioning clause, before the goal label.
    const lead = firstOf(userLine, product, fact(positioning, differentiator, pillar));
    if (lead) return clamp(capitalize(lead), field.maxLength);
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

/**
 * Per-field `alternatives` from the same LLM JSON (only read when the request
 * asked for them). Each list is clamped to the field's max length, de-duplicated
 * and capped at `max`.
 */
export function parseAssistAlternatives(
  text: string,
  resolved: Array<{ target: FieldAssistTarget; field: TemplateField }>,
  max: number,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!max) return out;
  const parsed = tryParseJson(text);
  const updates = parsed && Array.isArray((parsed as Record<string, unknown>).updates)
    ? ((parsed as Record<string, unknown>).updates as unknown[])
    : [];
  const byKey = new Map<string, unknown[]>();
  for (const u of updates) {
    const obj = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
    const scope = String(obj.scope ?? '');
    const fieldKey = String(obj.field_key ?? obj.fieldKey ?? '');
    const index = typeof obj.index === 'number' ? obj.index : undefined;
    if (!scope || !fieldKey || !Array.isArray(obj.alternatives)) continue;
    byKey.set(targetKey(scope as FieldAssistScope, fieldKey, index), obj.alternatives as unknown[]);
  }
  for (const { target, field } of resolved) {
    const k = targetKey(target.scope, target.fieldKey, target.index);
    const raw = byKey.get(k);
    if (!raw) continue;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const a of raw) {
      if (typeof a !== 'string') continue;
      const v = clamp(withoutProfileLabels(str(a)), field.maxLength);
      const n = v.toLowerCase();
      if (!v || seen.has(n)) continue;
      seen.add(n);
      list.push(v);
      if (list.length >= max) break;
    }
    if (list.length) out.set(k, list);
  }
  return out;
}

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
    if (byKey.has(k)) out.set(k, clamp(withoutProfileLabels(str(byKey.get(k)!)), field.maxLength));
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
  let llmAlternatives = new Map<string, string[]>();
  let usedFallback = false;
  let fallbackReason: string | undefined;
  if (input.llm) {
    try {
      const messages = buildFieldAssistMessages(template, request, resolved);
      const text = await input.llm(messages);
      llmValues = parseAssistResponse(text, resolved);
      llmAlternatives = parseAssistAlternatives(text, resolved, request.alternatives ?? 0);
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
    // Distinctness is enforced by the LLM's sibling-awareness (it is told not to
    // duplicate the other fields) plus the client's regenerate-on-duplicate. We
    // do NOT blank a duplicate here: emptying an optional field made a single-
    // field "+AI" click appear to do NOTHING (e.g. a fallback key-insight that
    // echoes the topic/hook). An imperfect line the user can regenerate beats an
    // empty field — so the value is always returned when non-empty.
    const finalValue = v.value;
    violations.push(...v.violations);
    // Alternatives pass the SAME brand-voice validation; a rejected or
    // duplicate candidate is dropped rather than repaired (they are optional).
    const alternatives = (llmAlternatives.get(k) ?? [])
      .map((a) => validateCreatorCopyValue(a, target.fieldKey, brandVoice))
      .filter((r) => r.ok && !r.repaired && r.value && r.value.toLowerCase() !== finalValue.toLowerCase())
      .map((r) => r.value);
    updates.push({
      scope: target.scope, fieldKey: target.fieldKey, index: target.index, value: finalValue,
      ...(alternatives.length ? { alternatives } : {}),
    });
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
/** Cap at `max` characters on a WORD boundary — copy never ends mid-word. */
function clamp(s: string, max?: number): string {
  const t = s.trim();
  if (typeof max !== 'number' || max <= 0 || t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const lastSpace = head.search(/\s\S*$/);
  const cut = lastSpace > 0 ? head.slice(0, lastSpace).replace(/[\s,;:—–-]+$/u, '').trim() : '';
  return cut || t.slice(0, max).trim();
}

/**
 * Company-profile analysis text is written for the strategy engine, not for an audience:
 * `trust model: …; audience distinction: …`, `Differentiate through …`. Reduce it to ONE
 * readable clause with those labels removed before it can seed any creative copy.
 */
export const PROFILE_ANALYSIS_LABEL = /\b(?:differentiate through|trust model|audience distinction|ecosystem role|narrative territory|monetization distinction|positioning distinction)\s*:?\s*/gi;
/** Last guard on AI output: a value never carries the profile's analysis labels. */
function withoutProfileLabels(text: string): string {
  return collapseWhitespace(String(text ?? '').replace(PROFILE_ANALYSIS_LABEL, ' '));
}
export function profileClause(text: string): string {
  const cleaned = collapseWhitespace(String(text ?? '').replace(PROFILE_ANALYSIS_LABEL, ' '));
  const first = cleaned.split(/(?<=[.!?])\s+|;\s+/u).map((s) => s.trim()).find((s) => /[A-Za-z0-9]/.test(s)) ?? '';
  return clamp(first.replace(/[.;,:]+$/, ''), 140);
}
/** Clamp at a word boundary (a fitted main message must not end mid-word). */
function clampWords(s: string, max?: number): string {
  const t = collapseWhitespace(s).replace(/[.!]+$/, '');
  if (typeof max !== 'number' || max <= 0 || t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, '').trim();
  return cut || t.slice(0, max).trim();
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
