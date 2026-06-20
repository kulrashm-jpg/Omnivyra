# INFOGRAPHIC_CARD_TYPE_AUDIT.md

Phase 1 forensic audit — **no code changes**. Documents the infographic
generation/render flow as it exists today so the chart/table/background work
(Phases 2–8) can be layered in additively without disturbing existing layouts.

Primary file: [creatorAssetRenderer.ts](backend/services/creatorAssetRenderer.ts)
Composer: [infographicCopyComposer.ts](backend/services/creator/infographicCopyComposer.ts)

---

## A. Generation flow (content → SVG)

```
creator card / weekly structure
  └─ metadata.creator_card.infographic_layout            (planner picks layout)
  └─ metadata.topic / metadata.summary / overlay_text    (copy seed)
       │
       ▼
InfographicRenderer.render()                              (export, line ~5221)
       │
       ▼
renderInfographicAsset(assetPayload, options)             (line ~3955)
  1. resolveRenderSize(platform,'infographic') → 1200×1500
  2. resolveBrand(companyId) → BrandRuntime  →  CreatorBrandKit   (Phase 1C adapter)
  3. resolveInfographicSections(payload, metadata)   →  InfographicSection[]   (≤6)
  4. resolveInfographicLayout(metadata)              →  layout string
  5. autoCorrectVisualCopy() + stripPromptDirectives()  (clean section text)
  6. composeInfographicCopy({...})  →  per-section lead/bullets/stat/example/
                                        take/impact/risk + deck narrative + cta
  7. validateInfographicDensity / validateVisualGovernance / scoreCreatorQuality
  8. resolveInfographicEngine({layout,width,height,sectionCount,headerH})
        → { cardWidth, cardHeight, position(index) }    (GEOMETRY OWNER)
  9. sections.map(...) → per-card SVG fragment           (RENDERER DISPATCH)
 10. assemble full <svg> (bg gradient → header → panel → wave → cards → CTA)
 11. sharp(Buffer.from(svg)).composite([brandMark]).png()  → PNG buffer
 12. runCreatorOcr() + manifest + RenderedMediaBundle
```

### Section schema (current)

`type InfographicSection = { title: string; body: string; icon: string }`
(line ~3789). After composition the runtime object is widened in-place with
`bullets / stat / example / take / impact / risk` (see composer
`InfographicSectionCopy`). **There is no `type` discriminator today** — every
section is rendered by the active `layout`.

### Card "type" enum (current)

There is **no per-card type enum**. The visual treatment is selected by a
single deck-level `layout` value, not per card:

`resolveInfographicLayout()` (line ~3817) accepts:
`stats | comparison | process | framework | hierarchy | timeline`
(default `framework`). Anything else → `framework`.

### Layout selection logic

`metadata.infographic_layout` OR `metadata.creator_card.infographic_layout`
→ lowercased → whitelist check → fallback `framework`. Deterministic, no LLM.

### Renderer dispatch logic

Inside `sections.map((section, index) => {...})` (line ~4308) the **same
`layout`** is branched per card:
`if (layout === 'stats') … if (layout === 'comparison') … if (layout ===
'process') … if (layout === 'timeline') … if (layout === 'hierarchy') …`
else `framework` (default). Each branch returns an SVG string fragment placed
at `engine.position(index)` with `engine.cardWidth × engine.cardHeight`.

**Extension seam for Phases 2–3:** a per-section `type` discriminator checked
at the TOP of this map, short-circuiting to `renderChartCard` / `renderTableCard`
BEFORE the layout branches. Absent/disabled → falls through to today's code →
byte-identical.

---

## B. Existing card treatments

