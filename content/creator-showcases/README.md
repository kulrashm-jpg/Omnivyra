# Creator Template Showcases (curated)

Finished marketing creatives shown in the Creator Template Browser **as ordinary
images** — no generation, no rendering, no AI, no preview composition.

## How to add showcases

1. Drop curated image files under `public/creator-showcases/<templateId>/`
   (thumbnail + preview, and optional carousel slides / infographic preview).
2. Add an entry per creative to `showcases.json` → `showcases[]`:

```json
{
  "id": "launch-product-saas-1",
  "templateId": "sys-image-product-highlight",
  "title": "Ship faster without breaking trust",
  "description": "SaaS product launch hero",
  "industry": "technology",
  "audience": "prospects",
  "businessOutcome": "launch-product",
  "visualStyle": "technology",
  "family": "image",
  "thumbnailUrl": "/creator-showcases/sys-image-product-highlight/saas-1-thumb.jpg",
  "previewUrl": "/creator-showcases/sys-image-product-highlight/saas-1.jpg",
  "tags": ["saas", "launch"],
  "featured": true,
  "order": 1
}
```

Target **8–15 finished examples per template**, across industries / audiences /
visual styles. The browser reads this repository only; visual-style cards simply
**filter** these curated entries — they never generate anything.
