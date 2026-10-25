/**
 * Canonical Visual Style registry (CREATOR-051).
 *
 * The THIRD axis of the creator model: Business Outcome + Layout + Visual STYLE.
 * A visual style is how a finished creative LOOKS (Corporate / 3D / Watercolour /
 * Real Photography…). It is selected INDEPENDENTLY of the template — it is NOT a
 * template and NOT an outcome, so it never duplicates either.
 *
 * Pure data + a non-destructive alias layer that collapses color-only template
 * variants into (base template + style), preserving every template id (runtime,
 * recommendation and analytics keep resolving the original ids unchanged).
 */

import type { TemplateAssetFamily } from '../creator-templates/types';

export type BrandBehavior = 'accent-led' | 'monochrome' | 'photo-led' | 'illustration-led' | 'high-contrast' | 'pastel' | 'duotone';

export interface VisualStyle {
  id: string;
  title: string;
  description: string;
  /** CSS swatch for the thumbnail (no asset required) — accent over surface. */
  thumbnail: { accent: string; surface: string };
  /** lucide icon name. */
  icon: string;
  tags: string[];
  industries: string[];
  recommendedContent: string[];
  supportedFamilies: TemplateAssetFamily[];
  /** Prompt fragment a future AI image step would prepend (no generation here). */
  stylePrompt: string;
  brandBehavior: BrandBehavior;
  /**
   * How the look is physically made: the medium the image generator should
   * render in ("halftone comic ink", "claymation"). Look-native prompting leads
   * with this so a chosen look is not quietly rendered as a photograph.
   */
  renderingMedium: string;
  /** The look's own colour palette, as hex. Leads the colour discipline when the look is chosen. */
  palette: string[];
  /** What would break this look, as a short comma list ("photorealism, film grain"). */
  negativePrompt: string;
  /**
   * True when the look IS photography (or reads as photographed). Photographic
   * looks keep the composer's realism directives; every other look replaces
   * them with a look-native block, because "editorial photography over rendered
   * illustration" is the opposite of what a comic or clay look asks for.
   */
  photographic: boolean;
  /**
   * Surface, line and texture qualities that make the look recognisable from
   * the description alone ("visible layered paper edges…"). Set for the looks
   * whose identity lives in their surface, so the look still reads correctly
   * when its sample image is not attached (kill switch, high-fidelity user
   * photo, sample unavailable) — owner 2026-10-25: looks inspire. Optional.
   */
  surface?: string;
}

type LookRendering = Pick<VisualStyle, 'renderingMedium' | 'palette' | 'negativePrompt' | 'photographic'>;

/** Prompt-only surface descriptors for the looks most likely to drift without their sample. */
const LOOK_SURFACE: Record<string, string> = {
  'paper-cut': 'visible cut-paper edges, several stacked paper layers with soft drop shadows between them, faint paper-fibre grain',
  clay: 'hand-sculpted matte clay with soft rounded forms, subtle fingerprint and tool marks, soft studio shading',
  watercolor: 'transparent pigment washes with soft blooms and pooled edges, visible cold-press paper grain, white paper left as highlights',
  sketch: 'graphite pencil lines with varied pressure, crosshatched shading, paper tooth visible',
  comic: 'heavy black ink outlines, flat colour fills with halftone dot shading, crisp panel-like framing',
  'hand-drawn': 'loose marker strokes with slight wobble, uneven fills, doodled accents',
  graffiti: 'sprayed paint with soft overspray, drips and tagged outlines on a textured wall',
  street: 'brushed and rollered mural paint on a weathered urban wall',
  isometric: 'strict isometric projection with parallel edges, clean flat faces with simple light/mid/dark shading per face',
  'flat-illustration': 'flat solid colour shapes, no gradients, minimal simple shadows, consistent stroke-free edges',
  anime: 'clean cel-shaded line art with hard-edged two-tone shadows and expressive highlights',
  '3d': 'smooth rendered surfaces with soft global illumination and gentle ambient occlusion',
  glassmorphism: 'frosted translucent panels with background blur, thin bright edges and soft coloured glow behind',
  neumorphism: 'soft extruded surfaces of one base colour, paired light and dark soft shadows, no hard edges',
  vintage: 'muted printed inks with slight misregistration, aged paper texture and gentle grain',
  retro: 'bold flat geometric shapes, chunky outlines and a sunset-style colour banding',
  neon: 'glowing tube lines with bloom on deep black, coloured reflections on dark surfaces',
  cyberpunk: 'neon-lit rain-slick surfaces, magenta and cyan glow, dense layered depth',
  'pixel-art': 'a visible square pixel grid with hard stair-stepped edges, a limited flat colour palette, no anti-aliasing or smooth gradients',
};

