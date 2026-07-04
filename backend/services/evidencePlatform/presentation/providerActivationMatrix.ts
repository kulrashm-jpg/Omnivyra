/**
 * Provider Activation Matrix  (BETA-FINAL-001, Phase 5)
 *
 * A deterministic, HONEST activation status for every implemented provider — read-only, no fabrication, no
 * credential bypass. It reports what is configured vs awaiting credentials by consulting each provider's
 * `is<X>ProviderConfigured()` (env only) + its anticipated descriptor. This is presentation/activation only:
 * it changes no engine, no score, no calculation.
 */
import { ANTICIPATED_PROVIDERS } from '../providers/anticipatedProviders';
import { isBacklinkProviderConfigured } from '../../backlinkAuthorityProviderBridge';
import { isSearchConsoleProviderConfigured } from '../../searchConsoleProviderBridge';
import { isGa4ProviderConfigured } from '../../ga4ProviderBridge';
import { isBingProviderConfigured } from '../../bingWebmasterProviderBridge';
import { isReputationProviderConfigured } from '../../reputationProviderBridge';
import { isEntityProviderConfigured } from '../../entityGraphProviderBridge';
import { isAIVisibilityProviderConfigured } from '../../aiVisibilityProviderBridge';
import { isCommercialProviderConfigured } from '../../commercialProviderBridge';

export type ActivationStatus = 'active' | 'awaiting_credentials' | 'not_implemented';

export interface ProviderActivation {
  providerId: string;
  providerName: string;
  domain: string;
  implemented: boolean;
  configured: boolean;
  status: ActivationStatus;
  reliability: number;
  requiredEnvKeys: string[];
  /** Whether the canonical `provider_evidence` DB persistence migration is still unapplied. */
  migrationPending: boolean;
  /** Deterministic, honest activation steps for this provider. */
  activationChecklist: string[];
}

/** The implemented providers (BETA-PROVIDER-001..008) with their live `isConfigured` gate. */
const IMPLEMENTED: Array<{ id: string; domain: string; isConfigured: () => boolean }> = [
  { id: 'backlink.authority', domain: 'Authority', isConfigured: isBacklinkProviderConfigured },
  { id: 'search_console', domain: 'Google search', isConfigured: isSearchConsoleProviderConfigured },
  { id: 'analytics.ga4', domain: 'Behaviour', isConfigured: isGa4ProviderConfigured },
  { id: 'bing_webmaster', domain: 'Bing search', isConfigured: isBingProviderConfigured },
  { id: 'reviews', domain: 'Reputation / trust', isConfigured: isReputationProviderConfigured },
  { id: 'entity_graph', domain: 'Entity / knowledge graph', isConfigured: isEntityProviderConfigured },
  { id: 'llm_visibility', domain: 'AI visibility', isConfigured: isAIVisibilityProviderConfigured },
  { id: 'commercial', domain: 'Commercial / ROI', isConfigured: isCommercialProviderConfigured },
];

function checklist(envKeys: string[], configured: boolean, migrationPending: boolean): string[] {
  const steps: string[] = [];
  steps.push(configured ? `✓ credentials present (${envKeys.join(' / ')})` : `☐ set credentials: ${envKeys.join(' / ')}`);
  steps.push(migrationPending ? '☐ apply provider_evidence migration (DB-backed persistence)' : '✓ persistence migration applied');
  steps.push(configured ? '✓ provider available — ingestion will run on the next scheduler pass' : '☐ awaiting credentials — provider skipped, engines fall back');
  steps.push('☐ verify health + freshness after first ingestion (non-production tenant)');
  return steps;
}

/**
 * Build the activation matrix for all implemented + anticipated providers. `migrationApplied` reflects
 * whether the canonical `provider_evidence` table has been applied (default false in this environment).
 */
export function buildProviderActivationMatrix(opts: { migrationApplied?: boolean } = {}): ProviderActivation[] {
  const migrationPending = !opts.migrationApplied;
  const implementedIds = new Set(IMPLEMENTED.map((p) => p.id));
  const out: ProviderActivation[] = [];

  for (const impl of IMPLEMENTED) {
    const desc = ANTICIPATED_PROVIDERS.find((p) => p.providerId === impl.id);
    const configured = impl.isConfigured();
    out.push({
      providerId: impl.id,
      providerName: desc?.providerName ?? impl.id,
      domain: impl.domain,
      implemented: true,
      configured,
      status: configured ? 'active' : 'awaiting_credentials',
      reliability: desc?.providerReliability ?? 0,
      requiredEnvKeys: desc?.envKeys ?? [],
      migrationPending,
      activationChecklist: checklist(desc?.envKeys ?? [], configured, migrationPending),
    });
  }

  // Anticipated-but-not-implemented providers — reported honestly, never faked as active.
  for (const desc of ANTICIPATED_PROVIDERS) {
    if (implementedIds.has(desc.providerId)) continue;
    out.push({
      providerId: desc.providerId, providerName: desc.providerName, domain: desc.capabilities?.[0] ?? 'unknown',
      implemented: false, configured: false, status: 'not_implemented', reliability: desc.providerReliability ?? 0,
      requiredEnvKeys: desc.envKeys ?? [], migrationPending,
      activationChecklist: ['☐ provider not yet implemented (descriptor only)'],
    });
  }
  return out;
}

export interface ActivationSummary {
  implemented: number;
  active: number;
  awaitingCredentials: number;
  notImplemented: number;
  migrationPending: boolean;
}

export function summarizeActivation(matrix: ProviderActivation[]): ActivationSummary {
  return {
    implemented: matrix.filter((m) => m.implemented).length,
    active: matrix.filter((m) => m.status === 'active').length,
    awaitingCredentials: matrix.filter((m) => m.status === 'awaiting_credentials').length,
    notImplemented: matrix.filter((m) => m.status === 'not_implemented').length,
    migrationPending: matrix.some((m) => m.implemented && m.migrationPending),
  };
}
