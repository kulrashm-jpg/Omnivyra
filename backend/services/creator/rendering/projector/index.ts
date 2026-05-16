/**
 * Creator Rendering — projector public surface (barrel).
 *
 * Step-R2 PURE render-safety boundary. No providers, no queue, no DB, no
 * scheduler/workspace mutation. Runtime-inert: nothing in pages/ or
 * backend/queue/ imports this yet.
 */

export {
  projectRenderRequest,
} from './renderRequestProjector';
export type { ProjectRenderOptions } from './renderRequestProjector';

export {
  validateRenderProjection,
  assertRenderableAsset,
  RenderProjectionError,
} from './renderProjectionValidators';

export {
  sanitizeRenderProjection,
  deepFreeze,
} from './renderProjectionSanitizer';
