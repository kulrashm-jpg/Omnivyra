/**
 * Canonical Design System object model (CREATOR-130 — Foundation).
 *
 * This is the PERMANENT architecture every curated, AI-generated, user-created,
 * campaign, and future visual asset binds to. It is the contract layer only — pure
 * types + a deterministic promoter from the existing CreatorTemplate. It introduces
 * NO renderer change and is inert until consumers migrate (PHASE 11: progressive,
 * backward-compatible).
 *
 *   DesignSystem
 *     ├─ DesignLanguage      (tokens — the look, independent of layout/content)
 *     ├─ PhotographySystem?  (image family — the AI prompt is generated FROM this)
 *     ├─ StorytellingSystem? (carousel family — narrative progression, not slides)
 *     ├─ ComponentLibrary    (first-class Components + Variants — drawn once)
 *     └─ CompositionRules    (how components arrange)
 *
 * A Template becomes `DesignSystem + content`. GenerationDNA is reduced to per-
 * instance content/brand adaptation (the style tokens move to DesignLanguage).
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';

/* ── PHASE 1 — DESIGN LANGUAGE (tokens) ──────────────────────────────────── */

export interface TypographyTokens {
  family: string;                 // resolved font stack
  scale: number[];                // modular type scale (px)
  headingWeight: number;
  bodyWeight: number;
  case: 'sentence' | 'upper' | 'title';
  letterSpacing: number;
  lineHeight: number;
}
export interface ColorTokens {
  primary: string;
  surface: string;
  onSurface: string;
  accent: string;
  muted: string;
  contrast: 'high' | 'soft';
  palette: string[];              // ordered cycle accents
}
export interface DesignLanguage {
  id: string;
  typography: TypographyTokens;
  colorTokens: ColorTokens;
  spacingScale: number[];
  cornerRadius: number;
  shadowLanguage: 'none' | 'soft' | 'elevated' | 'crisp';
  borderLanguage: 'none' | 'hairline' | 'accent-stripe' | 'full';
  photographyStyle: string;       // editorial | studio | lifestyle | product | documentary
  illustrationStyle: 'photo' | 'vector' | 'hand' | '3d' | 'graphic' | 'mockup';
  iconography: 'line' | 'solid' | 'duotone' | 'glyph';
  chartStyle: 'minimal' | 'bold' | 'editorial' | 'financial';
  motionRules: 'none' | 'subtle' | 'expressive';
  shapeLanguage: 'geometric' | 'organic' | 'rectilinear' | 'rounded';
  brandPersonality: string;       // e.g. "confident, technical, precise"
  visualDensity: 'minimal' | 'balanced' | 'dense';
  contrastRules: 'high' | 'soft';
  whitespaceRules: 'generous' | 'balanced' | 'compact';
}

/* ── PHASE 2 — PHOTOGRAPHY SYSTEM (image family) ─────────────────────────── */

export interface PhotographySystem {
  id: string;
  subjectStyle: string;
  sceneType: string;
  cameraAngle: string;
  lens: string;
  depthOfField: string;
  lighting: string;
  colorTemperature: string;
  backgroundType: string;
  foregroundObjects: string;
  composition: string;
  negativeSpace: string;
  safeTextZone: 'top' | 'bottom' | 'left' | 'right' | 'center';
  safeLogoZone: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  croppingRules: string;
  brandSpace: string;
  imageMood: string;
  editorialStyle: string;
  lifestyleStyle: string;
  studioStyle: string;
  productStyle: string;
  documentaryStyle: string;
  /** The deterministic positive prompt this system yields (built FROM the system,
   *  never directly from template text). */
  promptModifiers: string;
  negativePromptModifiers: string;
}

/* ── PHASE 3 — STORYTELLING SYSTEM (carousel family) ─────────────────────── */

export type StorytellingSystemType =
  | 'journey' | 'timeline' | 'roadmap' | 'reveal' | 'zoom' | 'comparison'
  | 'problem-solution' | 'transformation' | 'evolution' | 'book' | 'magazine'
  | 'film-strip' | 'before-after' | 'lifecycle' | 'decision-tree' | 'framework'
  | 'education' | 'case-study';

export interface StorytellingSystem {
  id: string;
  type: StorytellingSystemType;
  slidePurpose: string[];         // purpose per narrative beat (hook → … → cta)
  narrativeProgression: string;
  transition: string;
  visualContinuity: string;       // how slide N→N+1 stay coherent
  persistentElements: string[];   // elements that recur across slides
  progressIndicators: 'dots' | 'counter' | 'bar' | 'none';
  readingFlow: string;
  revealRules: string;
  informationDensity: 'minimal' | 'balanced' | 'dense';
  ctaStrategy: string;
}

/* ── PHASE 4/5 — COMPONENT LIBRARY + VARIANTS ───────────────────────────── */

/** The canonical component taxonomy. Each must exist EXACTLY ONCE in the library
 *  (no duplicate drawing). Items the renderer cannot draw yet are still declared so
 *  templates/AI can reference them; they render via the migration as Components land. */
export type ComponentType =
  | 'hero' | 'headline' | 'subtitle'
  | 'metric-card' | 'statistic-card' | 'quote' | 'comparison-card' | 'pricing-card'
  | 'feature-card' | 'callout' | 'checklist'
  | 'timeline' | 'roadmap' | 'journey' | 'process-flow' | 'framework'
  | 'architecture-diagram' | 'network-diagram' | 'mind-map' | 'decision-tree'
  | 'code-block' | 'terminal' | 'api-response' | 'database-block'
  | 'chart-panel' | 'pie-chart' | 'donut-chart' | 'bar-chart' | 'area-chart' | 'line-chart'
  | 'table' | 'risk-matrix' | 'comparison-matrix' | 'pricing-matrix'
  | 'calendar' | 'dashboard-widget'
  | 'device-mockup' | 'photo-frame' | 'avatar-stack' | 'photo-grid'
  | 'ribbon' | 'badge' | 'logo-block' | 'footer-cta';

/** Whether the renderer can draw this component today (CREATOR-128 inventory) —
 *  the migration promotes inline drawing into Components and adds the missing ones. */
export type ComponentRenderStatus = 'drawable' | 'partial' | 'pending';

export interface ComponentVariant {
  name: string;                   // minimal | executive | corporate | glass | luxury | …
  tokenOverrides?: Partial<DesignLanguage>;
  notes?: string;
}
export interface ComponentDefinition {
  type: ComponentType;
  status: ComponentRenderStatus;
  variants: ComponentVariant[];
  contentSlots: string[];         // declared typed slots (e.g. ['title','value','delta'])
  families: TemplateAssetFamily[]; // which asset families compose this component
}

/* ── COMPOSITION + the DESIGN SYSTEM container ──────────────────────────── */

export interface CompositionRules {
  arrangement: 'grid' | 'stack' | 'columns' | 'flow' | 'rail';
  columns: number;
  density: number;
  readingFlow: 'top-down' | 'z-pattern' | 'f-pattern' | 'radial';
}

export interface DesignSystem {
  id: string;
  name: string;
  ownership: 'system' | 'ai' | 'user';
  industry?: string;
  contentType?: string;
  designLanguage: DesignLanguage;
  photographySystem?: PhotographySystem;
  storytellingSystem?: StorytellingSystem;
  /** References into the canonical ComponentLibrary (by type) + chosen variant. */
  componentRefs: Array<{ type: ComponentType; variant: string }>;
  composition: CompositionRules;
  editableRegions: string[];
  lockedRegions: string[];
  adaptationRules: { immutable: string[]; adaptable: string[] };
  version: number;
}
