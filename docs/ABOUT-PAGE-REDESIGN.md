# About Page Redesign — Thought Leadership Positioning

## Summary

The About page has been redesigned from a feature-driven SaaS-style layout to a thought-leadership positioning page. Tone is learned, confident, and editorial—not promotional.

---

## Section Hierarchy

1. **Hero (Repositioning Layer)**  
   - Headline: *Engineering Clarity Into Modern Marketing.*  
   - Subheading: Omnivyra’s purpose (reduce complexity, restore structure, intelligent discipline).  
   - One 4–5 sentence paragraph: rising complexity, lack of time to audit, operating without readiness clarity, Omnivyra as the source of that clarity before spend.

2. **The Real Problem**  
   - Title: *Marketing Is Moving Faster Than Its Architecture.*  
   - CMOs’ execution pressure, founders’ lack of clarity, teams executing without readiness, budgets before structural evaluation, automation amplifying chaos when structure is missing. Philosophical but grounded.

3. **Who We Serve**  
   - Title: *For Those Responsible for Growth — With or Without Marketing Expertise.*  
   - CMOs, marketing leaders scaling automation, founders short on time, business owners without deep marketing mechanics, teams needing clarity before budget. Emphasis on reducing uncertainty for experts and non-experts.

4. **Image break**  
   - Optional visual between “Who We Serve” and “What This Means for You.”

5. **The Benefit We Deliver**  
   - Title: *What This Means for You.*  
   - Six outcomes, each with 2–3 sentences: reduced decision ambiguity, clearer campaign readiness, stronger conversion paths, confidence before spend, structured visibility into marketing systems, less reactive firefighting.

6. **Our Philosophy**  
   - Title: *Marketing Should Be Engineered, Not Improvised.*  
   - Marketing as system; AI within structure; discipline enables creativity; architecture enables scale; structure reduces risk. Reflective, intellectual tone.

---

## Image Placement Points

| Location | Purpose | Style description |
|----------|--------|--------------------|
| **After Hero** | First visual break | Minimal abstract **architectural grid** or **workflow diagram**. Line-based, muted professional palette (grays, soft blues). No people, no product UI. Reinforces *structure, systems, architecture*. |
| **After “Who We Serve”** | Second visual break | **AI / systems overlay** or **structured line visualization**. Same palette: muted, professional. Reinforces *systems and discipline*, not product. |

**In code:**  
- Placeholders use `data-image-placement` and `data-style` for reference.  
- Replace the placeholder `<div>`s with `<img>` or Next `Image` when assets are ready.  
- Recommended aspect ratio for both: **2.5:1** (e.g. 1200×480px).

---

## Image Style Rules

**Use:**  
- Minimal abstract grids, nodes, or flows  
- AI / network overlays (subtle)  
- Workflow or system diagrams  
- Structured line-based visuals  
- Muted professional palette (gray, soft blue, low-saturation)

**Avoid:**  
- Stock photos of people or teams  
- Bright promotional graphics  
- Loud colors  
- Cartoon or casual illustrations  
- Product screenshots used as hero imagery  

**Goal:** Every image should reinforce *structure, systems, architecture, discipline*.

---

## Layout & Design Notes

- **Removed:**  
  - Feature-style blocks: “Campaign Execution Gap,” “AI Infrastructure for Marketers,” “Power Your Presence” (as promotional).  
  - Icon-heavy blocks (no repeated icon + title + short copy).  
  - Product-marketing and hype language.

- **Whitespace:**  
  - Generous vertical padding (`py-16`–`py-24` per section).  
  - Max width kept at `max-w-3xl` for body copy; image blocks at `max-w-5xl`.

- **Dividers:**  
  - Subtle `border-t border-gray-200/60` or `/80` between sections.

- **Background:**  
  - Alternating `bg-white` and `bg-[#FAFBFC]` for light separation without strong contrast.

- **Typography:**  
  - Headlines: `font-semibold`, `tracking-tight`.  
  - Body: `text-gray-600`, `leading-relaxed`.  
  - No decorative fonts; editorial, readable.

- **Tone:**  
  - Authority-driven, clear, structured.  
  - Reader should feel: “They understand the structural pressures of modern marketing,” not “They are selling a tool.”

---

## Related Images (Unsplash)

The About page can show **related images from Unsplash** for the two visual slots.

- **Setup:** Add `UNSPLASH_ACCESS_KEY` to `.env.local`. Get a key at [Unsplash Developers](https://unsplash.com/developers).
- **Behavior:** `getStaticProps` calls `getAboutImages()` from `lib/unsplashAboutImages.ts`, which searches Unsplash for:
  - **First slot:** `architecture blueprint abstract minimal` (landscape).
  - **Second slot:** `network data structure systems abstract` (landscape).
- **Caching:** Results are revalidated every 24 hours (`revalidate: 86400`). Without an API key, placeholders are shown.
- **Attribution:** Each image displays “Photo by [name] on Unsplash” with a link to the photo (Unsplash API guidelines).

Files involved: `lib/unsplashAboutImages.ts`, `pages/api/about-images.ts`, `pages/about.tsx`, `next.config.js` (images.remotePatterns for `images.unsplash.com`).

## What to Replace When Using Your Own Images

If you switch from Unsplash to static assets or another source:

1. **Hero image block** — `data-image-placement="architectural-grid"`.  
2. **Second image block** — `data-image-placement="systems-overlay"`.  

Keep aspect ratio 2.5:1 and rounded corners; use `object-cover` or `object-contain` as needed. Optional: add a small caption below each image.
