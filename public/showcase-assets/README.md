# Showcase Asset Library

Curated editorial photography for blog template **showcases** (the gallery
previews). Organized by category so non-engineers can drop in on-brand imagery.

```
public/showcase-assets/
  executives/
  technology/
  marketing/
  healthcare/
  finance/
  education/
  workspace/
  analytics/
```

## How showcases reference images

Showcase content lives in `content/showcases/*.json`. An image block can use
either a **curated asset path** or a **seeded fallback photo**:

```json
{ "t": "img", "src": "marketing/ai-campaign-hero.jpg", "alt": "…", "caption": "…" }
{ "t": "img", "seed": "ai-marketing-team",            "alt": "…", "caption": "…" }
```

- `src` → resolved to `/showcase-assets/<src>` (served from this folder).
- `seed` → a reliable seeded editorial photo (used until curated assets land).

The loader (`lib/blog/showcaseLoader.ts`) prefers `src` when present, otherwise
`seed`. To upgrade a showcase to curated photography, drop a real image into the
relevant category here and switch the JSON block from `seed` to `src` — no code
change required.

## Guidelines

- Editorial-quality, licensed for commercial use, ~1200×675 (16:9).
- No empty boxes, no placeholders, no logos/watermarks.
- Reuse the same curated asset across showcases where it fits — realism over novelty.
