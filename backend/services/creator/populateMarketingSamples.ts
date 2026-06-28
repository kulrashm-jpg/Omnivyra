/**
 * populateMarketingSamples (CREATOR-087) — one-time internal command that fills the
 * Sample Library by calling the EXISTING internal generation function directly
 * (runCreatorOrchestration). No HTTP, no auth, no browser, no polling, no new
 * renderer/generator/pipeline. It reuses the existing showcase repository for
 * storage (content/creator-showcases/showcases.json) and is resumable (skips
 * samples that already have an entry; records failures and continues).
 *
 * A developer runs it locally — it requires a backend environment (DB + renderer)
 * and consumes generation resources, exactly like a normal Creator generation.
 */

import { promises as fsp, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { listSamples } from '../../../lib/creator-outcomes/marketingSample';
import { renderCreatorAssetReviewPreview } from '../creatorAssetRenderer';

const SHOWCASES_PATH = path.join(process.cwd(), 'content', 'creator-showcases', 'showcases.json');

/** The SAME deterministic demo brief for every sample (only the sample changes). */
const DEMO = {
  company: 'Acme Technologies', industry: 'SaaS', audience: 'SMBs',
  goal: 'Generate Leads', product: 'CRM Platform', brand: 'Modern', tone: 'Professional',
} as const;

interface ShowcaseEntry {
  id: string; templateId: string; title: string; description: string;
  industry: string; audience: string; businessOutcome: string; visualStyle: string;
  family: string; thumbnailUrl: string; previewUrl: string;
  slides: string[]; tags: string[]; featured: boolean; order: number;
}
interface ShowcasesFile { version: number; note?: string; showcases: ShowcaseEntry[] }

const PUBLIC_SHOWCASES_DIR = path.join(process.cwd(), 'public', 'creator-showcases');

export interface PopulateOptions {
  companyId: string;                                  // a real company id (e.g. test org)
  limit?: number;
  assetType?: 'image' | 'carousel' | 'infographic';
}
export interface PopulateResult {
  total: number; scheduled: number; succeeded: number; failed: number; skipped: number;
  failures: Array<{ sampleId: string; error: string }>;
}

export async function populateMarketingSamples(opts: PopulateOptions): Promise<PopulateResult> {
  const file = JSON.parse(await fsp.readFile(SHOWCASES_PATH, 'utf8')) as ShowcasesFile;
  if (!Array.isArray(file.showcases)) file.showcases = [];
  const done = new Set(file.showcases.map((s) => s.visualStyle));
  const samples = listSamples();
  const result: PopulateResult = { total: samples.length, scheduled: 0, succeeded: 0, failed: 0, skipped: 0, failures: [] };
  let order = file.showcases.length;
  let processed = 0;

  for (const sample of samples) {
    if (opts.limit && processed >= opts.limit) break;
    if (done.has(sample.sampleId)) { result.skipped += 1; continue; }   // resumable
    processed += 1;
    result.scheduled += 1;
    const assetType = opts.assetType ?? sample.supportedAssetTypes[0] ?? 'image';
    try {
      // CREATOR-091/092: NO AI blueprint generation, NO Storage upload. Render the
      // image LOCALLY to a Buffer (deterministic demo copy + the Sample Definition's
      // colours) and write it straight into public/. Customer generation untouched.
      const reviewType: 'image' | 'infographic' = assetType === 'infographic' ? 'infographic' : 'image';
      const { buffer } = await renderCreatorAssetReviewPreview({
        assetType: reviewType,
        platform: 'linkedin',
        title: `${DEMO.company} ${DEMO.product}`,
        body: `${DEMO.product} for ${DEMO.audience} — ${DEMO.goal}`,
        overlayText: { headline: DEMO.goal, subheadline: `${DEMO.product} for ${DEMO.audience}`, cta: 'Learn more' },
        colors: [sample.generationDNA.colorLanguage.primary, sample.generationDNA.colorLanguage.surface],
        brand: { companyName: DEMO.company, tagline: DEMO.product },
        designDna: {
          composition: sample.generationDNA.composition, hierarchy: sample.generationDNA.hierarchy,
          typography: sample.generationDNA.typography, spacing: sample.generationDNA.spacing,
          photography: sample.generationDNA.photography, illustration: sample.generationDNA.illustration,
          renderingStyle: sample.generationDNA.renderingStyle, shapeLanguage: sample.generationDNA.shapeLanguage,
          camera: sample.generationDNA.camera, lighting: sample.generationDNA.lighting,
        },
      });
      const dir = path.join(PUBLIC_SHOWCASES_DIR, sample.sampleId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'preview.png'), buffer);
      const url = `/creator-showcases/${sample.sampleId}/preview.png`;
      const entry: ShowcaseEntry = {
        id: `${sample.sampleId}-1`, templateId: sample.sampleId, title: sample.title,
        description: sample.description, industry: DEMO.industry, audience: DEMO.audience,
        businessOutcome: DEMO.goal, visualStyle: sample.sampleId, family: assetType,
        thumbnailUrl: url, previewUrl: url, slides: [], tags: [], featured: false, order: order++,
      };
      file.showcases.push(entry);
      done.add(sample.sampleId);
      await fsp.writeFile(SHOWCASES_PATH, `${JSON.stringify(file, null, 2)}\n`);  // persist after each (resumable)
      result.succeeded += 1;
    } catch (e) {
      result.failed += 1;
      result.failures.push({ sampleId: sample.sampleId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
