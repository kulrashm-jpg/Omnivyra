/**
 * Supabase Semantic Root store (OMNI-COORD-002) — opt-in persistence.
 *
 * Selected only when COORDINATION_REGISTRY_PERSIST_ENABLED=true. Backs the
 * `SemanticRootStore` port with the net-new additive table `public.semantic_roots`
 * (migration 20260720123000). Uses `ownedDbTable` (observed service-role client).
 */
import { ownedDbTable } from '../../../../db/writeOwner';
import type { CommunicationIntent } from '../coordinationContracts';
import type { SemanticRoot, SemanticRootStore } from '../semanticContinuityContracts';

const TABLE = 'semantic_roots';

interface Row {
  id: string;
  company_id: string;
  business_objective: string;
  campaign_objective: string | null;
  topic: string;
  communication_intent: string;
  target_audience: string;
  positioning: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

function toRow(r: SemanticRoot): Row {
  return {
    id: r.id,
    company_id: r.companyId,
    business_objective: r.businessObjective,
    campaign_objective: r.campaignObjective ?? null,
    topic: r.topic,
    communication_intent: r.communicationIntent,
    target_audience: r.targetAudience,
    positioning: r.positioning,
    created_at: r.createdAt,
    metadata: r.metadata ?? null,
  };
}

function fromRow(row: Row): SemanticRoot {
  return {
    id: row.id,
    companyId: row.company_id,
    businessObjective: row.business_objective,
    campaignObjective: row.campaign_objective,
    topic: row.topic,
    communicationIntent: row.communication_intent as CommunicationIntent,
    targetAudience: row.target_audience,
    positioning: row.positioning,
    createdAt: row.created_at,
    metadata: row.metadata ?? undefined,
  };
}

export class SupabaseSemanticRootStore implements SemanticRootStore {
  async upsert(root: SemanticRoot): Promise<SemanticRoot> {
    const { data, error } = await ownedDbTable(TABLE)
      .upsert(toRow(root), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw new Error(`semantic root upsert failed: ${error.message}`);
    return fromRow(data as Row);
  }

  async get(companyId: string, id: string): Promise<SemanticRoot | null> {
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`semantic root get failed: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  async list(companyId: string): Promise<SemanticRoot[]> {
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`semantic root list failed: ${error.message}`);
    return (data as Row[] ?? []).map(fromRow);
  }
}
