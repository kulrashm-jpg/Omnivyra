import { ownedDbTable } from '../db/writeOwner';

export type AuditSeverity = 'info' | 'warning' | 'critical';
export type AuditActorType = 'user' | 'system' | 'plugin' | 'worker';

export async function recordAuditEvent(input: {
  companyId?: string | null;
  websiteId?: string | null;
  actorUserId?: string | null;
  actorType?: AuditActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const { error } = await ownedDbTable('audit_events').insert({
    company_id: input.companyId ?? null,
    website_id: input.websiteId ?? null,
    actor_user_id: input.actorUserId ?? null,
    actor_type: input.actorType ?? 'system',
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    severity: input.severity ?? 'info',
    metadata: input.metadata ?? {},
    ip_hash: input.ipHash ?? null,
    user_agent: input.userAgent ?? null,
  });

  if (error) {
    console.warn('audit_event_write_failed', {
      action: input.action,
      resourceType: input.resourceType,
      message: error.message,
    });
  }
}

export async function recordCredentialAccessAudit(input: {
  companyId?: string | null;
  websiteId?: string | null;
  connectionId?: string | null;
  actorType?: AuditActorType;
  purpose: string;
}): Promise<void> {
  await recordAuditEvent({
    companyId: input.companyId,
    websiteId: input.websiteId,
    actorType: input.actorType ?? 'system',
    action: 'credential.access',
    resourceType: 'website_connection',
    resourceId: input.connectionId ?? null,
    severity: 'warning',
    metadata: { purpose: input.purpose },
  });
}
