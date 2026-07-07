/**
 * Creator Template Foundation — system template registry.
 *
 * Three INDEPENDENT ecosystems (image / carousel / infographic). No template
 * is shared across families. Each template defines its own category, form
 * fields (FormDefinition), and rendering contract.
 *
 * System templates only — user-created and AI-generated templates are
 * deliberately out of scope this phase. These live in code (no DB dependency),
 * mirroring the existing in-code creator strategy registries. The persistence
 * phase adds a `creator_asset_templates` table for user/AI templates and reads
 * these as the seeded system rows.
 *
 * Rendering contracts map onto EXISTING pipeline inputs only — no renderer
 * change. See ./types.ts.
 */

import {
  type CreatorTemplate,
  type TemplateField,
  type TemplateFieldAiAssist,
  type TemplateFormDefinition,
  type TemplateRenderingContract,
  CREATOR_TEMPLATE_CONTRACT_VERSION,
  defaultAiAssist,
} from './types';
import { styleFieldsForTemplate } from './styleVariants';

/** Attach the template's assigned production style variant (by inheritance
 *  from DEFAULT_*_STYLE). Templates without an explicit mapping inherit the
 *  default → byte-identical to pre-variant behavior. */
function withVariant(t: CreatorTemplate): CreatorTemplate {
  return { ...t, ...styleFieldsForTemplate(t.id, t.assetFamily) };
}

/* ── Field builders ─────────────────────────────────────────────────── */

function field(input: {
  key: string;
  label: string;
  required?: boolean;
  control?: 'text' | 'textarea';
  helperText?: string;
  maxLength?: number;
  placeholder?: string;
  aiAssist?: Partial<TemplateFieldAiAssist>;
}): TemplateField {
  return {
    key: input.key,
    label: input.label,
    control: input.control ?? 'text',
    required: input.required ?? false,
    helperText: input.helperText,
    maxLength: input.maxLength,
    placeholder: input.placeholder,
    aiAssist: { ...defaultAiAssist(), ...(input.aiAssist ?? {}) },
  };
}

const HEADLINE_HELP = 'This is the main text rendered INSIDE the image.';
const SUPPORTING_HELP = 'Optional supporting line rendered under the headline.';
const CTA_HELP = 'Call-to-action rendered on the image (leave blank for none).';

/* ── Shared builders (no duplicated metadata) ───────────────────────── */

/** Headline (+ optional subheadline + optional CTA) — the common image/banner text form. */
function headlineForm(opts: { maxHeadline?: number; sub?: boolean; subLabel?: string; cta?: boolean } = {}): TemplateField[] {
  const out: TemplateField[] = [
    field({ key: 'headline', label: 'Headline / Image Text', required: true, control: 'textarea', helperText: HEADLINE_HELP, maxLength: opts.maxHeadline ?? 80, placeholder: 'Your primary message' }),
  ];
  if (opts.sub !== false) out.push(field({ key: 'subheadline', label: opts.subLabel ?? 'Subheadline (supporting text)', required: false, control: 'textarea', helperText: SUPPORTING_HELP, maxLength: 120, placeholder: 'A short supporting line' }));
  if (opts.cta) out.push(field({ key: 'cta', label: 'Call To Action (CTA)', required: false, helperText: CTA_HELP, maxLength: 28, placeholder: 'e.g. Start free' }));
  return out;
}

/** A repeatable "label + description" infographic section group. */
function titleDescSection(sectionLabel: string, titleLabel: string, descLabel: string, min: number, max: number, titleMax = 40): NonNullable<TemplateFormDefinition['sections']> {
  return {
    kind: 'repeatable', min, max, sectionLabel,
    fields: [
      field({ key: 'title', label: titleLabel, required: true, helperText: 'Short label.', maxLength: titleMax, placeholder: titleLabel }),
      field({ key: 'description', label: descLabel, required: false, control: 'textarea', helperText: 'Supporting detail.', maxLength: 120, placeholder: descLabel }),
    ],
  };
}

const V = CREATOR_TEMPLATE_CONTRACT_VERSION;
/** Text-image / banner rendering contract (embedded copy, banner lane). */
function imageContract(purposeKey: string, subtype: string | null = null, imageComposition: string | null = null): TemplateRenderingContract {
  return { renderingContractVersion: V, family: 'image', purposeKey, subtype: subtype ?? purposeKey, attachmentMode: 'embedded_copy', writerAssetType: 'banner', imageComposition };
}
/** Common scaffold for a published system template (trims per-entry boilerplate). */
function tpl(t: Omit<CreatorTemplate, 'version' | 'status' | 'ownership' | 'metadata' | 'preview'> & { preview?: CreatorTemplate['preview'] }): CreatorTemplate {
  return {
    ...t,
    preview: t.preview ?? { thumbnailUrl: null, sampleAssetUrl: null, sample: {} },
    version: 1,
    status: 'published',
    ownership: 'system',
    metadata: {},
  };
}

/* ── IMAGE templates ────────────────────────────────────────────────── */

