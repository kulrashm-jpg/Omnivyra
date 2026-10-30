/**
 * Prospect aliases — the persisted record that one canonical prospect was
 * ABSORBED into another (closure-B, identity reconciliation).
 *
 * WHY. Community evidence can create a person-less, handle-anchored prospect P1
 * before the author's identity is verified; PI discovery can create P2 for the
 * verified person. Once a verified identity proves P1 and P2 are the same
 * human, the tenant must see ONE canonical prospect. Nothing is deleted or
 * rewritten: the contribution ledger stays append-only, P1 keeps every row it
 * owns, and a row in `public.prospect_aliases` says "P1 → P2". Readers resolve
 * an alias onto its survivor (the terminal of the alias graph).
 *
 * INVARIANTS (enforced by the database — 20270109000001 — and re-checked here):
 *   - tenant-scoped: alias and survivor are leads of the SAME tenant (composite
 *     FKs to canonical_leads(id, company_id)); a resolver never follows a row of
 *     another tenant;
 *   - no self-alias; at most one survivor per alias;
 *   - flat: a survivor is never itself an alias, and an alias never has aliases
 *     of its own, so an alias points at the terminal survivor directly.
 *
 * This module is PURE (no I/O). The store is
 * `backend/services/prospectProvenance/prospectAliasStore.ts`.
 */

/** Database names (contract — the store recognises violations by name). */
export const PROSPECT_ALIAS_DB = Object.freeze({
  table: 'prospect_aliases',
  uniqueAlias: 'uq_prospect_alias_org_alias',
  notSelf: 'pa_not_self',
  survivorIsTerminal: 'pa_survivor_is_terminal',
  aliasHasNoAliases: 'pa_alias_has_no_aliases',
});

/** Why an alias was recorded. One value today; a CHECK in the migration. */
export const PROSPECT_ALIAS_REASONS = ['verified_identity'] as const;
export type ProspectAliasReason = (typeof PROSPECT_ALIAS_REASONS)[number];

export interface ProspectAlias {
  organizationId: string;
  aliasLeadId: string;
  survivorLeadId: string;
  reason?: string;
  createdAt?: string | null;
}

/** Longest chain a resolver follows. The DB keeps chains at length 1; this bounds a corrupt graph. */
export const MAX_ALIAS_DEPTH = 8;

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Index the aliases of ONE tenant: alias id → survivor id. Rows of any other
 * tenant, self-aliases and blank ids are dropped (never followed). When the same
 * alias appears twice with different survivors (impossible under the unique
 * constraint) the alias is treated as unresolvable and dropped, never guessed.
 */
export function aliasIndexOf(organizationId: string, aliases: readonly ProspectAlias[]): Map<string, string> {
  const out = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const a of aliases) {
    if (!a || a.organizationId !== organizationId) continue;
    const from = norm(a.aliasLeadId);
    const to = norm(a.survivorLeadId);
    if (!from || !to || from === to) continue;
    const prev = out.get(from);
    if (prev !== undefined && prev !== to) { conflicted.add(from); continue; }
    out.set(from, to);
  }
  for (const k of conflicted) out.delete(k);
  return out;
}

/**
 * The terminal survivor of `leadId` (itself when it is not an alias). Follows
 * at most MAX_ALIAS_DEPTH hops; a cycle or an over-long chain resolves to
 * `leadId` itself (the lead stays its own lead — never merged on a broken graph).
 */
export function terminalSurvivorOf(index: ReadonlyMap<string, string>, leadId: string): string {
  const start = norm(leadId);
  let cur = start;
  const seen = new Set<string>([cur]);
  for (let i = 0; i < MAX_ALIAS_DEPTH; i++) {
    const next = index.get(cur);
    if (next === undefined) return cur;
    if (seen.has(next)) return start; // cycle
    seen.add(next);
    cur = next;
  }
  return index.has(cur) ? start : cur;
}

/** Every lead whose terminal survivor is `survivorId` (excluding the survivor), sorted. */
export function absorbedInto(index: ReadonlyMap<string, string>, survivorId: string): string[] {
  const s = norm(survivorId);
  const out: string[] = [];
  for (const k of index.keys()) if (k !== s && terminalSurvivorOf(index, k) === s) out.push(k);
  return out.sort();
}