const NOT_PHOTO = 'photorealism, photographic skin texture, film grain, camera lens blur';

function L(renderingMedium: string, palette: string[], negativePrompt: string, photographic = false): LookRendering {
  return { renderingMedium, palette, negativePrompt, photographic };
}

/**
 * Per-look rendering vocabulary (PR5: the selected look drives the image).
 * Derived from each look's own name, description and tags; one short phrase
 * per field, so the prompt states the look rather than an essay about it.
 */
const LOOK_RENDERING: Record<string, LookRendering> = {
  // Brand / format
  corporate: L('clean corporate photography and design', ['#1e3a8a', '#ffffff', '#0b1220', '#94a3b8'], 'clutter, playful cartoon elements, neon colours', true),
  modern: L('contemporary clean design photography', ['#2563eb', '#ffffff', '#0b1220', '#e2e8f0'], 'busy clutter, dated textures, heavy ornament', true),
  minimal: L('minimalist photography with vast negative space', ['#0f172a', '#64748b', '#f8fafc'], 'clutter, multiple accent colours, busy backgrounds', true),
  luxury: L('premium luxury photography, gold on black', ['#0a0a0a', '#a16207', '#facc15', '#f5f5f4'], 'cheap glossy plastic, bright primary colours, clutter', true),
  editorial: L('magazine editorial photography', ['#111827', '#94a3b8', '#f8fafc'], 'loud saturated colours, cartoon elements, clutter', true),
  magazine: L('bold magazine-cover photography', ['#dc2626', '#0b1220', '#ffffff'], 'flat clip-art, muddy colours, clutter', true),
  dark: L('dark-mode digital design with glowing accents', ['#020617', '#22d3ee', '#0ea5e9', '#e2e8f0'], `bright daylight scenes, washed-out pastels, ${NOT_PHOTO}`),
  bold: L('bold graphic design with flat saturated colour fields', ['#ef4444', '#facc15', '#1a1a1a', '#ffffff'], `muted desaturated tones, timid composition, ${NOT_PHOTO}`),
  gradient: L('smooth vibrant multi-stop gradient digital art', ['#7c3aed', '#ec4899', '#06b6d4', '#0b1220'], `flat single colour, hard noisy textures, ${NOT_PHOTO}`),
  abstract: L('abstract organic-shape digital art', ['#f59e0b', '#0f172a', '#f472b6', '#38bdf8'], `literal photographic scenes, ${NOT_PHOTO}`),
  brutalist: L('brutalist graphic design, raw grid blocks', ['#000000', '#facc15', '#ffffff'], `soft gradients, rounded friendly shapes, ${NOT_PHOTO}`),
  vintage: L('vintage printed illustration with aged paper texture', ['#b45309', '#1c1917', '#fef3c7', '#78716c'], 'glossy modern digital sheen, neon colours, photorealism'),
  retro: L('retro 80s/90s pop graphic art', ['#db2777', '#1e1b4b', '#facc15', '#22d3ee'], `muted corporate tones, ${NOT_PHOTO}`),
  glassmorphism: L('glassmorphism digital render, frosted translucent panels', ['#38bdf8', '#0b1220', '#a78bfa', '#f8fafc'], `opaque flat panels, ${NOT_PHOTO}`),
  neumorphism: L('neumorphic soft-UI render, extruded surfaces', ['#e2e8f0', '#94a3b8', '#ffffff'], `hard shadows, saturated colours, ${NOT_PHOTO}`),
  // Photography
  lifestyle: L('candid lifestyle photography, natural light', ['#0ea5e9', '#f8fafc', '#78716c'], 'illustration, cartoon, 3D render', true),
  'real-photography': L('authentic high-resolution photography', ['#10b981', '#0b1220', '#f8fafc'], 'illustration, cartoon, 3D render', true),
  'portrait-photography': L('professional portrait photography, shallow depth of field', ['#f43f5e', '#0b1220', '#f5f5f4'], 'illustration, cartoon, 3D render', true),
  'product-photography': L('studio product photography', ['#06b6d4', '#0b1220', '#ffffff'], 'illustration, cartoon, cluttered background', true),
  studio: L('controlled studio photography', ['#a3a3a3', '#0a0a0a', '#ffffff'], 'illustration, cartoon, uncontrolled outdoor light', true),
  // Industry
  technology: L('sleek technology photography with device hints', ['#6366f1', '#0b1220', '#22d3ee'], 'cartoon, rustic textures, clutter', true),
  healthcare: L('calm clean clinical photography', ['#0ea5e9', '#f0f9ff', '#ffffff', '#10b981'], 'gore, harsh red tones, cartoon', true),
  finance: L('confident data-forward finance photography', ['#1e3a8a', '#0b1220', '#10b981'], 'cartoon, playful clutter, neon colours', true),
  education: L('friendly approachable education photography', ['#f59e0b', '#1f2937', '#38bdf8'], 'dark gloomy mood, clutter', true),
  construction: L('rugged industrial construction photography', ['#f97316', '#1c1917', '#facc15', '#78716c'], 'cartoon, pastel tones, pristine sterile sets', true),
  restaurant: L('warm appetising food photography', ['#dc2626', '#1a1a1a', '#f59e0b'], 'cold blue tones, cartoon, unappetising food', true),
  travel: L('scenic travel photography', ['#0d9488', '#0b1220', '#f59e0b', '#38bdf8'], 'cartoon, grey overcast gloom, indoor offices', true),
  retail: L('punchy promotional product photography', ['#e11d48', '#0b1220', '#ffffff'], 'cartoon, muted dull tones, clutter', true),
  fashion: L('high-fashion editorial photography, dramatic lighting', ['#a21caf', '#0a0a0a', '#f5f5f4'], 'cartoon, flat even lighting, clutter', true),
  'luxury-brand': L('understated luxury brand photography', ['#a16207', '#0a0a0a', '#f5f5f4'], 'cheap glossy plastic, loud colours, clutter', true),
  // Illustration / 3D
  graffiti: L('spray-paint graffiti street art on urban walls', ['#22c55e', '#111827', '#facc15', '#ec4899'], `clean corporate vector, ${NOT_PHOTO}`),
  street: L('urban street-art mural painting', ['#f59e0b', '#171717', '#ef4444', '#38bdf8'], `clean corporate vector, ${NOT_PHOTO}`),
  comic: L('comic-book ink illustration with halftone dots and bold outlines', ['#ef4444', '#fef9c3', '#1d4ed8', '#000000'], `soft gradients, ${NOT_PHOTO}`),
  anime: L('cel-shaded anime illustration', ['#ec4899', '#0b1220', '#38bdf8', '#fef3c7'], `western cartoon proportions, ${NOT_PHOTO}`),
  clay: L('claymation 3D, hand-sculpted matte clay', ['#fb7185', '#1f2937', '#fde68a', '#93c5fd'], `glossy chrome, hard-edged vector, ${NOT_PHOTO}`),
  '3d': L('polished 3D render, soft global illumination', ['#8b5cf6', '#0b1220', '#22d3ee', '#f8fafc'], `flat 2D vector, ${NOT_PHOTO}`),
  watercolor: L('watercolour painting, soft washes on paper', ['#38bdf8', '#f8fafc', '#f9a8d4', '#86efac'], `hard digital edges, neon colours, ${NOT_PHOTO}`),
  sketch: L('hand-drawn pencil sketch with crosshatching', ['#475569', '#f1f5f9', '#0f172a'], `full colour fills, glossy render, ${NOT_PHOTO}`),
  illustration: L('custom vector illustration', ['#6366f1', '#0b1220', '#f59e0b', '#f8fafc'], NOT_PHOTO),
  'flat-illustration': L('flat vector illustration, simple geometric shapes', ['#14b8a6', '#0b1220', '#f59e0b', '#f8fafc'], `gradients, heavy shading, 3D depth, ${NOT_PHOTO}`),
  isometric: L('isometric 2.5D vector illustration', ['#3b82f6', '#0b1220', '#22d3ee', '#f8fafc'], `perspective distortion, ${NOT_PHOTO}`),
  'hand-drawn': L('hand-drawn marker doodles', ['#0f766e', '#fffbeb', '#f97316'], `precise vector geometry, glossy render, ${NOT_PHOTO}`),
  'paper-cut': L('layered paper-cut craft with soft shadows', ['#f59e0b', '#1f2937', '#fb7185', '#fef3c7'], `glossy plastic, ${NOT_PHOTO}`),
  'pixel-art': L('retro 8-bit pixel art on a crisp square pixel grid', ['#22c55e', '#0b1220', '#facc15', '#38bdf8', '#f472b6'], `smooth gradients, anti-aliased soft edges, high-resolution detail, ${NOT_PHOTO}`),
  // Futuristic
  cyberpunk: L('cyberpunk neon-noir digital art', ['#d946ef', '#020617', '#22d3ee', '#facc15'], 'daylight pastoral scenes, muted beige tones, photorealism'),
  futuristic: L('sleek sci-fi digital render with clean glow', ['#818cf8', '#020617', '#22d3ee', '#e2e8f0'], `rustic vintage textures, ${NOT_PHOTO}`),
  neon: L('glowing neon-tube light art on black', ['#a855f7', '#020617', '#22d3ee', '#f472b6'], 'daylight, washed-out pastels, flat even lighting'),
  // UI / data
  'ui-mockup': L('clean product UI mockup render in a device frame', ['#2563eb', '#0b1220', '#f8fafc'], 'readable UI text, cluttered screens, photorealistic hands'),
  dashboard: L('dark SaaS dashboard UI render with abstract charts', ['#0ea5e9', '#0b1220', '#22d3ee', '#a78bfa'], 'readable labels or numbers, photorealism'),
  infographic: L('clean flat infographic design with icons and charts', ['#2563eb', '#0b1220', '#f59e0b', '#f8fafc'], `photographic scenes, ${NOT_PHOTO}`),
};