const IMAGE_TEMPLATES: CreatorTemplate[] = [
  {
    id: 'sys-image-headline',
    assetFamily: 'image',
    name: 'Bold Headline',
    category: 'Statement',
    description: 'A single high-impact headline rendered inside the image. Best for one strong message.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { headline: 'Ship faster without breaking trust' },
    },
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Headline / Image Text', required: true, control: 'textarea', helperText: HEADLINE_HELP, maxLength: 90, placeholder: 'The one line your audience must read' }),
      ],
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'image', purposeKey: 'promotional-image', subtype: 'promotional-image', attachmentMode: 'embedded_copy', writerAssetType: 'banner' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['headline', 'statement', 'minimal'],
    metadata: {},
  },
  {
    id: 'sys-image-headline-sub-cta',
    assetFamily: 'image',
    name: 'Headline + Subheadline + CTA',
    category: 'Promotional',
    description: 'Headline, a supporting subheadline, and a call-to-action — the classic promotional image.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { headline: 'Automate your busywork', subheadline: 'Reclaim 8 hours a week', cta: 'Start free' },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Headline / Image Text', required: true, control: 'textarea', helperText: HEADLINE_HELP, maxLength: 80, placeholder: 'Your primary message' }),
        field({ key: 'subheadline', label: 'Subheadline (supporting text)', required: false, control: 'textarea', helperText: SUPPORTING_HELP, maxLength: 120, placeholder: 'A short supporting line' }),
        field({ key: 'cta', label: 'Call To Action (CTA)', required: false, helperText: CTA_HELP, maxLength: 28, placeholder: 'e.g. Start free' }),
      ],
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'image', purposeKey: 'promotional-image', subtype: 'promotional-image', attachmentMode: 'embedded_copy', writerAssetType: 'banner' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['promotional', 'cta'],
    metadata: {},
  },
  {
    id: 'sys-image-quote-author',
    assetFamily: 'image',
    name: 'Quote + Author',
    category: 'Quote',
    description: 'A quotation with attribution — editorial, calm composition designed to elevate one line.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { quote: '“Make the right thing the easy thing.”', author: '— Dr. A. Rivera, CTO' },
    },
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#0ea5e9', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'quote', label: 'Quote (Image Text)', required: true, control: 'textarea', helperText: 'The quotation rendered inside the image.', maxLength: 160, placeholder: 'The line worth framing' }),
        field({ key: 'author', label: 'Author / Attribution', required: false, helperText: 'Who said it (rendered under the quote).', maxLength: 60, placeholder: 'e.g. — Jane Doe, CEO' }),
      ],
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'image', purposeKey: 'quote-image', subtype: 'quote-image', attachmentMode: 'embedded_copy', writerAssetType: 'banner', imageComposition: 'quote' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['quote', 'editorial'],
    metadata: {},
  },
  {
    id: 'sys-image-logo-only',
    assetFamily: 'image',
    name: 'Logo Only — No Text',
    category: 'Brand',
    description: 'A clean branded visual with the logo only and no marketing copy. Post text stays outside the image.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: {},
    },
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'support', accent: '#22c55e', surface: '#0b1220' },
    formDefinition: {
      // No text fields — logo-only/clean visual. The only optional input is a
      // visual direction hint that never renders as text.
      fields: [
        field({ key: 'visualDirection', label: 'Visual direction (optional, not rendered as text)', required: false, control: 'textarea', helperText: 'Describe the scene/mood. This guides the image but is never printed on it.', maxLength: 200, placeholder: 'e.g. calm desk workspace, morning light', aiAssist: { manual: true, paste: true, generate: true, rewrite: true } }),
      ],
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'image', purposeKey: null, subtype: null, attachmentMode: 'supporting_visual', writerAssetType: 'supporting_image' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['logo', 'clean', 'brand'],
    metadata: {},
  },
  tpl({
    id: 'sys-image-thought-leadership', assetFamily: 'image', name: 'Thought Leadership', category: 'Thought Leadership',
    description: 'A point-of-view statement that establishes authority on a topic.',
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Most onboarding fails before day one' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 110, subLabel: 'Supporting argument (optional)' }) },
    renderingContract: imageContract('educational-image'), tags: ['thought-leadership', 'pov'],
  }),
  tpl({
    id: 'sys-image-statistic', assetFamily: 'image', name: 'Statistic', category: 'Data',
    description: 'A single striking statistic with a one-line context.',
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#0ea5e9', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: '92% faster onboarding', subheadline: 'after switching to automated routing' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 40, subLabel: 'Context (what the number means)' }) },
    renderingContract: imageContract('educational-image', null, 'stat'), tags: ['stat', 'data'],
  }),
  tpl({
    id: 'sys-image-product-highlight', assetFamily: 'image', name: 'Product Highlight', category: 'Product',
    description: 'A product-forward image with a feature headline and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Routing that thinks for you', subheadline: 'Auto-assign every lead in seconds', cta: 'See it live' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, cta: true }) },
    renderingContract: imageContract('product-showcase-image'), tags: ['product', 'feature'],
  }),
  tpl({
    id: 'sys-image-testimonial', assetFamily: 'image', name: 'Customer Testimonial', category: 'Testimonial',
    description: 'A customer quote with attribution — social proof in one frame.',
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#22c55e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { quote: '“We cut response time by 60% in a month.”', author: '— Priya N., Head of Support' } },
    formDefinition: { fields: [
      field({ key: 'quote', label: 'Testimonial (Image Text)', required: true, control: 'textarea', helperText: 'The customer quote rendered inside the image.', maxLength: 180, placeholder: 'What the customer said' }),
      field({ key: 'author', label: 'Attribution', required: false, helperText: 'Name, role, company.', maxLength: 70, placeholder: '— Name, Role, Company' }),
    ] },
    renderingContract: imageContract('quote-image', null, 'quote'), tags: ['testimonial', 'social-proof'],
  }),
  tpl({
    id: 'sys-image-announcement', assetFamily: 'image', name: 'Announcement', category: 'Announcement',
    description: 'A news/announcement image with headline, detail, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#f59e0b', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Introducing Smart Routing', subheadline: 'Now in general availability', cta: 'Read the post' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['announcement', 'news'],
  }),
  tpl({
    id: 'sys-image-myth-fact', assetFamily: 'image', name: 'Myth vs Fact', category: 'Education',
    description: 'A myth paired with the correcting fact — a high-engagement education format.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#ef4444', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Myth: More tools = more output', subheadline: 'Fact: Fewer, integrated tools win' } },
    formDefinition: { fields: [
      field({ key: 'headline', label: 'Myth (Image Text)', required: true, control: 'textarea', helperText: 'The misconception, rendered on the image.', maxLength: 90, placeholder: 'Myth: …' }),
      field({ key: 'subheadline', label: 'Fact', required: true, control: 'textarea', helperText: 'The correcting fact.', maxLength: 110, placeholder: 'Fact: …' }),
    ] },
    renderingContract: imageContract('educational-image'), tags: ['myth-fact', 'education'],
  }),
  tpl({
    id: 'sys-image-before-after', assetFamily: 'image', name: 'Before / After', category: 'Transformation',
    description: 'A before-state vs after-state contrast in one image.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#14b8a6', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Before: 3 days to route a lead', subheadline: 'After: 30 seconds' } },
    formDefinition: { fields: [
      field({ key: 'headline', label: 'Before (Image Text)', required: true, control: 'textarea', helperText: 'The before state.', maxLength: 90, placeholder: 'Before: …' }),
      field({ key: 'subheadline', label: 'After', required: true, control: 'textarea', helperText: 'The after state.', maxLength: 90, placeholder: 'After: …' }),
    ] },
    renderingContract: imageContract('educational-image'), tags: ['before-after', 'transformation'],
  }),
  tpl({
    id: 'sys-image-checklist', assetFamily: 'image', name: 'Checklist', category: 'Checklist',
    description: 'A short checklist rendered as one image — title plus a few items.',
    visualLanguage: { densityBias: 'dense', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: '5-point launch checklist' } },
    formDefinition: { fields: [
      field({ key: 'headline', label: 'Checklist title (Image Text)', required: true, helperText: HEADLINE_HELP, maxLength: 70, placeholder: 'e.g. Pre-launch checklist' }),
      field({ key: 'subheadline', label: 'Items (one per line)', required: true, control: 'textarea', helperText: 'The checklist items rendered on the image.', maxLength: 220, placeholder: 'Item one\nItem two\nItem three' }),
    ] },
    renderingContract: imageContract('educational-image'), tags: ['checklist', 'list'],
  }),
  tpl({
    id: 'sys-image-promotion', assetFamily: 'image', name: 'Promotion', category: 'Promotional',
    description: 'An offer-led promotional image with offer, terms, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#f43f5e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: '30% off annual plans', subheadline: 'This week only', cta: 'Claim offer' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 60, subLabel: 'Terms / detail', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['promotion', 'offer'],
  }),
  tpl({
    id: 'sys-image-event', assetFamily: 'image', name: 'Event', category: 'Event',
    description: 'An event image with title, date/location detail, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#a855f7', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Scaling RevOps — live', subheadline: 'Thu, May 9 · 11am PT', cta: 'Save my seat' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, subLabel: 'Date / location', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['event', 'invite'],
  }),
  tpl({
    id: 'sys-image-behind-the-scenes', assetFamily: 'image', name: 'Behind the Scenes', category: 'Brand',
    description: 'A brand/culture image with a light caption — humanizing content.',
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'support', accent: '#22c55e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'How we ship on Fridays' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 90, subLabel: 'Caption (optional)' }) },
    renderingContract: imageContract('brand-focus-image'), tags: ['behind-the-scenes', 'culture'],
  }),
];

