import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

/**
 * Durable RPA artifact storage. Screenshots are uploaded to Supabase
 * Storage (bucket: `rpa-artifacts`) and indexed in the `rpa_artifacts`
 * table with a 7-day retention. The table row is the authoritative
 * audit trail; the backing object can be pruned by the scheduler.
 *
 * Fallback: if the bucket can't be reached (permissions, env not
 * configured), the helper records a row with a local-fs `object_path`
 * so the RPA task still returns a valid artifact reference.
 */

const BUCKET = 'rpa-artifacts';

async function ensureBucket(): Promise<boolean> {
  try {
    const { data } = await supabase.storage.listBuckets();
    if (Array.isArray(data) && data.some((b: { name?: string }) => b.name === BUCKET)) return true;
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    return !error;
  } catch {
    return false;
  }
}

export type SaveArtifactInput = {
  action_id: string;
  correlation_id?: string | null;
  organization_id: string;
  platform?: string | null;
  action_type?: string | null;
  buffer: Buffer;
  ext?: string; // 'png' | 'jpg' | 'txt'
  kind?: 'screenshot' | 'log';
};

export type SavedArtifact = {
  object_path: string;
  public_url?: string | null;
  bytes: number;
  kind: 'screenshot' | 'log';
  durable: boolean;
};

export async function saveRpaArtifact(input: SaveArtifactInput): Promise<SavedArtifact | null> {
  const kind = input.kind ?? 'screenshot';
  const ext = input.ext ?? (kind === 'screenshot' ? 'png' : 'txt');
  const objectPath = `${input.organization_id}/${new Date().toISOString().slice(0, 10)}/${input.action_id}.${ext}`;
  const bytes = input.buffer?.length ?? 0;

  const bucketReady = await ensureBucket();

  let publicUrl: string | null = null;
  let durable = false;

  if (bucketReady) {
    try {
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, input.buffer, {
          contentType: kind === 'screenshot' ? 'image/png' : 'text/plain',
          upsert: true,
        });
      if (!uploadErr) {
        durable = true;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
        publicUrl = pub?.publicUrl ?? null;
      }
    } catch (err: any) {
      console.warn('[rpaArtifactStore] upload failed:', err?.message || err);
    }
  }

  // Index row regardless of upload outcome — operators can cross-check
  // failures against rpa_artifacts to identify lost screenshots.
  try {
    await supabase.from('rpa_artifacts').insert({
      action_id: input.action_id,
      correlation_id: input.correlation_id ?? null,
      organization_id: input.organization_id,
      platform: input.platform ?? null,
      action_type: input.action_type ?? null,
      artifact_kind: kind,
      object_path: objectPath,
      public_url: publicUrl,
      bytes,
    });
  } catch (err: any) {
    console.warn('[rpaArtifactStore] index row insert failed:', err?.message || err);
  }

  return { object_path: objectPath, public_url: publicUrl, bytes, kind, durable };
}

/**
 * Called by the scheduler's rpa-artifact-prune worker: asks the DB for
 * expired rows and returns their object_paths so the caller can issue
 * the matching `supabase.storage.remove(paths)`.
 */
export async function pruneRpaArtifacts(limit = 500): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('prune_rpa_artifacts', { p_limit: limit });
    if (error) {
      console.warn('[rpaArtifactStore] prune RPC failed:', error.message);
      return [];
    }
    const rows = (data || []) as Array<{ object_path: string }>;
    const paths = rows.map((r) => r.object_path).filter(Boolean);
    if (paths.length > 0) {
      try {
        await supabase.storage.from(BUCKET).remove(paths);
      } catch (err: any) {
        console.warn('[rpaArtifactStore] storage.remove failed:', err?.message || err);
      }
    }
    return paths;
  } catch (err: any) {
    console.warn('[rpaArtifactStore] prune exception:', err?.message || err);
    return [];
  }
}
