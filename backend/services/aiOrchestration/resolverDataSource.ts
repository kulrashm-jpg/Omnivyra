/**
 * resolverDataSource.ts — supabase-backed ResolverDeps factory (AI-ORCH 2A-2.1).
 *
 * Read-only loaders over the FROZEN orchestration schema, resolving surrogate ids to
 * names/keys/content so the resolver stays pure. This is the trivial data adapter the
 * 2A-2 resolver's dependency-injection expects.
 *
 * LAZY-LOADED: imported dynamically by the shadow hook ONLY when
 * AI_CONFIG_RESOLVER_SHADOW is ON, so the OFF path never loads the DB layer. All
 * reads are best-effort and non-throwing at the row level; the shadow runner's
 * fail-safe wrapper additionally swallows anything that does throw. Nothing here
 * writes, executes, or influences the live request.
 */
import { ownedDbTable } from '../../db/writeOwner';
import type {
  ResolverDeps,
  ResolverBindingRow,
  ResolverProfileVersion,
} from './configurationResolver';

function mapBinding(row: any): ResolverBindingRow | null {
  if (!row) return null;
  return {
    scope: row.scope,
    capabilityId: row.capability_id ?? null,
    orgId: row.org_id ?? null,
    profileId: row.profile_id,
    overridePatch: row.override_patch ?? null,
    isActive: !!row.is_active,
  };
}

export function createSupabaseResolverDeps(): ResolverDeps {
  return {
    async mapOperationToCapability(operation) {
      const { data } = await ownedDbTable('ai_operation_capability_map')
        .select('capability_id')
        .eq('operation', operation)
        .maybeSingle();
      return (data as any)?.capability_id ?? null;
    },

    async loadBinding(orgId, capabilityId) {
      let q = ownedDbTable('ai_capability_profile_bindings')
        .select('scope, capability_id, org_id, profile_id, override_patch, is_active')
        .eq('is_active', true);
      q = orgId === null ? q.is('org_id', null) : q.eq('org_id', orgId);
      q = capabilityId === null ? q.is('capability_id', null) : q.eq('capability_id', capabilityId);
      const { data } = await q.maybeSingle();
      return mapBinding(data);
    },

    async loadPlatformDefaultBinding() {
      const { data } = await ownedDbTable('ai_capability_profile_bindings')
        .select('scope, capability_id, org_id, profile_id, override_patch, is_active')
        .eq('scope', 'platform_default')
        .eq('is_active', true)
        .maybeSingle();
      return mapBinding(data);
    },

    async loadActiveProfileVersion(profileId): Promise<ResolverProfileVersion | null> {
      // Profile → active version pointer.
      const { data: profile } = await ownedDbTable('ai_execution_profiles')
        .select('id, key, active_version_id')
        .eq('id', profileId)
        .maybeSingle();
      const activeVersionId = (profile as any)?.active_version_id;
      if (!activeVersionId) return null;

      const { data: ver } = await ownedDbTable('ai_execution_profile_versions')
        .select('*')
        .eq('id', activeVersionId)
        .maybeSingle();
      if (!ver) return null;
      const v = ver as any;

      // Resolve id-typed references → content (explicit mode only; tier seeds have none).
      let providerRef: string | null = null;
      if (v.provider_id) {
        const { data } = await ownedDbTable('llm_providers').select('name').eq('id', v.provider_id).maybeSingle();
        providerRef = (data as any)?.name ?? null;
      }
      let modelRef: string | null = null;
      if (v.model_id) {
        const { data } = await ownedDbTable('llm_models').select('model_key').eq('id', v.model_id).maybeSingle();
        modelRef = (data as any)?.model_key ?? null;
      }
      let routingContent: Record<string, unknown> | null = null;
      let routingPolicyKey: string | null = null;
      if (v.routing_policy_id) {
        const { data } = await ownedDbTable('ai_routing_policies')
          .select('key, providers, circuit_breaker_policy')
          .eq('id', v.routing_policy_id)
          .maybeSingle();
        if (data) {
          routingPolicyKey = (data as any).key ?? null;
          routingContent = { providers: (data as any).providers, circuit_breaker_policy: (data as any).circuit_breaker_policy };
        }
      }

      return {
        profileId: (profile as any).id,
        profileKey: (profile as any).key,
        version: v.version,
        mode: v.mode,
        qualityTier: v.quality_tier ?? null,
        capabilityRequirements: v.capability_requirements ?? null,
        providerRef,
        modelRef,
        modelVersionTag: v.model_version_tag ?? null,
        deploymentId: v.deployment_id ?? null,
        routingPolicyId: v.routing_policy_id ?? null,
        routingPolicyKey,
        routingContent,
        params: v.params ?? null,
        modality: v.modality ?? null,
        reliability: v.reliability ?? null,
        limits: v.limits ?? null,
        caching: v.caching ?? null,
        safety: v.safety ?? null,
      };
    },
  };
}