/* ── BANNER templates (image family, banner render lane) ────────────── */
// Banners are the image family's wide banner lane (writerAssetType 'banner');
// the architecture has three families, so they live under `image` with a
// Banner category rather than a new family. Reuse the canonical default style.
const BANNER_TEMPLATES: CreatorTemplate[] = [
  tpl({
    id: 'sys-banner-website-hero', assetFamily: 'image', name: 'Website Hero', category: 'Banner',
    description: 'A wide hero banner — headline, supporting line, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Pipeline on autopilot', subheadline: 'Route, qualify, and assign in seconds', cta: 'Get started' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'hero'],
  }),
  tpl({
    id: 'sys-banner-webinar', assetFamily: 'image', name: 'Webinar Banner', category: 'Banner',
    description: 'A webinar promo banner — title, date/time, and register CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Scaling RevOps in 2025', subheadline: 'Live · Thu May 9, 11am PT', cta: 'Register free' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, subLabel: 'Date / time', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'webinar'],
  }),
  tpl({
    id: 'sys-banner-event', assetFamily: 'image', name: 'Event Banner', category: 'Banner',
    description: 'An event banner — title, date/location, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#a855f7', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Meet us at SaaStr', subheadline: 'Booth 412 · Sep 10–12', cta: 'Book a slot' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, subLabel: 'Date / location', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'event'],
  }),
  tpl({
    id: 'sys-banner-sale', assetFamily: 'image', name: 'Sale Banner', category: 'Banner',
    description: 'A sale/offer banner — offer headline, terms, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'feature', accent: '#f43f5e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Save 30% this week', subheadline: 'Annual plans only', cta: 'Claim deal' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 60, subLabel: 'Terms / detail', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'sale'],
  }),
  tpl({
    id: 'sys-banner-product-launch', assetFamily: 'image', name: 'Product Launch Banner', category: 'Banner',
    description: 'A launch banner — product name, tagline, and CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#0ea5e9', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Smart Routing is here', subheadline: 'Auto-assign every lead', cta: 'Explore' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 60, subLabel: 'Tagline', cta: true }) },
    renderingContract: imageContract('product-showcase-image'), tags: ['banner', 'launch'],
  }),
  tpl({
    id: 'sys-banner-hiring', assetFamily: 'image', name: 'Hiring Banner', category: 'Banner',
    description: 'A hiring/recruiting banner — role, pitch, and apply CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#22c55e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'We’re hiring a Sr. Engineer', subheadline: 'Remote · Build the routing engine', cta: 'Apply now' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, subLabel: 'Role pitch / location', cta: true }) },
    renderingContract: imageContract('brand-focus-image'), tags: ['banner', 'hiring'],
  }),
  tpl({
    id: 'sys-banner-newsletter', assetFamily: 'image', name: 'Newsletter Banner', category: 'Banner',
    description: 'A newsletter promo banner — title, value pitch, and subscribe CTA.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#f59e0b', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'The RevOps Brief', subheadline: 'One sharp idea every Friday', cta: 'Subscribe' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 60, subLabel: 'Value pitch', cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'newsletter'],
  }),
  tpl({
    id: 'sys-banner-cta', assetFamily: 'image', name: 'CTA Banner', category: 'Banner',
    description: 'A minimal call-to-action banner — one headline and one CTA.',
    visualLanguage: { densityBias: 'minimal', brandingIntensity: 'balanced', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Ready to route smarter?', cta: 'Start free' } },
    formDefinition: { fields: headlineForm({ maxHeadline: 70, sub: false, cta: true }) },
    renderingContract: imageContract('promotional-image'), tags: ['banner', 'cta'],
  }),
];

/* ── CAROUSEL templates ─────────────────────────────────────────────── */

function slideFields(): TemplateField[] {
  return [
    field({ key: 'title', label: 'Slide title', required: true, helperText: 'The headline shown on this slide.', maxLength: 70, placeholder: 'Slide headline' }),
    field({ key: 'body', label: 'Slide body', required: false, control: 'textarea', helperText: 'Supporting copy for this slide.', maxLength: 220, placeholder: 'What this slide explains' }),
  ];
}

