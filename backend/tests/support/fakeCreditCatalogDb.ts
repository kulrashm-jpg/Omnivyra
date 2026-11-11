/**
 * In-memory stand-in for the three catalog tables the credit-cost readers
 * query (credit_cost_config, action_pricing_config, organization_credits).
 * Supports the exact builder chain those readers use: select / eq / lte /
 * order / limit / maybeSingle. `eq` filters really filter, so a reader that
 * asks for the WRONG key gets the wrong row - the defect this protects is
 * exactly "priced by another action's row".
 *
 * Prices are the seeded production values (20261024000001_restore_b1_billing_
 * credit_config.sql), so a test reads "blog_generation costs 60" against the
 * same number a customer sees.
 */
export type Row = Record<string, unknown>;

export const SEEDED_CREDIT_COST_CONFIG: Row[] = [
  // Unregistered actions that used to fall through to website_audit.
  ['blog_generation', 60, 0], ['blog_rewrite_hook', 3, 0], ['blog_brief_suggestions', 1, 0],
  ['content_repurpose', 5, 0], ['content_suggestions', 3, 0], ['quick_platform_adapt', 3, 0],
  ['creator_content', 5, 0], ['chat_theme_refine', 1, 0], ['engagement_refine', 1, 0],
  ['campaign_chat', 1, 0], ['campaign_suggest_update', 1, 0], ['campaign_suggest_duration', 1, 0],
  ['campaign_preplanning', 1, 0], ['skeleton_command', 5, 0], ['async_campaign_planning', 50, 0],
  ['recommendations_generate', 8, 3600], ['recommendations_opportunities', 8, 0],
  ['recommendations_preview_strategy', 1, 0], ['recommendations_group_preview', 1, 0],
  // The row they were wrongly priced by.
  ['website_audit', 50, 86400],
].map(([action_type, credits, smart_dedup_seconds]) => ({ action_type, credits, smart_dedup_seconds }));

export function makeFakeCatalogDb(tables: Record<string, Row[]>) {
  const queried: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain, lte: chain, order: chain, limit: chain,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        queried.push({ table, filters: [...filters] });
        const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return { data: rows[0] ?? null, error: null };
      },
    });
    return builder;
  };
  return { from, queried };
}
