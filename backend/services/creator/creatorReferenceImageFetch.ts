/**
 * THE canonical byte-reading path for composition reference images.
 *
 * WHY THIS EXISTS
 * ---------------
 * The compose lane and the condition lane each carried their own private copy
 * of the same four lines — `downloadCanonicalBytes` and `downloadBytes`,
 * identical in behaviour, differing only in name. Two copies of "how do we read
 * a user's image" is two places for a storage decision to drift: one could
 * acquire a signed URL, a public fallback or a different failure convention
 * while the other did not, and the difference would only be visible in what the
 * provider received.
 *
 * So there is one, and both lanes call it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It reads bytes. It does not decide whether an asset MAY be read — that is the
 * resolver's tenant-scoped lookup and lifecycle check, performed before a
 * storage location is ever produced — and it does not decide whether the bytes
 * are USABLE, because the two lanes answer that differently: compose needs an
 * image sharp can decode, condition needs a mime type and size the endpoint
 * accepts. Folding those together would give one lane the other's rules.
 *
 * No signed URL and no public URL: the object is read through the service
 * client directly, so private buckets stay private and no locator that could be
 * logged or forwarded is ever produced.
 */
import { supabase } from '../../db/supabaseClient';

/**
 * Read one canonical asset's bytes from private storage.
 *
 * Returns `null` rather than throwing: a missing or unreadable object is an
 * outcome the caller must report as a typed rejection alongside its other
 * rejections, not an exception that would abandon the references that did
 * resolve.
 */
export async function readCanonicalAssetBytes(
  bucket: string,
  path: string,
): Promise<Buffer | null> {
  if (!bucket?.trim() || !path?.trim()) return null;
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