/** Fallback for a style added without a rendering row: non-committal and photographic (today's behaviour). */
const DEFAULT_LOOK_RENDERING: LookRendering = L('', [], '', true);

const ALL: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const IMG_CAR: TemplateAssetFamily[] = ['image', 'carousel'];
const G = ['general'];

function S(id: string, title: string, description: string, accent: string, surface: string, p: Partial<VisualStyle> = {}): VisualStyle {
  return {
    id, title, description,
    thumbnail: { accent, surface },
    icon: p.icon ?? 'Palette',
    tags: p.tags ?? [],
    industries: p.industries ?? G,
    recommendedContent: p.recommendedContent ?? [],
    supportedFamilies: p.supportedFamilies ?? ALL,
    stylePrompt: p.stylePrompt ?? '',
    brandBehavior: p.brandBehavior ?? 'accent-led',
    ...(LOOK_RENDERING[id] ?? DEFAULT_LOOK_RENDERING),
    ...(LOOK_SURFACE[id] ? { surface: LOOK_SURFACE[id] } : {}),
  };
}

export const VISUAL_STYLES: VisualStyle[] = [
  // ── Brand / format ──────────────────────────────────────────────────────
  S('corporate', 'Corporate', 'Clean, trustworthy, navy-and-white business look.', '#1e3a8a', '#0b1220', { icon: 'Building2', tags: ['professional', 'b2b', 'trust'], industries: ['finance', 'technology', 'general'], brandBehavior: 'accent-led', stylePrompt: 'clean corporate design, navy and white, professional, trustworthy' }),
  S('modern', 'Modern', 'Contemporary, confident, plenty of whitespace.', '#2563eb', '#0b1220', { icon: 'Sparkles', tags: ['contemporary', 'clean'], brandBehavior: 'accent-led', stylePrompt: 'modern clean design, generous whitespace, contemporary typography' }),
  S('minimal', 'Minimal', 'Restrained, monochrome, one accent.', '#64748b', '#0f172a', { icon: 'Minus', tags: ['minimal', 'restrained', 'whitespace'], brandBehavior: 'monochrome', stylePrompt: 'minimalist, monochrome, single accent, lots of negative space' }),
  S('luxury', 'Luxury', 'Premium gold-on-dark, elegant serif.', '#a16207', '#0a0a0a', { icon: 'Crown', tags: ['premium', 'elegant', 'gold'], industries: ['fashion', 'retail', 'general'], brandBehavior: 'high-contrast', stylePrompt: 'luxury premium design, gold on black, elegant serif, refined' }),
  S('editorial', 'Editorial', 'Magazine-grade type hierarchy, calm palette.', '#94a3b8', '#111827', { icon: 'Newspaper', tags: ['editorial', 'typographic'], recommendedContent: ['thought-leadership', 'announcement'], brandBehavior: 'monochrome', stylePrompt: 'editorial magazine layout, strong type hierarchy, calm palette' }),
  S('magazine', 'Magazine', 'Bold cover-style composition.', '#dc2626', '#0b1220', { icon: 'BookOpen', tags: ['magazine', 'cover', 'bold'], brandBehavior: 'high-contrast', stylePrompt: 'magazine cover composition, bold masthead, editorial grid' }),
  S('dark', 'Dark', 'Dark-mode, high contrast, glow accents.', '#22d3ee', '#020617', { icon: 'Moon', tags: ['dark', 'contrast'], supportedFamilies: ALL, brandBehavior: 'high-contrast', stylePrompt: 'dark mode, deep background, glowing accent, high contrast' }),
  S('bold', 'Bold', 'Loud, saturated, attention-grabbing.', '#ef4444', '#1a1a1a', { icon: 'Zap', tags: ['bold', 'loud', 'promotional'], recommendedContent: ['promotion', 'offer'], brandBehavior: 'high-contrast', stylePrompt: 'bold loud design, saturated colors, oversized type' }),
  S('gradient', 'Gradient', 'Vibrant multi-stop gradients.', '#7c3aed', '#0b1220', { icon: 'Blend', tags: ['gradient', 'vibrant'], brandBehavior: 'accent-led', stylePrompt: 'vibrant multi-stop gradient background, smooth blends' }),
  S('abstract', 'Abstract', 'Organic shapes, expressive forms.', '#f59e0b', '#0f172a', { icon: 'Shapes', tags: ['abstract', 'shapes'], brandBehavior: 'pastel', stylePrompt: 'abstract organic shapes, expressive composition' }),
  S('brutalist', 'Brutalist', 'Raw, high-contrast, oversized type.', '#000000', '#facc15', { icon: 'Square', tags: ['brutalist', 'raw'], brandBehavior: 'high-contrast', stylePrompt: 'brutalist design, raw grids, oversized type, stark contrast' }),
  S('vintage', 'Vintage', 'Aged, muted, classic textures.', '#b45309', '#1c1917', { icon: 'Clock', tags: ['vintage', 'retro', 'texture'], brandBehavior: 'duotone', stylePrompt: 'vintage aesthetic, muted aged palette, classic textures' }),
  S('retro', 'Retro', '80s/90s pop, bold geometric.', '#db2777', '#1e1b4b', { icon: 'Disc', tags: ['retro', '80s', 'pop'], brandBehavior: 'high-contrast', stylePrompt: 'retro 80s 90s pop, bold geometric shapes, neon pastels' }),
  S('glassmorphism', 'Glassmorphism', 'Frosted translucent panels.', '#38bdf8', '#0b1220', { icon: 'Layers', tags: ['glass', 'translucent', 'ui'], supportedFamilies: ['image', 'infographic'], brandBehavior: 'accent-led', stylePrompt: 'glassmorphism, frosted translucent panels, soft blur' }),
  S('neumorphism', 'Neumorphism', 'Soft extruded UI surfaces.', '#94a3b8', '#e2e8f0', { icon: 'Box', tags: ['neumorphism', 'soft-ui'], supportedFamilies: ['image', 'infographic'], brandBehavior: 'monochrome', stylePrompt: 'neumorphic soft UI, subtle shadows, extruded surfaces' }),

  // ── Photography ─────────────────────────────────────────────────────────
  S('lifestyle', 'Lifestyle', 'Candid real-world people and moments.', '#0ea5e9', '#0b1220', { icon: 'Camera', tags: ['lifestyle', 'people', 'candid'], supportedFamilies: IMG_CAR, brandBehavior: 'photo-led', stylePrompt: 'lifestyle photography, candid real people, natural light' }),
  S('real-photography', 'Real Photography', 'Authentic photographic backgrounds.', '#10b981', '#0b1220', { icon: 'Image', tags: ['photography', 'authentic'], supportedFamilies: IMG_CAR, brandBehavior: 'photo-led', stylePrompt: 'authentic photography, realistic, high resolution' }),
  S('portrait-photography', 'Portrait Photography', 'Human-centred portraits.', '#f43f5e', '#0b1220', { icon: 'User', tags: ['portrait', 'people'], recommendedContent: ['testimonial', 'hiring'], supportedFamilies: IMG_CAR, brandBehavior: 'photo-led', stylePrompt: 'professional portrait photography, shallow depth of field' }),
  S('product-photography', 'Product Photography', 'Crisp studio product shots.', '#06b6d4', '#0b1220', { icon: 'Package', tags: ['product', 'studio'], recommendedContent: ['product-launch', 'offer'], supportedFamilies: IMG_CAR, brandBehavior: 'photo-led', stylePrompt: 'studio product photography, clean background, crisp lighting' }),
  S('studio', 'Studio', 'Controlled-light studio aesthetic.', '#a3a3a3', '#0a0a0a', { icon: 'Aperture', tags: ['studio', 'lighting'], supportedFamilies: IMG_CAR, brandBehavior: 'photo-led', stylePrompt: 'studio lighting, controlled backdrop, professional set' }),

  // ── Industry ────────────────────────────────────────────────────────────
  S('technology', 'Technology', 'Sleek tech / SaaS aesthetic.', '#6366f1', '#0b1220', { icon: 'Cpu', tags: ['tech', 'saas'], industries: ['technology'], brandBehavior: 'accent-led', stylePrompt: 'sleek technology SaaS aesthetic, gradients, device hints' }),
  S('healthcare', 'Healthcare', 'Calm, clean, trustworthy clinical.', '#0ea5e9', '#f0f9ff', { icon: 'HeartPulse', tags: ['healthcare', 'clinical'], industries: ['healthcare'], brandBehavior: 'monochrome', stylePrompt: 'healthcare design, calm clean clinical, trustworthy blues' }),
  S('finance', 'Finance', 'Confident, data-forward, secure.', '#1e3a8a', '#0b1220', { icon: 'Landmark', tags: ['finance', 'data'], industries: ['finance'], brandBehavior: 'accent-led', stylePrompt: 'finance design, confident data-forward, secure navy/green' }),
  S('education', 'Education', 'Friendly, approachable, clear.', '#f59e0b', '#1f2937', { icon: 'GraduationCap', tags: ['education', 'friendly'], industries: ['education'], brandBehavior: 'pastel', stylePrompt: 'education design, friendly approachable, clear hierarchy' }),
  S('construction', 'Construction', 'Rugged, high-vis, industrial.', '#f97316', '#1c1917', { icon: 'HardHat', tags: ['construction', 'industrial'], industries: ['construction'], brandBehavior: 'high-contrast', stylePrompt: 'construction industrial, rugged, high-vis orange, steel' }),
  S('restaurant', 'Restaurant', 'Appetising, warm, food-forward.', '#dc2626', '#1a1a1a', { icon: 'UtensilsCrossed', tags: ['restaurant', 'food'], industries: ['restaurant'], brandBehavior: 'photo-led', stylePrompt: 'restaurant food photography, warm appetising, rich tones' }),
  S('travel', 'Travel', 'Wanderlust, scenic, vibrant.', '#0d9488', '#0b1220', { icon: 'Plane', tags: ['travel', 'scenic'], industries: ['travel'], brandBehavior: 'photo-led', stylePrompt: 'travel photography, scenic landscapes, vibrant wanderlust' }),
  S('retail', 'Retail', 'Punchy, promotional, product-led.', '#e11d48', '#0b1220', { icon: 'ShoppingBag', tags: ['retail', 'ecommerce'], industries: ['retail'], brandBehavior: 'high-contrast', stylePrompt: 'retail ecommerce, punchy promotional, product hero' }),
  S('fashion', 'Fashion', 'Editorial, sleek, high-fashion.', '#a21caf', '#0a0a0a', { icon: 'Shirt', tags: ['fashion', 'editorial'], industries: ['fashion'], brandBehavior: 'high-contrast', stylePrompt: 'high-fashion editorial, sleek, dramatic lighting' }),
  S('luxury-brand', 'Luxury Brand', 'Understated, exclusive, refined.', '#a16207', '#0a0a0a', { icon: 'Gem', tags: ['luxury', 'exclusive'], industries: ['fashion', 'retail'], brandBehavior: 'monochrome', stylePrompt: 'luxury brand, understated exclusive, refined gold accents' }),

  // ── Illustration / 3D ───────────────────────────────────────────────────
  S('graffiti', 'Graffiti', 'Spray-paint street energy.', '#22c55e', '#111827', { icon: 'SprayCan', tags: ['graffiti', 'street'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'graffiti street art, spray paint, urban energy' }),
  S('street', 'Street Art', 'Urban, raw, expressive.', '#f59e0b', '#171717', { icon: 'Building', tags: ['street', 'urban'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'urban street art, raw expressive, bold murals' }),
  S('comic', 'Comic', 'Halftone, panels, pop energy.', '#ef4444', '#fef9c3', { icon: 'MessageSquare', tags: ['comic', 'pop'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'comic book style, halftone dots, bold outlines, panels' }),
  S('anime', 'Anime', 'Clean cel-shaded anime.', '#ec4899', '#0b1220', { icon: 'Star', tags: ['anime', 'character'], supportedFamilies: IMG_CAR, brandBehavior: 'illustration-led', stylePrompt: 'anime style, cel-shaded, expressive characters' }),
  S('clay', 'Clay', 'Soft 3D claymation look.', '#fb7185', '#1f2937', { icon: 'Cookie', tags: ['clay', '3d', 'soft'], supportedFamilies: IMG_CAR, brandBehavior: 'illustration-led', stylePrompt: 'claymation 3D, soft rounded shapes, matte textures' }),
  S('3d', '3D', 'Rendered 3D depth and lighting.', '#8b5cf6', '#0b1220', { icon: 'Boxes', tags: ['3d', 'render'], supportedFamilies: IMG_CAR, brandBehavior: 'illustration-led', stylePrompt: '3D rendered, depth, soft global illumination' }),
  S('watercolor', 'Watercolor', 'Soft painterly washes.', '#38bdf8', '#f8fafc', { icon: 'Droplet', tags: ['watercolor', 'painterly'], supportedFamilies: IMG_CAR, brandBehavior: 'pastel', stylePrompt: 'watercolor painting, soft washes, organic edges' }),
  S('sketch', 'Sketch', 'Hand-sketched line art.', '#475569', '#f1f5f9', { icon: 'PenTool', tags: ['sketch', 'line'], supportedFamilies: IMG_CAR, brandBehavior: 'monochrome', stylePrompt: 'hand sketch, pencil line art, crosshatching' }),
  S('illustration', 'Illustration', 'Custom vector illustration.', '#6366f1', '#0b1220', { icon: 'Brush', tags: ['illustration', 'vector'], supportedFamilies: ALL, brandBehavior: 'illustration-led', stylePrompt: 'custom vector illustration, characters and scenes' }),
  S('flat-illustration', 'Flat Illustration', 'Flat, geometric, friendly.', '#14b8a6', '#0b1220', { icon: 'PaintBucket', tags: ['flat', 'geometric'], supportedFamilies: ALL, brandBehavior: 'illustration-led', stylePrompt: 'flat illustration, simple geometric shapes, friendly' }),
  S('isometric', 'Isometric', '2.5D isometric scenes.', '#3b82f6', '#0b1220', { icon: 'Grid3x3', tags: ['isometric', '2.5d'], supportedFamilies: ALL, brandBehavior: 'illustration-led', stylePrompt: 'isometric illustration, 2.5D scenes, clean angles' }),
  S('hand-drawn', 'Hand Drawn', 'Organic doodle / marker feel.', '#0f766e', '#fffbeb', { icon: 'Pencil', tags: ['hand-drawn', 'doodle'], supportedFamilies: IMG_CAR, brandBehavior: 'monochrome', stylePrompt: 'hand drawn doodles, marker, playful organic lines' }),
  S('paper-cut', 'Paper Cut', 'Layered paper-cut depth.', '#f59e0b', '#1f2937', { icon: 'Scissors', tags: ['paper-cut', 'layered'], supportedFamilies: ['image', 'infographic'], brandBehavior: 'pastel', stylePrompt: 'layered paper cut craft, soft shadows, depth' }),
  S('pixel-art', 'Pixel Art', 'Retro pixel-art aesthetic.', '#22c55e', '#0b1220', { icon: 'Grid2x2', tags: ['pixel-art', 'retro', '8-bit'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'pixel art, 8-bit, crisp pixels, retro game palette' }),

  // ── Futuristic ──────────────────────────────────────────────────────────
  S('cyberpunk', 'Cyberpunk', 'Neon-noir high tech.', '#d946ef', '#020617', { icon: 'Bolt', tags: ['cyberpunk', 'neon'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'cyberpunk neon-noir, glitch, magenta and cyan glow' }),
  S('futuristic', 'Futuristic', 'Sleek sci-fi, clean glow.', '#818cf8', '#020617', { icon: 'Rocket', tags: ['futuristic', 'sci-fi'], supportedFamilies: ALL, brandBehavior: 'high-contrast', stylePrompt: 'futuristic sci-fi, sleek surfaces, clean glow, HUD hints' }),
  S('neon', 'Neon', 'Glowing neon on black.', '#a855f7', '#020617', { icon: 'Lightbulb', tags: ['neon', 'glow'], supportedFamilies: IMG_CAR, brandBehavior: 'high-contrast', stylePrompt: 'neon sign glow on black, vibrant tubes, reflections' }),

  // ── UI / data ───────────────────────────────────────────────────────────
  S('ui-mockup', 'UI Mockup', 'App / screen mockup framing.', '#2563eb', '#0b1220', { icon: 'MonitorSmartphone', tags: ['ui', 'mockup', 'app'], recommendedContent: ['product-launch', 'feature'], supportedFamilies: IMG_CAR, brandBehavior: 'accent-led', stylePrompt: 'app UI mockup in device frame, clean product screens' }),
  S('dashboard', 'Dashboard', 'Data-rich SaaS dashboard look.', '#0ea5e9', '#0b1220', { icon: 'LayoutDashboard', tags: ['dashboard', 'saas', 'data'], industries: ['technology'], supportedFamilies: ['image', 'infographic'], brandBehavior: 'accent-led', stylePrompt: 'SaaS dashboard UI, charts and metrics, dark data theme' }),
  S('infographic', 'Infographic', 'Icons, charts, clear data hierarchy.', '#2563eb', '#0b1220', { icon: 'BarChart3', tags: ['infographic', 'data', 'charts'], recommendedContent: ['statistics', 'process'], supportedFamilies: ['infographic'], brandBehavior: 'accent-led', stylePrompt: 'clean infographic, icons, charts, clear data hierarchy' }),
];

export const VISUAL_STYLE_BY_ID: Record<string, VisualStyle> = Object.fromEntries(VISUAL_STYLES.map((s) => [s.id, s]));
export function getVisualStyle(id: string | null | undefined): VisualStyle | null { return id ? VISUAL_STYLE_BY_ID[id] ?? null : null; }
export function listVisualStyles(family?: TemplateAssetFamily): VisualStyle[] {
  return family ? VISUAL_STYLES.filter((s) => s.supportedFamilies.includes(family)) : VISUAL_STYLES;
}

/* ── Template normalization: color-only variants → base template + style ─── */

export interface TemplateStyleResolution { baseTemplateId: string; styleId: string; isAlias: boolean; }

/**
 * Color-only variants collapsed onto a single base template + a visual style.
 * Every alias id STILL resolves through getTemplateById (preserved for runtime,
 * recommendation and analytics) — only the canonical BROWSE list dedupes them.
 */
export const STYLE_VARIANT_ALIASES: Record<string, TemplateStyleResolution> = {
  'sys-image-premium-luxury': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'luxury', isAlias: true },
  'sys-image-bold-marketing': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'bold', isAlias: true },
  'sys-image-corporate': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'corporate', isAlias: true },
  'sys-image-modern-tech': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'technology', isAlias: true },
  'sys-image-creative': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'illustration', isAlias: true },
  'sys-image-clean-editorial': { baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'editorial', isAlias: true },
};

