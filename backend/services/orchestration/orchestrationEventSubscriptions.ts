/**
 * orchestrationEventSubscriptions.ts — declarative event subscriptions (CKRE-004 §3).
 *
 * The orchestrator SUBSCRIBES to (does not re-emit) the existing CKRE / auth /
 * onboarding / integration events. This is a pure declarative registry mapping
 * each subscribed event to an orchestration trigger + the knowledge domains it
 * seeds. It reuses the existing event vocabulary — no new event system. The
 * orchestrator's dispatch(eventName, ctx) consumes this table.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';

export type OrchestrationTrigger =
  | 'orchestrate_knowledge_change'
  | 'invalidate_integration'
  | 'monitor_refresh'
  | 'orchestrate_rollback'
  | 'plan_refresh';

export interface SubscriptionDefinition {
  event: string;
  trigger: OrchestrationTrigger;
  /** Knowledge domains this event seeds into the dependency graph (if any). */
  seedDomains: KnowledgeDomainId[];
  description: string;
}

const SUBSCRIPTIONS_INTERNAL: Record<string, SubscriptionDefinition> = {
  // Knowledge lifecycle (CKRE-003)
  KnowledgeCreated:    { event: 'KnowledgeCreated', trigger: 'orchestrate_knowledge_change', seedDomains: [], description: 'A new knowledge version — propagate downstream.' },
  KnowledgeActivated:  { event: 'KnowledgeActivated', trigger: 'orchestrate_knowledge_change', seedDomains: [], description: 'Version activated — invalidate/regenerate consumers.' },
  KnowledgeCompared:   { event: 'KnowledgeCompared', trigger: 'monitor_refresh', seedDomains: [], description: 'A diff was computed — observability only.' },
  KnowledgeRolledBack: { event: 'KnowledgeRolledBack', trigger: 'orchestrate_rollback', seedDomains: [], description: 'Rollback requested — coordinate restore + invalidation.' },
  // Website / refresh (CKRE-001/002)
  WebsiteChanged:      { event: 'WebsiteChanged', trigger: 'plan_refresh', seedDomains: ['WEBSITE'], description: 'Website content changed — plan a refresh.' },
  RefreshCompleted:    { event: 'RefreshCompleted', trigger: 'monitor_refresh', seedDomains: [], description: 'Refresh finished — monitor + mark tasks complete.' },
  RefreshFailed:       { event: 'RefreshFailed', trigger: 'monitor_refresh', seedDomains: [], description: 'Refresh failed — trigger recovery.' },
  ManualRefreshRequested: { event: 'ManualRefreshRequested', trigger: 'plan_refresh', seedDomains: [], description: 'Manual refresh — plan immediately.' },
  CompanyProfileUpdated:  { event: 'CompanyProfileUpdated', trigger: 'orchestrate_knowledge_change', seedDomains: ['IDENTITY', 'BRAND'], description: 'Profile edited — propagate identity/brand.' },
  // Integrations (ONBOARD-001)
  CMSConnected:        { event: 'CMSConnected', trigger: 'invalidate_integration', seedDomains: ['WEBSITE', 'SEO'], description: 'CMS connected — invalidate website/SEO consumers.' },
  CMSDisconnected:     { event: 'CMSDisconnected', trigger: 'invalidate_integration', seedDomains: ['WEBSITE', 'SEO'], description: 'CMS disconnected — invalidate website/SEO consumers.' },
  SocialConnected:     { event: 'SocialConnected', trigger: 'invalidate_integration', seedDomains: ['SOCIAL'], description: 'Social connected — invalidate social consumers.' },
  SocialDisconnected:  { event: 'SocialDisconnected', trigger: 'invalidate_integration', seedDomains: ['SOCIAL'], description: 'Social disconnected — invalidate social consumers.' },
  GAConnected:         { event: 'GAConnected', trigger: 'invalidate_integration', seedDomains: ['SEO', 'COMPANY_INTELLIGENCE'], description: 'GA connected — invalidate analytics-derived consumers.' },
  GSCConnected:        { event: 'GSCConnected', trigger: 'invalidate_integration', seedDomains: ['SEO'], description: 'GSC connected — invalidate SEO consumers.' },
};

export const ORCHESTRATION_SUBSCRIPTIONS: Readonly<Record<string, SubscriptionDefinition>> = SUBSCRIPTIONS_INTERNAL;
export const SUBSCRIBED_EVENTS: ReadonlyArray<string> = Object.keys(SUBSCRIPTIONS_INTERNAL);

/** True when the orchestrator subscribes to this event. */
export function isSubscribed(event: string): boolean {
  return event in SUBSCRIPTIONS_INTERNAL;
}

/** Resolve the subscription (trigger + seed domains) for an event, or null. Pure. */
export function resolveSubscription(event: string): SubscriptionDefinition | null {
  return SUBSCRIPTIONS_INTERNAL[event] ?? null;
}
