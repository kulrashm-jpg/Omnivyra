/**
 * Canonical ingestion pipeline — the ONE layer every source passes through.
 *
 * normalize (adapter) → attribution → identity resolution (port, reuses existing
 * unified-person infra) → assemble canonical lead → emit (sink port). Pure
 * orchestration; all I/O is injected, so the pipeline is fully unit-testable and
 * does not duplicate identity or persistence logic.
 */

import type { CanonicalLead, CanonicalLeadInput, CanonicalIdentityHints, IngestionPorts } from './types';
import { routeToCanonicalInput, type SourceAdapter } from './adapters';
import type { CanonicalLeadSource } from './types';

/** Build the external-keys bag passed to the identity resolver (reused matcher). */
function externalKeysFor(identity: CanonicalIdentityHints): Record<string, unknown> {
  const keys: Record<string, unknown> = { ...(identity.externalKeys ?? {}) };
  if (identity.platform && identity.platformUserId) keys[`${identity.platform}:user`] = identity.platformUserId;
  if (identity.contactId) keys.contact_id = identity.contactId;
  if (identity.anonymousId) keys.anonymous_id = identity.anonymousId;
  if (identity.unifiedPersonId) keys.unified_person_id = identity.unifiedPersonId;
  return keys;
}

function hasResolvableIdentity(identity: CanonicalIdentityHints): boolean {
  return Boolean(
    identity.email || identity.phone || identity.unifiedPersonId ||
    identity.contactId || identity.anonymousId || (identity.platform && identity.platformUserId),
  );
}

/** Ingest one already-adapted canonical input through the pipeline. */
export async function ingestCanonicalLead(input: CanonicalLeadInput, ports: IngestionPorts): Promise<CanonicalLead> {
  if (!input.organizationId) throw new Error('leadIntelligence.ingest: organizationId is required');

  let unifiedPersonId: string | null = input.identity.unifiedPersonId ?? null;
  let identityMatchedBy: string | undefined;

  if (hasResolvableIdentity(input.identity)) {
    const resolved = await ports.identity.resolve({
      organizationId: input.organizationId,
      email: input.identity.email,
      phone: input.identity.phone,
      externalKeys: externalKeysFor(input.identity),
    });
    if (resolved.unifiedPersonId) {
      unifiedPersonId = resolved.unifiedPersonId;
      identityMatchedBy = resolved.matchedBy;
    }
  }

  const now = ports.now ?? (() => new Date().toISOString());
  const lead: CanonicalLead = {
    ...input,
    identity: { ...input.identity, unifiedPersonId },
    unifiedPersonId,
    identityMatchedBy,
    ingestedAt: now(),
  };

  await ports.sink.emit(lead);
  return lead;
}

/** Route a raw source row through its adapter, then ingest. The canonical entry point. */
export async function ingestFromSource(
  source: CanonicalLeadSource,
  row: Record<string, unknown>,
  ports: IngestionPorts,
): Promise<CanonicalLead> {
  return ingestCanonicalLead(routeToCanonicalInput(source, row), ports);
}

export type { SourceAdapter };
