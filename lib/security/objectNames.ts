/**
 * STEP 3AH-91 SEC-E5 — unguessable storage object names.
 *
 * Objects in PUBLIC storage buckets (`media-uploads`, `media-*s`) are readable
 * by anyone who knows the URL, so the object name is the only access control.
 * `Math.random().toString(36).slice(2, 10)` is neither a CSPRNG nor long
 * enough (~41 bits, predictable from V8's xorshift state). This stem carries
 * 128 bits from the platform CSPRNG; the millisecond prefix only keeps names
 * roughly time-ordered for operators.
 */
import { randomBytes } from 'crypto';

export function unguessableObjectStem(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}`;
}
