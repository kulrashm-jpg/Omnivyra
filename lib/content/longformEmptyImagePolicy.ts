/**
 * Empty-image policy for freshly generated long-form documents (CREATOR-040, STEP 2).
 *
 * Governs what the generation→editor seam does with empty image slots, so fresh
 * documents don't receive random placeholder photos by default:
 *
 *   • 'placeholder' — fill every empty image with a deterministic placeholder (legacy).
 *   • 'stock'       — leave empty at the seam; the editor fills via the STOCK provider
 *                     on open (placeholder only if stock fails). DEFAULT.
 *   • 'empty'       — leave image blocks intentionally empty; block, layout and editor
 *                     actions are preserved; the slot is never deleted.
 *
 * Config: LONGFORM_EMPTY_IMAGE_POLICY (server) / NEXT_PUBLIC_LONGFORM_EMPTY_IMAGE_POLICY
 * (client). Reuses the existing provider chain + placeholder — no new system.
 */

export type EmptyImagePolicy = 'placeholder' | 'stock' | 'empty';

const VALID: EmptyImagePolicy[] = ['placeholder', 'stock', 'empty'];

export function getEmptyImagePolicy(): EmptyImagePolicy {
  const raw = (typeof process !== 'undefined' && process.env
    ? (process.env.LONGFORM_EMPTY_IMAGE_POLICY || process.env.NEXT_PUBLIC_LONGFORM_EMPTY_IMAGE_POLICY || '')
    : '');
  const v = String(raw).trim().toLowerCase() as EmptyImagePolicy;
  return VALID.includes(v) ? v : 'stock';
}