const CAROUSEL_TEMPLATES: CreatorTemplate[] = [
  {
    id: 'sys-carousel-educational-5',
    assetFamily: 'carousel',
    name: '5-Slide Educational',
    category: 'Educational',
    description: 'A five-slide teaching arc: hook → concept → explanation → example → takeaway.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { slides: ['Hook', 'Core concept', 'How it works', 'Example', 'Takeaway'] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
    formDefinition: {
      fields: [],
      slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: slideFields() },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 5 },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['educational', 'teaching'],
    metadata: {},
  },
  {
    id: 'sys-carousel-storytelling-7',
    assetFamily: 'carousel',
    name: '7-Slide Storytelling',
    category: 'Storytelling',
    description: 'A seven-slide narrative arc for founder stories, case studies, and journeys.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { slides: ['Setup', 'Tension', 'Turning point', 'Struggle', 'Insight', 'Resolution', 'CTA'] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    formDefinition: {
      fields: [],
      slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'carousel', purposeKey: 'story-carousel', frameCount: 7 },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['story', 'narrative'],
    metadata: {},
  },
  {
    id: 'sys-carousel-checklist-10',
    assetFamily: 'carousel',
    name: '10-Slide Checklist',
    category: 'Checklist',
    description: 'A ten-item checklist carousel — one actionable item per slide.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { slides: ['Intro', 'Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6', 'Item 7', 'Item 8', 'Recap'] },
    },
    visualLanguage: { densityBias: 'dense', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    formDefinition: {
      fields: [],
      slides: { countOptions: [5, 7, 10], defaultCount: 10, fields: slideFields() },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 10 },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['checklist', 'listicle'],
    metadata: {},
  },
  tpl({
    id: 'sys-carousel-step-by-step', assetFamily: 'carousel', name: 'Step-by-Step', category: 'How-To',
    description: 'A sequential how-to: one numbered step per slide from start to result.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#22c55e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['Overview', 'Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Result'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 7 }, tags: ['how-to', 'steps'],
  }),
  tpl({
    id: 'sys-carousel-framework', assetFamily: 'carousel', name: 'Framework', category: 'Framework',
    description: 'A named framework explained pillar-by-pillar across slides.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['The framework', 'Pillar 1', 'Pillar 2', 'Pillar 3', 'Apply it'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'framework-carousel', frameCount: 5 }, tags: ['framework', 'model'],
  }),
  tpl({
    id: 'sys-carousel-case-study', assetFamily: 'carousel', name: 'Case Study', category: 'Case Study',
    description: 'A customer case study: challenge → approach → results.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['The customer', 'The challenge', 'The approach', 'What changed', 'The results', 'Takeaway', 'CTA'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'story-carousel', frameCount: 7 }, tags: ['case-study', 'proof'],
  }),
  tpl({
    id: 'sys-carousel-before-after', assetFamily: 'carousel', name: 'Before / After', category: 'Transformation',
    description: 'A transformation arc contrasting the before state with the after state.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#14b8a6', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['The before', 'The pain', 'The shift', 'The after', 'How to start'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'story-carousel', frameCount: 5 }, tags: ['before-after', 'transformation'],
  }),
  tpl({
    id: 'sys-carousel-mistakes', assetFamily: 'carousel', name: 'Mistakes', category: 'Mistakes',
    description: 'Common mistakes to avoid — one mistake (and the fix) per slide.',
    visualLanguage: { densityBias: 'dense', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#ef4444', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['Intro', 'Mistake 1', 'Mistake 2', 'Mistake 3', 'Mistake 4', 'Mistake 5', 'Fix it'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 7 }, tags: ['mistakes', 'pitfalls'],
  }),
  tpl({
    id: 'sys-carousel-comparison', assetFamily: 'carousel', name: 'Comparison', category: 'Comparison',
    description: 'A side-by-side comparison of two options across slides.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['A vs B', 'Speed', 'Cost', 'Effort', 'Verdict'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'framework-carousel', frameCount: 5 }, tags: ['comparison', 'versus'],
  }),
  tpl({
    id: 'sys-carousel-tips', assetFamily: 'carousel', name: 'Tips', category: 'Tips',
    description: 'A quick-tips carousel — one actionable tip per slide.',
    visualLanguage: { densityBias: 'dense', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#f59e0b', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['Intro', 'Tip 1', 'Tip 2', 'Tip 3', 'Tip 4', 'Tip 5', 'Recap'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 7 }, tags: ['tips', 'quick'],
  }),
  tpl({
    id: 'sys-carousel-faq', assetFamily: 'carousel', name: 'FAQ', category: 'FAQ',
    description: 'A frequently-asked-questions carousel — one Q&A per slide.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['Top questions', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Ask more'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 7, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'educational-carousel', frameCount: 7 }, tags: ['faq', 'q-and-a'],
  }),
  tpl({
    id: 'sys-carousel-timeline', assetFamily: 'carousel', name: 'Timeline', category: 'Timeline',
    description: 'A chronological story told one milestone per slide.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides: ['The journey', '2022', '2023', '2024', 'What’s next'] } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: slideFields() } },
    renderingContract: { renderingContractVersion: V, family: 'carousel', purposeKey: 'story-carousel', frameCount: 5 }, tags: ['timeline', 'journey'],
  }),
];

/* ── INFOGRAPHIC templates ──────────────────────────────────────────── */

