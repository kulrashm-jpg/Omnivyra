/**
 * Curated SYSTEM template registration (CREATOR-127) — SERVER-SIDE only.
 *
 * Registers the curated infographic SYSTEM templates into the runtime template
 * registry so the renderer's `resolveTemplate(template_id)` resolves a curated
 * design directly (carrying composition + semanticStructure + style), enabling the
 * renderer's template-first read-switch.
 *
 * Source: the materializer (the same derivation the bootstrap uses), invoked
 * server-side. We deliberately do NOT static-import the full persisted JSON here —
 * a 1.28 MB JSON literal OOMs `tsc` (resolveJsonModule). The gallery still loads its
 * lean persisted JSON; only this server-only renderer path materializes, and it is
 * LAZY + IDEMPOTENT and only runs when a curated `template_id` is actually rendered
 * (gated by the caller), so current blueprint-only traffic never triggers it.
 *
 * When the full migration retires blueprint/marketingSample, this is replaced by a
 * direct load of the persisted complete records.
 */

import { registerUserTemplates } from '../creator-templates';
import { materializeAllCuratedTemplates } from './creatorTemplateMaterializer';

let registered = false;
/** Register the curated infographic SYSTEM templates into the runtime registry, once. */
export function registerCuratedSystemTemplates(): void {
  if (registered) return;
  registerUserTemplates(materializeAllCuratedTemplates('infographic'));
  registered = true;
}
