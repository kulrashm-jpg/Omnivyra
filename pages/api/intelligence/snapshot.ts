/** BARREL — route split into backend parts (this path stays the ONLY live endpoint).
 *  Parts live in backend/services/intelligence so Next does not expose them as routes. */
export * from '../../../backend/services/intelligence/snapshotRouteBuild';
export * from '../../../backend/services/intelligence/snapshotRouteHandler';
export { default } from '../../../backend/services/intelligence/snapshotRouteHandler';
