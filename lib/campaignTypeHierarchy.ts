/**
 * Hierarchical campaign type selection: primary (exclusive) + conditional secondary options.
 * Maps all selections to the original six core types for the recommendation engine.
 * Do not change existing core type IDs used by the recommendation pipeline.
 */

/** Original six campaign types used by the recommendation engine. */
export const CORE_CAMPAIGN_TYPES = [
  'brand_awareness',
  'network_expansion',
  'lead_generation',
  'authority_positioning',
  'engagement_growth',
  'product_promotion',
] as const;

export type CoreCampaignType = (typeof CORE_CAMPAIGN_TYPES)[number];

/** Primary selection IDs (mutually exclusive). */
export type PrimaryCampaignTypeId =
  | CoreCampaignType
  | 'personal_brand_promotion'
  | 'third_party';

/** Secondary option IDs. Some are display-only and map to a core type (e.g. community_building → engagement_growth). */
export type SecondaryOptionId =
  | CoreCampaignType
  | 'personal_brand_awareness'   // → brand_awareness
  | 'community_building'         // → engagement_growth
  | 'collaboration_seeking'      // → network_expansion
  | 'client_acquisition'        // → lead_generation
  | 'product_service_promotion'; // → product_promotion

export type CampaignContext = 'business' | 'personal' | 'third_party';

export interface PrimaryOption {
  id: PrimaryCampaignTypeId;
  label: string;
  /** When true, skip secondary step entirely. */
  skipSecondary: boolean;
}

export interface SecondaryOption {
  id: SecondaryOptionId;
  label: string;
  /** Core type for engine; same as id if already core. */
  mapsToCore: CoreCampaignType;
}

export interface SecondaryGroup {
  label: string;
  options: SecondaryOption[];
}

/** Primary options for Step 1 (one selectable). */
export const PRIMARY_OPTIONS: PrimaryOption[] = [
  { id: 'brand_awareness', label: 'Brand Awareness', skipSecondary: false },
  { id: 'authority_positioning', label: 'Authority Positioning', skipSecondary: false },
  { id: 'network_expansion', label: 'Network Expansion', skipSecondary: false },
  { id: 'engagement_growth', label: 'Engagement Growth', skipSecondary: false },
  { id: 'lead_generation', label: 'Lead Generation', skipSecondary: false },
  { id: 'product_promotion', label: 'Product Promotion', skipSecondary: false },
  { id: 'personal_brand_promotion', label: 'Personal Brand Promotion', skipSecondary: false },
  { id: 'third_party', label: 'Third-Party Campaign', skipSecondary: true },
];

/** Map secondary option id → core type. */
const SECONDARY_TO_CORE: Record<SecondaryOptionId, CoreCampaignType> = {
  brand_awareness: 'brand_awareness',
  network_expansion: 'network_expansion',
  lead_generation: 'lead_generation',
  authority_positioning: 'authority_positioning',
  engagement_growth: 'engagement_growth',
  product_promotion: 'product_promotion',
  personal_brand_awareness: 'brand_awareness',
  community_building: 'engagement_growth',
  collaboration_seeking: 'network_expansion',
  client_acquisition: 'lead_generation',
  product_service_promotion: 'product_promotion',
};

/** Primary → allowed secondary option ids (flat list for non–personal-brand primaries). */
const SECONDARY_COMPATIBILITY: Record<PrimaryCampaignTypeId, SecondaryOptionId[] | 'personal_brand'> = {
  brand_awareness: ['authority_positioning', 'engagement_growth', 'network_expansion'],
  authority_positioning: ['brand_awareness', 'engagement_growth', 'network_expansion'],
  network_expansion: ['engagement_growth', 'authority_positioning', 'brand_awareness'],
  engagement_growth: ['brand_awareness', 'network_expansion', 'authority_positioning'],
  lead_generation: ['product_promotion', 'engagement_growth', 'network_expansion'],
  product_promotion: ['lead_generation', 'engagement_growth'],
  personal_brand_promotion: 'personal_brand',
  third_party: [],
};

