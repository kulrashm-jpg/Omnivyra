# renderInfographicAsset — Architecture & Change-Safety Contract

_Audited 2026-07-09. Covers `backend/services/creatorAssetRendererInfographic.ts`
(1,575 LOC, part 9/10 of the creatorAssetRenderer barrel split; production render
path for every infographic — render-inline, orchestrator, and worker)._

## Classification

One exported function, `renderInfographicAsset` (~1,480 lines): **Renderer /
Orchestrator**. Everything reusable was already extracted to sibling modules —
Compose (sections/layout/density/engine), Contracts (sharp + shared helpers),
Overlay (brand mark), Svg, Media (upload), Carousel (stripPromptDirectives),
creator/infographicDataCards, creator/infographicCopyComposer. What remains
inline is the SVG assembly itself: ~10 closures (`correctCopyField`,
`fitTitle`, `renderDenseBody`, `renderCardBase`, `renderConceptGlyph`, the
per-layout `cards` map, …) all closing over the resolved style/geometry/
palette/font locals. They are **not** extraction candidates: parameterizing
them means threading 10+ style locals through every signature, and rendering
order (background → header → panel → wave → rail → cards → CTA → brand mark)
is the product.

## Execution pipeline (order is behavior — do not reorder)

```
metadata/platform → canvas size (height is content-driven, mutable)
→ brand kit source select (BrandRuntime when PUBLISHED brand_identity, else
  legacy resolver — byte-identical for defaults-only tenants)
→ sample accent override (blueprint_color_primary)
→ semantic slot count (curated template > blueprint > generic)
→ section resolution (thread_visual_transform.items > overlay text; dedupe;
  MIN 4 sections padding) → prompt-directive strip → PER-FIELD auto-correct
  (title/body corrected independently — a flat array shifts pairings)
→ LLM copy composition (composeInfographicCopy; fails open; previews are
  staticOnly = NO LLM) → rich-content merge (body = lead; bullets/stat/… as
  extension fields)
→ density validation against the MEDIAN section (not cumulative deck text)
→ visual governance + quality scoring → header sizing (subtitle + wrapped
  headline headroom) → content-driven canvas sizing (prelim engine pass →
  body-height estimate → ~10% white-space target → min height 900 → final
  engine) → geometry validation → palette/font resolution (brand font with
  'Inter, Arial' fallback; quotes sanitized)
→ brand mark load → background-image mode (flag-gated + cached + fail-open
  to gradient) → wave path → per-layout card SVG (stats/process/comparison/
  timeline/framework/hierarchy treatments; concept glyph cycles 6 variants)
→ final SVG assembly → sharp composite (image mode: image base + SVG on top;
  gradient mode: SVG base; brand mark ALWAYS last for alpha)
→ final OCR → accessibility validation → render manifest (+ exportability
  assert when writer_asset_type/attachment_mode) → fire-and-forget
  persistCreatorValidationManifest → rendererMetadata assembly
→ previewBufferOnly ⇒ return raw buffer (gallery preview IS production
  output); else uploadRenderedPng ⇒ return URL
```

## Side effects & boundaries

- **Module load**: `ensureRenderFonts()` runs at import (fonts-before-sharp —
  enforced by the generateFontParity source-scan test; never move it below the
  sharp import).
- **DB/network**: brand runtime resolve, background image fetch (cached),
  validation-manifest persistence (unawaited `void`), PNG upload.
- **AI**: exactly one LLM call (`composeInfographicCopy`) and none in preview
  mode — do not add calls or change its position (copy must be composed before
  density/governance which score the composed text).
- **Fail-open contracts**: brand resolve, copy composition, background fetch —
  each degrades to the deterministic default, never throws.

## Never change silently

- The default-path output is a **byte-identity contract**: template resolver
  defaults equal the prior hardcoded constants; BrandRuntime only swaps the
  KIT SOURCE; background gradient mode must remain the exact pre-Phase-4 SVG.
- Composite order (scrim under cards, brand mark last), per-field copy
  correction, median-section density scoring, MIN_SECTIONS=4 padding,
  content-driven height clamps (INFOGRAPHIC_MIN_HEIGHT 900, ~10% padding),
  preview = static copy + no upload.

## Characterization

`backend/tests/unit/renderInfographicAssetCharacterization.test.ts` — 7 tests +
2 golden-master snapshots. `sharp` is mocked as a pass-through so the rendered
buffer IS the composed SVG: the snapshot locks header/panel/wave/cards/CTA
markup and the full metadata contract (engine, layout, density, quality,
governance, icon zones). Also locked: preview static-copy + no-upload, upload
path, CTA-footer omission, sample-accent re-tint, directive stripping,
sparse-overlay padding. Compose/governance/geometry/manifest/registries all REAL.

**Uncovered paths** (extend before touching): background-image mode (flag ON),
BrandRuntime kit source (published brand_identity), curated template /
blueprint semantic-slot planning, per-layout treatments other than the default
fixture's, OCR-failure flags, exportability assert failure, chart/table data
cards (flags ON).

## Governance verdict (2026-07-09)

Architecture 60/100 · Testability 68/100 (was ~10 — sibling parts had tests,
this function had none) · Maintainability 55/100. Coupling: efferent high
(~35 modules) but every boundary is fail-open and mockable. Cohesion: total —
one asset type, one canvas. Runtime risk of decomposition: VERY HIGH (visual
byte-parity contracts; prod render path). **Verdict B: optimal maintainable
form under the behavior-preservation constraint.** The style/geometry constants
are already externalized into the canonical template registry; the remaining
body is irreducible SVG assembly whose ordering is the rendered design. Any
future change must diff the SVG golden master, not eyeball PNGs.
