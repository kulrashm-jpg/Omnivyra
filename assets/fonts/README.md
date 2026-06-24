# Render fonts (creator asset rasterization)

These fonts are vendored so the **Vercel `render-inline` serverless runtime**
(which ships no system fonts) can rasterize infographic/brand_card SVG `<text>`
via sharp → librsvg → fontconfig. Without them, text renders blank in production
while localhost (with OS fonts) renders fine. See PHASE 13Z and
`backend/services/creatorRenderFonts.ts` (`ensureRenderFonts()`), which points
fontconfig at this directory and aliases `Arial`/`Helvetica`/`sans-serif` → Inter.

## Vendored
- `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`
  — Inter v4.1, SIL Open Font License 1.1. Source: rsms/inter release `extras/ttf/`.
  Inter is the primary brand font and the first family in every SVG `font-family`
  chain (`"Inter, Arial"`), so it covers all infographic text.

## NOT vendored (deviation from the PHASE 13Z spec)
- `LiberationSans-Regular.ttf` / `LiberationSans-Bold.ttf` were specified as the
  Arial-metric fallback but are **not** vendored: the liberation-fonts project
  ships no prebuilt TTFs in any GitHub release (build-from-source only), so an
  authoritative binary could not be obtained. Instead, `ensureRenderFonts()`
  aliases `Arial`/`Helvetica` → **Inter** at the fontconfig level, so every
  font-family chain resolves deterministically to the brand font. This is config,
  not a font substitution. To add true Arial metrics later, drop
  `LiberationSans-Regular.ttf` + `LiberationSans-Bold.ttf` into this directory —
  `ensureRenderFonts()` picks up any `*.ttf`/`*.otf` here automatically and the
  alias still prefers them where named.