/** The base template ids that absorbed style variants (kept in the canonical list). */
const ALIAS_BASES = new Set(Object.values(STYLE_VARIANT_ALIASES).map((a) => a.baseTemplateId));

/** Default style for the base/canonical templates (when not an alias). */
const BASE_DEFAULT_STYLE: Record<string, string> = { 'sys-image-minimal-brand-card': 'minimal' };

/** Resolve a template id to its (base template + visual style). Aliases preserved. */
export function resolveTemplateStyle(templateId: string): TemplateStyleResolution {
  const alias = STYLE_VARIANT_ALIASES[templateId];
  if (alias) return alias;
  return { baseTemplateId: templateId, styleId: BASE_DEFAULT_STYLE[templateId] ?? 'modern', isAlias: false };
}

/** True if the id is a color-only variant deduped from the canonical browse list. */
export function isStyleVariantAlias(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STYLE_VARIANT_ALIASES, templateId);
}

/** Canonical (deduped) template ids for browsing — aliases removed, bases kept. */
export function canonicalTemplateIds(allTemplateIds: readonly string[]): string[] {
  return allTemplateIds.filter((id) => !isStyleVariantAlias(id));
}

/** Styles offered for a base template that absorbed variants (for the style selector). */
export function stylesForBaseTemplate(baseTemplateId: string): string[] {
  if (!ALIAS_BASES.has(baseTemplateId)) return [resolveTemplateStyle(baseTemplateId).styleId];
  const styles = [BASE_DEFAULT_STYLE[baseTemplateId] ?? 'minimal'];
  for (const a of Object.values(STYLE_VARIANT_ALIASES)) if (a.baseTemplateId === baseTemplateId) styles.push(a.styleId);
  return Array.from(new Set(styles));
}
