const scenarios = [
  {
    name: 'provider_downtime',
    expected: ['publish job transitions to retrying', 'failure_category=provider', 'queue lag alert opens after threshold'],
  },
  {
    name: 'wordpress_auth_expiration',
    expected: ['adapter returns auth failure', 'connection health becomes reauth_required', 'plugin diagnostics recommends reconnect'],
  },
  {
    name: 'worker_crash',
    expected: ['lock_expires_at passes', 'stale recovery returns job to retrying', 'worker stale alert opens'],
  },
  {
    name: 'duplicate_events',
    expected: ['tracking dedupe key prevents duplicate persistence', 'plugin event nonce/idempotency prevents replay duplication'],
  },
  {
    name: 'reconciliation_drift',
    expected: ['publish_integrity_status becomes externally_modified or missing', 'reconciliation drift alert opens'],
  },
  {
    name: 'webhook_replay_attack',
    expected: ['expired timestamp rejected', 'critical audit event recorded'],
  },
];

console.log(JSON.stringify({
  ok: true,
  mode: 'checklist',
  scenarios,
  note: 'Use this checklist with a staging tenant or fault-injection proxy. It is deterministic and intentionally avoids production mutation by default.',
}, null, 2));

export {};
