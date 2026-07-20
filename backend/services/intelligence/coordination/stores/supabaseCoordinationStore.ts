/**
 * Coordination Intelligence Layer — Supabase-backed store (opt-in persistence).
 *
 * Selected only when `COORDINATION_REGISTRY_PERSIST_ENABLED=true`. Backs the port
 * with the net-new additive table `public.communication_registry` (migration
 * 20260720120000). Uses `ownedDbTable` (the observed, service-role client) —
 * matching marketPulse/contentMemory conventions.
 *
 * The embedding is stored inline as jsonb (a `SemanticEmbeddingRef`), mirroring
 * `content_memory.embedding` (jsonb, no pgvector dependency in this wave).
 */
import { ownedDbTable } from '../../../../db/writeOwner';
import type {
  CommunicationRecord,
  CoordinationQuery,
  CoordinationStore,
  CoordinationSourceModule,
  CommunicationIntent,
  PublicationStatus,
  SemanticEmbeddingRef,
  CoordinationRef,
  ArtifactType,
  GenerationStage,
} from '../coordinationContracts';

const TABLE = 'communication_registry';

interface Row {
  id: string;
  company_id: string;
  semantic_root_id: string;
  communication_intent: string;
  topic: string;
  campaign_id: string | null;
  platform: string | null;
  audience: string | null;
  publication_status: string;
  embedding: SemanticEmbeddingRef | null;
  content_ref: CoordinationRef | null;
  performance_ref: CoordinationRef | null;
  source_module: string;
  observed_at: string;
  metadata: Record<string, unknown> | null;
  artifact_type: string | null;
  parent_artifact_id: string | null;
  derived_from: string[] | null;
  generation_stage: string | null;
  idempotency_key: string | null;
}

function toRow(r: CommunicationRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: r.id,
    company_id: r.companyId,
    semantic_root_id: r.semanticRootId,
    communication_intent: r.communicationIntent,
    topic: r.topic,
    campaign_id: r.campaignId ?? null,
    platform: r.platform ?? null,
    audience: r.audience ?? null,
    publication_status: r.publicationStatus,
    embedding: r.embedding ?? null,
    content_ref: r.contentRef ?? null,
    performance_ref: r.performanceRef ?? null,
    source_module: r.sourceModule,
    observed_at: r.observedAt,
    metadata: r.metadata ?? null,
  };
  // Lineage columns are added only when present, so a v1 table (pre-lineage
  // migration) still accepts inserts. Backward compatible by construction.
  if (r.artifactType !== undefined) row.artifact_type = r.artifactType;
  if (r.parentArtifactId !== undefined) row.parent_artifact_id = r.parentArtifactId ?? null;
  if (r.derivedFrom !== undefined) row.derived_from = r.derivedFrom;
  if (r.generationStage !== undefined) row.generation_stage = r.generationStage;
  if (r.idempotencyKey !== undefined) row.idempotency_key = r.idempotencyKey ?? null;
  return row;
}

function fromRow(row: Row): CommunicationRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    semanticRootId: row.semantic_root_id,
    communicationIntent: row.communication_intent as CommunicationIntent,
    topic: row.topic,
    campaignId: row.campaign_id,
    platform: row.platform,
    audience: row.audience,
    publicationStatus: row.publication_status as PublicationStatus,
    embedding: row.embedding,
    contentRef: row.content_ref,
    performanceRef: row.performance_ref,
    sourceModule: row.source_module as CoordinationSourceModule,
    observedAt: row.observed_at,
    metadata: row.metadata ?? undefined,
    artifactType: (row.artifact_type as ArtifactType | null) ?? undefined,
    parentArtifactId: row.parent_artifact_id ?? undefined,
    derivedFrom: row.derived_from ?? undefined,
    generationStage: (row.generation_stage as GenerationStage | null) ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
  };
}

export class SupabaseCoordinationStore implements CoordinationStore {
  async insert(record: CommunicationRecord): Promise<CommunicationRecord> {
    const { data, error } = await ownedDbTable(TABLE).insert(toRow(record)).select('*').single();
    if (error) throw new Error(`coordination insert failed: ${error.message}`);
    return fromRow(data as Row);
  }

  async insertIdempotent(record: CommunicationRecord): Promise<{ record: CommunicationRecord; created: boolean }> {
    if (!record.idempotencyKey) {
      return { record: await this.insert(record), created: true };
    }
    const { data, error } = await ownedDbTable(TABLE).insert(toRow(record)).select('*').single();
    if (!error) return { record: fromRow(data as Row), created: true };
    // Unique-violation on (company_id, idempotency_key) ⇒ a concurrent/replayed
    // registration already landed. Return the existing row (created:false).
    const isUniqueViolation = (error as { code?: string }).code === '23505'
      || /duplicate key|unique constraint/i.test(error.message ?? '');
    if (isUniqueViolation) {
      const existing = await this.findByIdempotencyKey(record.companyId, record.idempotencyKey);
      if (existing) return { record: existing, created: false };
    }
    throw new Error(`coordination insertIdempotent failed: ${error.message}`);
  }

  private async findByIdempotencyKey(companyId: string, idempotencyKey: string): Promise<CommunicationRecord | null> {
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(`coordination findByIdempotencyKey failed: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  async getById(companyId: string, id: string): Promise<CommunicationRecord | null> {
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`coordination getById failed: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  async findByRoot(companyId: string, semanticRootId: string): Promise<CommunicationRecord[]> {
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('semantic_root_id', semanticRootId);
    if (error) throw new Error(`coordination findByRoot failed: ${error.message}`);
    return (data as Row[] ?? []).map(fromRow);
  }

  async query(companyId: string, query: CoordinationQuery): Promise<CommunicationRecord[]> {
    let q = ownedDbTable(TABLE).select('*').eq('company_id', companyId);
    if (query.campaignId !== undefined && query.campaignId !== null) q = q.eq('campaign_id', query.campaignId);
    if (query.platform) q = q.eq('platform', query.platform);
    if (query.audience) q = q.eq('audience', query.audience);
    if (query.communicationIntent) q = q.eq('communication_intent', query.communicationIntent);
    if (query.semanticRootId) q = q.eq('semantic_root_id', query.semanticRootId);
    if (query.since) q = q.gte('observed_at', query.since);
    q = q.order('observed_at', { ascending: false });
    if (query.limit && query.limit > 0) q = q.limit(query.limit);
    const { data, error } = await q;
    if (error) throw new Error(`coordination query failed: ${error.message}`);
    return (data as Row[] ?? []).map(fromRow);
  }

  async markStatus(companyId: string, id: string, status: PublicationStatus): Promise<void> {
    const { error } = await ownedDbTable(TABLE)
      .update({ publication_status: status })
      .eq('company_id', companyId)
      .eq('id', id);
    if (error) throw new Error(`coordination markStatus failed: ${error.message}`);
  }
}