const INFOGRAPHIC_TEMPLATES: CreatorTemplate[] = [
  {
    id: 'sys-infographic-statistics',
    assetFamily: 'infographic',
    name: 'Statistics',
    category: 'Data',
    description: 'A metric-led infographic. Each section is a number with a short description.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { sections: [{ label: '92%', value: 'faster onboarding' }, { label: '3.4x', value: 'pipeline created' }, { label: '−40%', value: 'support tickets' }] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'The title rendered at the top of the infographic.', maxLength: 70, placeholder: 'e.g. The state of onboarding' }),
      ],
      sections: {
        kind: 'repeatable',
        min: 2,
        max: 6,
        sectionLabel: 'Statistic',
        fields: [
          field({ key: 'metric', label: 'Metric', required: true, helperText: 'The number/stat (e.g. 92%).', maxLength: 12, placeholder: '92%' }),
          field({ key: 'description', label: 'Description', required: true, helperText: 'What the metric means.', maxLength: 80, placeholder: 'faster onboarding' }),
        ],
      },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'infographic', infographicLayout: 'stats', purposeKey: 'data-visualization' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['stats', 'data'],
    metadata: {},
  },
  {
    id: 'sys-infographic-process',
    assetFamily: 'infographic',
    name: 'Process',
    category: 'Sequence',
    description: 'A step-by-step process infographic. Each section is an ordered step with a description.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { sections: [{ label: 'Step 1', value: 'Capture the lead' }, { label: 'Step 2', value: 'Qualify intent' }, { label: 'Step 3', value: 'Route to owner' }] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#22c55e', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'The title rendered at the top of the infographic.', maxLength: 70, placeholder: 'e.g. How routing works' }),
      ],
      sections: {
        kind: 'repeatable',
        min: 2,
        max: 7,
        sectionLabel: 'Step',
        fields: [
          field({ key: 'step', label: 'Step label', required: true, helperText: 'Short step name.', maxLength: 40, placeholder: 'Capture the lead' }),
          field({ key: 'description', label: 'Description', required: false, control: 'textarea', helperText: 'What happens in this step.', maxLength: 120, placeholder: 'Form submission creates a contact' }),
        ],
      },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'infographic', infographicLayout: 'process', purposeKey: 'process-timeline' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['process', 'steps'],
    metadata: {},
  },
  {
    id: 'sys-infographic-timeline',
    assetFamily: 'infographic',
    name: 'Timeline',
    category: 'Chronology',
    description: 'A chronological timeline. Each section is a year/date with an event description.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { sections: [{ label: '2022', value: 'Founded' }, { label: '2023', value: 'First 100 customers' }, { label: '2024', value: 'Series A' }] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'The title rendered at the top of the infographic.', maxLength: 70, placeholder: 'e.g. Our journey' }),
      ],
      sections: {
        kind: 'repeatable',
        min: 2,
        max: 8,
        sectionLabel: 'Milestone',
        fields: [
          field({ key: 'year', label: 'Year / Date', required: true, helperText: 'When it happened.', maxLength: 16, placeholder: '2024' }),
          field({ key: 'description', label: 'Description', required: true, control: 'textarea', helperText: 'What happened.', maxLength: 110, placeholder: 'Raised Series A' }),
        ],
      },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'infographic', infographicLayout: 'timeline', purposeKey: 'process-timeline' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['timeline', 'chronology'],
    metadata: {},
  },
  {
    id: 'sys-infographic-comparison',
    assetFamily: 'infographic',
    name: 'Comparison',
    category: 'Comparison',
    description: 'A two-column comparison. Each section is a row comparing option A vs option B.',
    preview: {
      thumbnailUrl: null,
      sampleAssetUrl: null,
      sample: { sections: [{ label: 'Manual', value: 'vs Automated' }, { label: 'Hours', value: 'vs Minutes' }] },
    },
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    formDefinition: {
      fields: [
        field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'The title rendered at the top of the infographic.', maxLength: 70, placeholder: 'e.g. Manual vs Automated' }),
        field({ key: 'columnALabel', label: 'Left column label', required: true, helperText: 'Header for the left column.', maxLength: 24, placeholder: 'Manual' }),
        field({ key: 'columnBLabel', label: 'Right column label', required: true, helperText: 'Header for the right column.', maxLength: 24, placeholder: 'Automated' }),
      ],
      sections: {
        kind: 'repeatable',
        min: 2,
        max: 6,
        sectionLabel: 'Comparison row',
        fields: [
          field({ key: 'columnA', label: 'Left value', required: true, helperText: 'Value in the left column.', maxLength: 60, placeholder: 'Takes hours' }),
          field({ key: 'columnB', label: 'Right value', required: true, helperText: 'Value in the right column.', maxLength: 60, placeholder: 'Takes minutes' }),
        ],
      },
    },
    renderingContract: { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family: 'infographic', infographicLayout: 'comparison', purposeKey: 'comparison' },
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: ['comparison', 'versus'],
    metadata: {},
  },
  tpl({
    id: 'sys-infographic-hierarchy', assetFamily: 'infographic', name: 'Hierarchy', category: 'Structure',
    description: 'A top-down hierarchy — each level is a labelled tier with a description.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Vision', value: 'North star' }, { label: 'Strategy', value: 'How we win' }, { label: 'Tactics', value: 'What we do' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. Our operating hierarchy' })], sections: titleDescSection('Level', 'Level label', 'Description', 2, 6) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'hierarchy', purposeKey: 'data-visualization' }, tags: ['hierarchy', 'structure'],
  }),
  tpl({
    id: 'sys-infographic-framework', assetFamily: 'infographic', name: 'Framework', category: 'Framework',
    description: 'A multi-pillar framework — each section is a named pillar with a description.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Acquire', value: 'Find demand' }, { label: 'Activate', value: 'Earn the first win' }, { label: 'Retain', value: 'Keep delivering' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. The growth framework' })], sections: titleDescSection('Pillar', 'Pillar label', 'Description', 2, 6) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'framework', purposeKey: 'data-visualization' }, tags: ['framework', 'pillars'],
  }),
  tpl({
    id: 'sys-infographic-pyramid', assetFamily: 'infographic', name: 'Pyramid', category: 'Structure',
    description: 'A layered pyramid (rendered as a hierarchy) — base to apex, one tier per section.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#f59e0b', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Foundation', value: 'Data + hygiene' }, { label: 'Process', value: 'Routing rules' }, { label: 'Outcome', value: 'Faster pipeline' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. The value pyramid' })], sections: titleDescSection('Tier', 'Tier label', 'Description', 2, 5) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'hierarchy', purposeKey: 'data-visualization' }, tags: ['pyramid', 'hierarchy'],
  }),
  tpl({
    id: 'sys-infographic-funnel', assetFamily: 'infographic', name: 'Funnel', category: 'Funnel',
    description: 'A conversion funnel (rendered as a sequence) — one stage per section, top to bottom.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#22c55e', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Visitors', value: '10,000' }, { label: 'Leads', value: '1,200' }, { label: 'Customers', value: '180' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. Our conversion funnel' })], sections: titleDescSection('Stage', 'Stage label', 'Description / value', 2, 6) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'process', purposeKey: 'process-timeline' }, tags: ['funnel', 'conversion'],
  }),
  tpl({
    id: 'sys-infographic-lifecycle', assetFamily: 'infographic', name: 'Lifecycle', category: 'Lifecycle',
    description: 'A repeating lifecycle (rendered as a sequence) — one phase per section.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Onboard', value: 'First value' }, { label: 'Adopt', value: 'Daily use' }, { label: 'Expand', value: 'New teams' }, { label: 'Renew', value: 'Prove ROI' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. The customer lifecycle' })], sections: titleDescSection('Phase', 'Phase label', 'Description', 2, 6) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'process', purposeKey: 'process-timeline' }, tags: ['lifecycle', 'phases'],
  }),
  tpl({
    id: 'sys-infographic-roadmap', assetFamily: 'infographic', name: 'Roadmap', category: 'Roadmap',
    description: 'A phased roadmap (rendered on a timeline) — one milestone per section.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#a855f7', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Q1', value: 'Foundation' }, { label: 'Q2', value: 'Automation' }, { label: 'Q3', value: 'Scale' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. 2025 product roadmap' })], sections: titleDescSection('Phase', 'Phase / quarter', 'What ships', 2, 8) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'timeline', purposeKey: 'process-timeline' }, tags: ['roadmap', 'phases'],
  }),
  tpl({
    id: 'sys-infographic-matrix', assetFamily: 'infographic', name: 'Matrix', category: 'Matrix',
    description: 'A 2×2-style matrix (rendered as side-by-side cells) — one quadrant per section.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#14b8a6', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'High impact / Low effort', value: 'Do now' }, { label: 'High / High', value: 'Plan' }, { label: 'Low / Low', value: 'Skip' }, { label: 'Low / High', value: 'Avoid' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. Impact / effort matrix' })], sections: titleDescSection('Quadrant', 'Quadrant label', 'Description', 2, 4, 60) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'comparison', purposeKey: 'comparison' }, tags: ['matrix', 'quadrant'],
  }),
  tpl({
    id: 'sys-infographic-decision-tree', assetFamily: 'infographic', name: 'Decision Tree', category: 'Decision',
    description: 'A decision flow (rendered as a sequence) — one decision/branch per section.',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#ef4444', surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: [{ label: 'Is it urgent?', value: 'Yes → escalate' }, { label: 'Owner free?', value: 'No → queue' }, { label: 'Route', value: 'Assign + notify' }] } },
    formDefinition: { fields: [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder: 'e.g. How we route a lead' })], sections: titleDescSection('Decision', 'Question / branch', 'Outcome', 2, 7) },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: 'process', purposeKey: 'process-timeline' }, tags: ['decision-tree', 'flow'],
  }),
];

