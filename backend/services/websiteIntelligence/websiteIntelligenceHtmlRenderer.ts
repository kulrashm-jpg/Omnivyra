/**
 * Website HTML renderer (Phase 20) — now Consumer #1 of the platform HTML renderer.
 * The renderer lives once in platformIntelligence/htmlRenderer; this re-exports it under
 * the website-named symbol so every existing import path stays byte-identical.
 */
import { renderIntelligenceHtml } from '../platformIntelligence/htmlRenderer';
import type { IntelligencePresentationModel } from '../platformIntelligence/presentationModel';

export const renderWebsiteIntelligenceHtml = (model: IntelligencePresentationModel): string => renderIntelligenceHtml(model);