/** All secondary options for Personal Brand, grouped. */
export const PERSONAL_BRAND_SECONDARY_GROUPS: SecondaryGroup[] = [
  {
    label: 'Primary personal goals',
    options: [
      { id: 'authority_positioning', label: 'Authority Positioning', mapsToCore: 'authority_positioning' },
      { id: 'personal_brand_awareness', label: 'Personal Brand Awareness', mapsToCore: 'brand_awareness' },
      { id: 'network_expansion', label: 'Network Expansion', mapsToCore: 'network_expansion' },
    ],
  },
  {
    label: 'Supporting',
    options: [
      { id: 'engagement_growth', label: 'Engagement Growth', mapsToCore: 'engagement_growth' },
      { id: 'community_building', label: 'Community Building', mapsToCore: 'engagement_growth' },
      { id: 'collaboration_seeking', label: 'Collaboration Seeking', mapsToCore: 'network_expansion' },
    ],
  },
  {
    label: 'Opportunity',
    options: [
      { id: 'lead_generation', label: 'Lead Generation', mapsToCore: 'lead_generation' },
      { id: 'client_acquisition', label: 'Client Acquisition', mapsToCore: 'lead_generation' },
    ],
  },
  {
    label: 'Promotion',
    options: [
      { id: 'product_service_promotion', label: 'Product/Service Promotion', mapsToCore: 'product_promotion' },
    ],
  },
];

/** Flat list of all secondary options for non–personal-brand primaries (for labels). */
const SECONDARY_OPTION_LABELS: Record<SecondaryOptionId, string> = {
  brand_awareness: 'Brand Awareness',
  network_expansion: 'Network Expansion',
  lead_generation: 'Lead Generation',
  authority_positioning: 'Authority Positioning',
  engagement_growth: 'Engagement Growth',
  product_promotion: 'Product Promotion',
  personal_brand_awareness: 'Personal Brand Awareness',
  community_building: 'Community Building',
  collaboration_seeking: 'Collaboration Seeking',
  client_acquisition: 'Client Acquisition',
  product_service_promotion: 'Product/Service Promotion',
};

/**
 * Returns secondary options for the given primary.
 * For personal_brand_promotion use PERSONAL_BRAND_SECONDARY_GROUPS instead.
 */
export function getSecondaryOptionsForPrimary(
  primaryId: PrimaryCampaignTypeId
): SecondaryOption[] {
  if (primaryId === 'third_party') return [];
  const allowed = SECONDARY_COMPATIBILITY[primaryId];
  if (allowed === 'personal_brand') return [];
  return allowed.map((id) => ({
    id,
    label: SECONDARY_OPTION_LABELS[id],
    mapsToCore: SECONDARY_TO_CORE[id],
  }));
}

/**
 * Whether the primary uses the personal-brand grouped secondaries.
 */
export function isPersonalBrandPrimary(primaryId: PrimaryCampaignTypeId): boolean {
  return SECONDARY_COMPATIBILITY[primaryId] === 'personal_brand';
}

/**
 * Context for analytics and engine: business | personal | third_party.
 */
export function getContextFromPrimary(primaryId: PrimaryCampaignTypeId): CampaignContext {
  if (primaryId === 'third_party') return 'third_party';
  if (primaryId === 'personal_brand_promotion') return 'personal';
  return 'business';
}

/**
 * Maps primary + secondary selections to the core six types for the recommendation engine.
 * Deduplicates and preserves order (primary first, then secondaries).
 */
export function getMappedCoreTypes(
  primaryId: PrimaryCampaignTypeId,
  secondaryIds: SecondaryOptionId[]
): CoreCampaignType[] {
  if (primaryId === 'third_party') {
    return ['engagement_growth'];
  }
  const primaryCore = primaryId in SECONDARY_TO_CORE
    ? (SECONDARY_TO_CORE as Record<string, CoreCampaignType>)[primaryId]
    : null;
  const fromPrimary = primaryCore ? [primaryCore] : [];
  const fromSecondaries = secondaryIds
    .map((id) => SECONDARY_TO_CORE[id])
    .filter(Boolean);
  const seen = new Set<CoreCampaignType>();
  const result: CoreCampaignType[] = [];
  for (const t of [...fromPrimary, ...fromSecondaries]) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result.length > 0 ? result : ['brand_awareness'];
}

