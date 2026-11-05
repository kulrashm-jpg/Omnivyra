/**
 * Test shim: suites written against the removed global policy
 * (getCommunityAiPlatformPolicy → { execution_enabled, auto_rules_enabled, ... })
 * describe the same knobs as the Prompt 3 TENANT decision
 * (getCommunityExecutionPolicy → { ok, policy | code }). This maps one onto the
 * other so those suites keep their scenarios. It never opens anything the old
 * knobs did not: execution_enabled !== true refuses (PLATFORM_KILL_SWITCH), an
 * absent policy is POLICY_MISSING, and auto rules are on only when exactly true.
 */
export type LegacyPolicy = { execution_enabled?: unknown; auto_rules_enabled?: unknown } | null | undefined;

export async function asExecutionDecision(legacy: LegacyPolicy | Promise<LegacyPolicy>) {
  const p = await legacy;
  if (!p) return { ok: false as const, code: 'POLICY_MISSING' };
  if (p.execution_enabled !== true) return { ok: false as const, code: 'PLATFORM_KILL_SWITCH' };
  return { ok: true as const, policy: { execution_enabled: true as const, auto_rules_enabled: p.auto_rules_enabled === true }, version: 'test' };
}