/* ── System Template Library V1 — library completion ────────────────── */
// Rounds out the requested production library. Reuses the existing builders +
// contracts only (no architecture/rendering/generation change).

function infoTitle(placeholder: string): TemplateField[] {
  return [field({ key: 'headline', label: 'Infographic title', required: true, helperText: 'Title at the top.', maxLength: 70, placeholder })];
}
function metricSection(label: string, min: number, max: number): NonNullable<TemplateFormDefinition['sections']> {
  return { kind: 'repeatable', min, max, sectionLabel: label, fields: [
    field({ key: 'metric', label: 'Metric', required: true, helperText: 'The number/value.', maxLength: 16, placeholder: '92%' }),
    field({ key: 'description', label: 'Label', required: true, helperText: 'What it measures.', maxLength: 60, placeholder: 'faster onboarding' }),
  ] };
}
function twoColForm(aLabel: string, bLabel: string): TemplateField[] {
  return [
    field({ key: 'headline', label: `${aLabel} (Image Text)`, required: true, control: 'textarea', helperText: HEADLINE_HELP, maxLength: 80, placeholder: aLabel }),
    field({ key: 'subheadline', label: bLabel, required: true, control: 'textarea', helperText: 'The contrasting option.', maxLength: 80, placeholder: bLabel }),
  ];
}
function carouselContract(purposeKey: string, frameCount: number): TemplateRenderingContract {
  return { renderingContractVersion: V, family: 'carousel', purposeKey, frameCount };
}
function carouselTpl(id: string, name: string, category: string, description: string, accent: string, slides: string[], purposeKey: string, defaultCount: number, tags: string[]): CreatorTemplate {
  return tpl({
    id, assetFamily: 'carousel', name, category, description,
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent, surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { slides } },
    formDefinition: { fields: [], slides: { countOptions: [5, 7, 10], defaultCount, fields: slideFields() } },
    renderingContract: carouselContract(purposeKey, defaultCount), tags,
  });
}