/**
 * Builds campaign_types and campaign_weights for storage (backward compatible).
 * Weights: primary gets remainder so sum is 100; secondaries split the rest evenly.
 */
export function toLegacyCampaignPayload(
  primaryId: PrimaryCampaignTypeId,
  secondaryIds: SecondaryOptionId[]
): { campaign_types: string[]; campaign_weights: Record<string, number> } {
  const mapped = getMappedCoreTypes(primaryId, secondaryIds);
  if (mapped.length === 1) {
    return { campaign_types: [...mapped], campaign_weights: { [mapped[0]]: 100 } };
  }
  const primaryCore = primaryId in SECONDARY_TO_CORE
    ? (SECONDARY_TO_CORE as Record<string, CoreCampaignType>)[primaryId]
    : mapped[0];
  const secondaryCores = mapped.filter((t) => t !== primaryCore);
  const primaryWeight = 100 - Math.floor((100 * secondaryCores.length) / (secondaryCores.length + 1));
  const remainder = 100 - primaryWeight;
  const perSecondary = secondaryCores.length > 0 ? Math.floor(remainder / secondaryCores.length) : 0;
  const weights: Record<string, number> = { [primaryCore]: primaryWeight };
  secondaryCores.forEach((t) => {
    weights[t] = (weights[t] ?? 0) + perSecondary;
  });
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum !== 100 && secondaryCores.length > 0) {
    weights[secondaryCores[0]] = (weights[secondaryCores[0]] ?? 0) + (100 - sum);
  }
  return { campaign_types: [...mapped], campaign_weights: weights };
}

/**
 * Normalized payload for the recommendation engine and storage.
 */
export interface HierarchicalCampaignPayload {
  primary_campaign_type: PrimaryCampaignTypeId;
  secondary_campaign_types: SecondaryOptionId[];
  context: CampaignContext;
  mapped_core_types: CoreCampaignType[];
  campaign_types: string[];
  campaign_weights: Record<string, number>;
}

export function buildHierarchicalPayload(
  primaryId: PrimaryCampaignTypeId,
  secondaryIds: SecondaryOptionId[] = []
): HierarchicalCampaignPayload {
  const context = getContextFromPrimary(primaryId);
  const mapped_core_types = getMappedCoreTypes(primaryId, secondaryIds);
  const { campaign_types, campaign_weights } = toLegacyCampaignPayload(primaryId, secondaryIds);
  return {
    primary_campaign_type: primaryId,
    secondary_campaign_types: secondaryIds,
    context,
    mapped_core_types,
    campaign_types,
    campaign_weights,
  };
}

/**
 * Dilution/conflict: "adjacent" vs "conflicting" is heuristic.
 * Compatible = in allowed secondaries. Adjacent = not in allowed but not opposite.
 * Conflicting = e.g. lead gen + authority as primary/secondary mix that dilutes focus.
 * Returns severity: 'none' | 'soft' | 'caution'.
 */
export function getDilutionSeverity(
  primaryId: PrimaryCampaignTypeId,
  secondaryIds: SecondaryOptionId[]
): 'none' | 'soft' | 'caution' {
  if (secondaryIds.length <= 1) return 'none';
  const allowed = SECONDARY_COMPATIBILITY[primaryId];
  const allowedSet = allowed === 'personal_brand'
    ? new Set(PERSONAL_BRAND_SECONDARY_GROUPS.flatMap((g) => g.options.map((o) => o.id)))
    : new Set(allowed ?? []);
  const conflictingPairs: [string, string][] = [
    ['lead_generation', 'authority_positioning'],
    ['product_promotion', 'authority_positioning'],
  ];
  const hasConflict = secondaryIds.some((s1) =>
    secondaryIds.some((s2) => {
      if (s1 === s2) return false;
      const c1 = SECONDARY_TO_CORE[s1];
      const c2 = SECONDARY_TO_CORE[s2];
      return conflictingPairs.some(
        ([a, b]) => (c1 === a && c2 === b) || (c1 === b && c2 === a)
      );
    })
  );
  if (hasConflict) return 'caution';
  const allAllowed = secondaryIds.every((id) => allowedSet.has(id));
  if (!allAllowed && secondaryIds.length > 2) return 'soft';
  return 'none';
}