| Layout | Schema consumed | Renderer (line) | Geometry owner | Typography owner |
|---|---|---|---|---|
| `stats` | title, body, bullets, stat, example, take, impact, risk | inline `if (layout==='stats')` ~4312 (rich concept card + optional numeral) | `resolveInfographicEngine` stats branch (~3900): cols by count, `cardH≥260` | local `infographicFontMultiplier` × {title 20, lead 14, bullet 13…}; `fontFamily` from kit |
| `process` | title, body | ~4690 region (numbered step + connector) | engine process branch (~3873): 1 col, `cardH≥160`, gap 32 | `cardTitleFontSize`/`cardBodyFontSize` |
| `comparison` | title, body | comparison branch | engine comparison (~3884): 2 col, `cardH≥220` | same |
| `timeline` | title, body | ~4716 (rail dot + PHASE label) | engine timeline (~3862): 1 col rows; rail drawn once | same |
| `hierarchy` | title, body | ~4741 (numbered indented rows) | engine hierarchy (~3919): right-indent per row | same |
| `framework` (default) | title, body | ~4766 (pillar card + accent header band) | engine framework (~3935): 2 col pillar grid | same |

**Geometry ownership:** 100% in `resolveInfographicEngine`. Cards never compute
their own x/y/size — they receive `{x,y}` from `engine.position(index)` and use
`engine.cardWidth/cardHeight`. The new card types MUST do the same (occupy one
geometry slot) to avoid engine redesign.

**Typography ownership:** all sizes derive from `infographicFontMultiplier`
(driven by busiest-section char count, line ~4180) and `fontFamily` (brand font
with `'Inter, Arial'` fallback, line ~4140). Colors: `text='#111827'`,
`bodyTextColor='#334155'`, `accent=brandKit.accentColor`, `palette=brandKit.
normalizedPalette`.

---

## C. Background + layer ordering

Background is a **generated gradient** — there is no image path today.

`<defs>` (line ~4862) declares three linear gradients:
`infographicWaveGradient`, `infographicBgGradient` (bg→accent vertical),
`infographicHeaderGradient` (bg→accent diagonal).

**SVG paint order (back→front):**
1. `<rect width height fill="url(#infographicBgGradient)" />` — full-bleed bg
2. `<rect 0,0 width×headerH fill="url(#infographicHeaderGradient)" />` — header band
3. header title + subtitle `<text>`
4. `<rect 32,headerH-12 … fill="#f8fafc" opacity .95>` — inner safe panel
5. wave `<path>`
6. timeline rail (timeline layout only)
7. `${cards}` — all card fragments
8. CTA footer band (when a CTA resolved)

**sharp composite order (line ~4905):** base = rasterized SVG; `composite([
brandMark])` overlays the logo top-right (alpha preserved). Logo is the only
raster overlay.

**Extension seam for Phase 4:** insert an image as the sharp BASE layer and
move the rasterized SVG to a composite on top of it; the SVG's layer-1 rect
becomes a semi-transparent overlay scrim instead of the opaque gradient. Brand
mark stays the topmost composite. Default (gradient) keeps SVG as base →
byte-identical.

---

## D. Determinism & brand boundaries (constraints carried into 2–8)

- **Determinism:** geometry/typography/colors are all computed in-renderer from
  numeric inputs. The only non-deterministic input is the optional LLM copy
  (composer), which fails open to a static builder. Charts/tables/background
  geometry MUST be 100% renderer-owned (AI supplies data only).
- **Brand path:** `BrandRuntime → CreatorBrandKit → renderInfographicAsset`
  locals (`palette`, `accent`, `fontFamily`, `text`, `bodyTextColor`). New card
  types must read these same locals — no independent palette.
- **Tests already guarding:** `infographicNoForeignObject.test.ts` (no
  `<foreignObject>` — all text must be native `<text>`),
  `infographicBrandAdoption.test.ts` (accent == palette[1] for defaults; cache
  keying). New code must keep both green.

---

## E. Audit conclusion — chosen extension strategy

1. **Per-section `type` discriminator** (`'chart' | 'table' | undefined`) added
   to `InfographicSection`, sourced from a NEW optional, strictly-validated
   `metadata.infographic_cards[]` array. Absent → undefined → legacy path.
2. **Card map short-circuit** at the top of `sections.map`, flag-gated, with
   validation fallback to the legacy layout card when data is malformed.
3. **Background**: `renderBackgroundLayer()` returns `{ svgBackgroundFragment,
   imageBuffer }`; image becomes sharp base + mandatory scrim. Flag-gated.
4. Everything OFF by default → **byte-identical** output preserved.
</content>
</invoke>