const MORE_IMAGE_TEMPLATES: CreatorTemplate[] = [
  tpl({ id: 'sys-image-hero-announcement', assetFamily: 'image', name: 'Hero Announcement', category: 'Announcement', description: 'A bold hero-style announcement — big headline, one supporting line, and a CTA.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#2563eb', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'A new way to route revenue', subheadline: 'Smart Routing is live', cta: 'See it' } }, formDefinition: { fields: headlineForm({ maxHeadline: 70, cta: true }) }, renderingContract: imageContract('promotional-image'), tags: ['hero', 'announcement', 'launch'] }),
  tpl({ id: 'sys-image-feature-highlight', assetFamily: 'image', name: 'Feature Highlight', category: 'Product', description: 'Spotlight one capability — feature headline, benefit line, and CTA.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Auto-assign in 30 seconds', subheadline: 'No rules to maintain', cta: 'Try it' } }, formDefinition: { fields: headlineForm({ maxHeadline: 70, subLabel: 'Benefit', cta: true }) }, renderingContract: imageContract('product-showcase-image'), tags: ['feature', 'product', 'benefit'] }),
  tpl({ id: 'sys-image-comparison', assetFamily: 'image', name: 'Comparison', category: 'Comparison', description: 'A two-option contrast rendered in one image.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Manual routing', subheadline: 'vs Automated routing' } }, formDefinition: { fields: twoColForm('Option A', 'Option B') }, renderingContract: imageContract('educational-image'), tags: ['comparison', 'versus'] }),
  tpl({ id: 'sys-image-company-update', assetFamily: 'image', name: 'Company Update', category: 'Update', description: 'A company/product update — headline plus a short detail.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#22c55e', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'What shipped in April', subheadline: 'Routing, dashboards, and more' } }, formDefinition: { fields: headlineForm({ maxHeadline: 90 }) }, renderingContract: imageContract('brand-focus-image'), tags: ['update', 'news', 'company'] }),
  tpl({ id: 'sys-image-milestone', assetFamily: 'image', name: 'Milestone', category: 'Celebration', description: 'A celebratory milestone — the number/achievement and a thank-you line.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#f59e0b', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: '1,000 customers', subheadline: 'Thank you for routing with us', cta: 'Join them' } }, formDefinition: { fields: headlineForm({ maxHeadline: 40, subLabel: 'Detail', cta: true }) }, renderingContract: imageContract('brand-focus-image'), tags: ['milestone', 'celebration', 'gratitude'] }),
  tpl({ id: 'sys-image-thank-you', assetFamily: 'image', name: 'Thank You', category: 'Celebration', description: 'A simple thank-you / gratitude card.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#ec4899', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Thank you', subheadline: 'To everyone who shipped with us this year' } }, formDefinition: { fields: headlineForm({ maxHeadline: 60, subLabel: 'Message' }) }, renderingContract: imageContract('brand-focus-image'), tags: ['thank-you', 'gratitude'] }),
  tpl({ id: 'sys-image-tip-card', assetFamily: 'image', name: 'Tip Card', category: 'Education', description: 'A single actionable tip rendered as one card.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent: '#14b8a6', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Tip: Route on intent, not source', subheadline: 'It lifts conversion 20%+' } }, formDefinition: { fields: headlineForm({ maxHeadline: 80, subLabel: 'Why it works' }) }, renderingContract: imageContract('educational-image'), tags: ['tip', 'education', 'advice'] }),
  // ── Style-led variants (visual language differentiation) ──
  tpl({ id: 'sys-image-minimal-brand-card', assetFamily: 'image', name: 'Minimal Brand Card', category: 'Style', description: 'A minimal, brand-forward card — one line, lots of breathing room.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'strong', typographyWeight: 'feature', accent: '#64748b', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Make routing effortless' } }, formDefinition: { fields: headlineForm({ maxHeadline: 70, sub: false }) }, renderingContract: imageContract('brand-focus-image'), tags: ['minimal', 'brand', 'style'] }),
  tpl({ id: 'sys-image-premium-luxury', assetFamily: 'image', name: 'Premium Luxury', category: 'Style', description: 'An elevated, premium aesthetic — restrained type and a refined accent.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'balanced', typographyWeight: 'feature', accent: '#a16207', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Built for teams that demand more', subheadline: 'Enterprise-grade routing' } }, formDefinition: { fields: headlineForm({ maxHeadline: 80 }) }, renderingContract: imageContract('brand-focus-image'), tags: ['premium', 'luxury', 'style'] }),
  tpl({ id: 'sys-image-bold-marketing', assetFamily: 'image', name: 'Bold Marketing', category: 'Style', description: 'A loud, high-energy promotional style with a strong CTA.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'feature', accent: '#ef4444', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Stop losing leads', subheadline: 'Route every one in seconds', cta: 'Fix it now' } }, formDefinition: { fields: headlineForm({ maxHeadline: 60, cta: true }) }, renderingContract: imageContract('promotional-image'), tags: ['bold', 'marketing', 'style'] }),
  tpl({ id: 'sys-image-corporate', assetFamily: 'image', name: 'Corporate', category: 'Style', description: 'A professional corporate style — measured tone, navy palette.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#1e3a8a', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Operational excellence at scale', subheadline: 'Trusted by RevOps leaders' } }, formDefinition: { fields: headlineForm({ maxHeadline: 80 }) }, renderingContract: imageContract('brand-focus-image'), tags: ['corporate', 'professional', 'style'] }),
  tpl({ id: 'sys-image-modern-tech', assetFamily: 'image', name: 'Modern Tech', category: 'Style', description: 'A modern, technical aesthetic — clean type and a cyan accent.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#06b6d4', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'AI-native routing', subheadline: 'Decisions in milliseconds', cta: 'See the API' } }, formDefinition: { fields: headlineForm({ maxHeadline: 70, cta: true }) }, renderingContract: imageContract('product-showcase-image'), tags: ['modern', 'tech', 'style'] }),
  tpl({ id: 'sys-image-creative', assetFamily: 'image', name: 'Creative', category: 'Style', description: 'An expressive, creative style with a vivid accent.', visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#ec4899', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'Routing, reimagined' } }, formDefinition: { fields: headlineForm({ maxHeadline: 70 }) }, renderingContract: imageContract('educational-image'), tags: ['creative', 'expressive', 'style'] }),
  tpl({ id: 'sys-image-clean-editorial', assetFamily: 'image', name: 'Clean Editorial', category: 'Style', description: 'A calm editorial style — generous space and a long, considered line.', visualLanguage: { densityBias: 'minimal', brandingIntensity: 'subtle', typographyWeight: 'feature', accent: '#94a3b8', surface: '#0b1220' }, preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { headline: 'The quiet advantage of fewer, better tools', subheadline: 'A short essay in one image' } }, formDefinition: { fields: headlineForm({ maxHeadline: 110 }) }, renderingContract: imageContract('educational-image'), tags: ['editorial', 'clean', 'style'] }),
];

const MORE_CAROUSEL_TEMPLATES: CreatorTemplate[] = [
  carouselTpl('sys-carousel-problem-solution', 'Problem → Solution', 'Problem/Solution', 'A problem-first arc that resolves into your solution.', '#ef4444', ['The problem', 'Why it persists', 'The cost', 'The solution', 'The result'], 'story-carousel', 5, ['problem-solution', 'pain']),
  carouselTpl('sys-carousel-listicle', 'Listicle', 'Listicle', 'A numbered list — one item per slide.', '#f59e0b', ['Intro', '1.', '2.', '3.', '4.', '5.', 'Recap'], 'educational-carousel', 7, ['listicle', 'list']),
  carouselTpl('sys-carousel-customer-journey', 'Customer Journey', 'Journey', 'The customer journey across stages, one stage per slide.', '#0ea5e9', ['Awareness', 'Consideration', 'Decision', 'Onboarding', 'Expansion'], 'story-carousel', 5, ['journey', 'customer']),
  carouselTpl('sys-carousel-product-walkthrough', 'Product Walkthrough', 'Product', 'A guided product walkthrough — one screen/step per slide.', '#7c3aed', ['Overview', 'Capture', 'Qualify', 'Route', 'Report', 'Result'], 'educational-carousel', 7, ['walkthrough', 'product', 'demo']),
  carouselTpl('sys-carousel-transformation', 'Transformation', 'Transformation', 'A transformation story from old way to new way.', '#14b8a6', ['The old way', 'The breaking point', 'The shift', 'The new way', 'The payoff'], 'story-carousel', 5, ['transformation', 'change']),
  carouselTpl('sys-carousel-process', 'Process', 'Process', 'A process explained stage-by-stage.', '#22c55e', ['Overview', 'Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Outcome'], 'educational-carousel', 7, ['process', 'workflow']),
  carouselTpl('sys-carousel-marketing-funnel', 'Marketing Funnel', 'Funnel', 'A marketing funnel from top to bottom, one stage per slide.', '#a855f7', ['The funnel', 'Awareness', 'Interest', 'Decision', 'Action'], 'framework-carousel', 5, ['funnel', 'marketing']),
  carouselTpl('sys-carousel-thought-leadership', 'Thought Leadership', 'Thought Leadership', 'A point-of-view argument built across slides.', '#2563eb', ['The claim', 'Why it matters', 'The evidence', 'The implication', 'What to do'], 'story-carousel', 5, ['thought-leadership', 'pov']),
];

function infographicTpl(id: string, name: string, category: string, description: string, accent: string, layout: string, purposeKey: string, sections: NonNullable<TemplateFormDefinition['sections']>, sample: Array<{ label: string; value: string }>, titlePlaceholder: string, tags: string[]): CreatorTemplate {
  return tpl({
    id, assetFamily: 'infographic', name, category, description,
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'subtle', typographyWeight: 'lead', accent, surface: '#0b1220' },
    preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: { sections: sample } },
    formDefinition: { fields: infoTitle(titlePlaceholder), sections },
    renderingContract: { renderingContractVersion: V, family: 'infographic', infographicLayout: layout, purposeKey }, tags,
  });
}

const MORE_INFOGRAPHIC_TEMPLATES: CreatorTemplate[] = [
  infographicTpl('sys-infographic-cycle', 'Cycle', 'Cycle', 'A repeating cycle — one phase per section.', '#0ea5e9', 'process', 'process-timeline', titleDescSection('Phase', 'Phase label', 'Description', 3, 6), [{ label: 'Plan', value: 'Set the goal' }, { label: 'Do', value: 'Execute' }, { label: 'Review', value: 'Measure' }], 'e.g. The improvement cycle', ['cycle', 'loop']),
  infographicTpl('sys-infographic-swot', 'SWOT', 'Analysis', 'A SWOT analysis — four quadrants (Strengths, Weaknesses, Opportunities, Threats).', '#7c3aed', 'comparison', 'comparison', titleDescSection('Quadrant', 'Quadrant (S/W/O/T)', 'Detail', 4, 4, 28), [{ label: 'Strengths', value: 'Fast routing' }, { label: 'Weaknesses', value: 'New brand' }, { label: 'Opportunities', value: 'AI demand' }, { label: 'Threats', value: 'Incumbents' }], 'e.g. SWOT analysis', ['swot', 'analysis']),
  infographicTpl('sys-infographic-workflow', 'Workflow', 'Sequence', 'A workflow — one ordered step per section.', '#22c55e', 'process', 'process-timeline', titleDescSection('Step', 'Step label', 'What happens', 2, 7), [{ label: 'Trigger', value: 'Form submit' }, { label: 'Enrich', value: 'Add context' }, { label: 'Route', value: 'Assign owner' }], 'e.g. The routing workflow', ['workflow', 'automation']),
  infographicTpl('sys-infographic-kpi-dashboard', 'KPI Dashboard', 'Data', 'A KPI snapshot — each section is a metric with a label.', '#2563eb', 'stats', 'data-visualization', metricSection('KPI', 3, 6), [{ label: '92%', value: 'on-time routing' }, { label: '3.4x', value: 'pipeline' }, { label: '−40%', value: 'tickets' }], 'e.g. Q2 KPI snapshot', ['kpi', 'dashboard', 'metrics']),
  infographicTpl('sys-infographic-feature-comparison', 'Feature Comparison', 'Comparison', 'A feature-by-feature comparison across two options.', '#7c3aed', 'comparison', 'comparison', titleDescSection('Feature', 'Feature', 'A vs B', 2, 6, 60), [{ label: 'Setup', value: 'Hours vs Minutes' }, { label: 'Rules', value: 'Many vs None' }], 'e.g. Us vs Them', ['feature-comparison', 'versus']),
  infographicTpl('sys-infographic-product-architecture', 'Product Architecture', 'Structure', 'A layered product architecture — one layer per section.', '#06b6d4', 'hierarchy', 'data-visualization', titleDescSection('Layer', 'Layer label', 'What it does', 2, 6), [{ label: 'Ingestion', value: 'Capture events' }, { label: 'Engine', value: 'Decide routing' }, { label: 'Delivery', value: 'Assign + notify' }], 'e.g. How it’s built', ['architecture', 'product', 'structure']),
  infographicTpl('sys-infographic-business-model', 'Business Model', 'Framework', 'A business-model overview — one building block per section.', '#f59e0b', 'framework', 'data-visualization', titleDescSection('Block', 'Block label', 'Description', 2, 6), [{ label: 'Customers', value: 'RevOps teams' }, { label: 'Value', value: 'Faster pipeline' }, { label: 'Revenue', value: 'Per-seat SaaS' }], 'e.g. Our business model', ['business-model', 'strategy']),
  infographicTpl('sys-infographic-org-structure', 'Org Structure', 'Structure', 'An org structure — one level/team per section.', '#2563eb', 'hierarchy', 'data-visualization', titleDescSection('Level', 'Team / role', 'Description', 2, 6), [{ label: 'Leadership', value: 'Sets direction' }, { label: 'RevOps', value: 'Runs the system' }, { label: 'Reps', value: 'Work the pipeline' }], 'e.g. How we’re organized', ['org', 'team', 'structure']),
  infographicTpl('sys-infographic-customer-journey', 'Customer Journey', 'Journey', 'A customer journey across stages — one stage per section.', '#14b8a6', 'timeline', 'process-timeline', titleDescSection('Stage', 'Stage label', 'What happens', 3, 6), [{ label: 'Aware', value: 'Find us' }, { label: 'Evaluate', value: 'Compare' }, { label: 'Adopt', value: 'First value' }, { label: 'Expand', value: 'New teams' }], 'e.g. The customer journey', ['journey', 'customer']),
];

/* ── Metadata enrichment (search / filter / difficulty / use cases / aspect) ── */

type TemplateDifficulty = 'easy' | 'intermediate' | 'advanced';
const ASPECT_BY_FAMILY: Readonly<Record<string, string[]>> = {
  image: ['square', 'portrait', 'landscape'],
  carousel: ['square', 'portrait'],
  infographic: ['portrait'],
};
function difficultyFor(t: CreatorTemplate): TemplateDifficulty {
  if (t.assetFamily !== 'image') {
    const slideCount = t.formDefinition.slides?.defaultCount ?? 0;
    const maxSections = t.formDefinition.sections?.max ?? 0;
    return slideCount > 7 || maxSections > 6 ? 'advanced' : 'intermediate';
  }
  return t.visualLanguage.densityBias === 'minimal' ? 'easy' : t.visualLanguage.densityBias === 'dense' ? 'advanced' : 'intermediate';
}
/** Attach deterministic library metadata used for search, filtering, and
 *  difficulty/use-case surfacing. Idempotent — preserves any explicit values. */
function enrichMetadata(t: CreatorTemplate): CreatorTemplate {
  const keywords = Array.from(new Set(
    `${t.name} ${t.category} ${t.tags.join(' ')}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1),
  ));
  const m = t.metadata ?? {};
  return {
    ...t,
    metadata: {
      ...m,
      keywords,
      searchText: `${t.name} ${t.category} ${t.description}`.toLowerCase(),
      category: t.category,
      difficulty: (m.difficulty as TemplateDifficulty | undefined) ?? difficultyFor(t),
      recommendedUseCases: (m.recommendedUseCases as string[] | undefined) ?? Array.from(new Set([t.category, ...t.tags.slice(0, 2)])),
      aspectSupport: (m.aspectSupport as string[] | undefined) ?? ASPECT_BY_FAMILY[t.assetFamily] ?? ['square'],
    },
  };
}

/** All system templates, indexed by family. Frozen — read-only registry. */
// Banners are the image family's wide banner lane (no separate family in the
// architecture), so they're surfaced within the image bucket.
// Production style differentiation: each template carries its assigned variant
// (TEMPLATE-013), built by inheritance from DEFAULT_*_STYLE; then deterministic
// library metadata is enriched onto every template.
const IMAGE_AND_BANNER_TEMPLATES: CreatorTemplate[] = [...IMAGE_TEMPLATES, ...BANNER_TEMPLATES, ...MORE_IMAGE_TEMPLATES].map(withVariant).map(enrichMetadata);
const CAROUSEL_TEMPLATES_STYLED: CreatorTemplate[] = [...CAROUSEL_TEMPLATES, ...MORE_CAROUSEL_TEMPLATES].map(withVariant).map(enrichMetadata);
const INFOGRAPHIC_TEMPLATES_STYLED: CreatorTemplate[] = [...INFOGRAPHIC_TEMPLATES, ...MORE_INFOGRAPHIC_TEMPLATES].map(withVariant).map(enrichMetadata);

export const SYSTEM_TEMPLATES: Readonly<Record<'image' | 'carousel' | 'infographic', readonly CreatorTemplate[]>> = Object.freeze({
  image: Object.freeze(IMAGE_AND_BANNER_TEMPLATES),
  carousel: Object.freeze(CAROUSEL_TEMPLATES_STYLED),
  infographic: Object.freeze(INFOGRAPHIC_TEMPLATES_STYLED),
});

/** Flat list of every system template. */
export const ALL_SYSTEM_TEMPLATES: readonly CreatorTemplate[] = Object.freeze([
  ...IMAGE_AND_BANNER_TEMPLATES,
  ...CAROUSEL_TEMPLATES_STYLED,
  ...INFOGRAPHIC_TEMPLATES_STYLED,
]);
