/**
 * Website Intelligence React components (Phase 19/20) — now Consumer #1 of the platform
 * React renderer (Phase 21B). The components + styling live once in components/
 * platformIntelligence; this barrel re-exports them plus the website→model adapter, so
 * every existing import path (e.g. /website-health) stays byte-identical.
 */
export * from '../platformIntelligence';
export { buildWebsitePresentationModel } from '../../backend/services/websiteIntelligence/websitePresentationModel';
export type { WebsitePresentationModel } from '../../backend/services/websiteIntelligence/websitePresentationModel';
