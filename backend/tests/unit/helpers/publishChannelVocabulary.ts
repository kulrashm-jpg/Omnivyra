/**
 * The SQL ⇄ TypeScript agreement on the workflow step channel vocabulary, as a
 * PURE check over (migration file name, SQL text) pairs — so the real contract
 * test and its negative tests run exactly the same code.
 *
 * Hardened 2026-10-28 (social_post review, C21771D4): the earlier inline check
 * extracted channels with matchAll(/'([a-z_]+)'/), which SILENTLY SKIPPED any
 * literal it did not match. An invalid channel in the SQL list ('Social-Post',
 * 'social post', '1abc', 'SOCIAL_POST') was therefore invisible and the test
 * still passed. Here every comma-separated item must be a well-formed literal,
 * and a malformed one is a failure, never ignored. Function definers are also
 * matched case- and whitespace-insensitively (with SQL comments removed), so a
 * later redefinition spelled differently cannot leave the check reading a stale
 * definer.
 */

/** The migration that FIRST defines publish_workflow_version. Never edited. */
export const FIRST_PUBLISH_DEFINER = '20261227000000_pi_workflow_definitions.sql';

/**
 * A channel name: lowercase ASCII words joined by single underscores, starting
 * with a letter. Rejects uppercase, hyphens, spaces, digits-first, empty,
 * leading/trailing/double underscores.
 */
export const CHANNEL_NAME = /^[a-z]+(?:_[a-z]+)*$/;

/** Any (re)definition of the function, however spelled. */
const DEFINER_SRC = String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\s*\.\s*)?"?publish_workflow_version"?\s*\(`;
const definer = (): RegExp => new RegExp(DEFINER_SRC, 'gi');

/** The channel membership test inside the function body. */
const CHANNEL_LIST = /\(\s*s\.value\s*->>\s*'channel'\s*\)\s+NOT\s+IN\s*\(([^)]*)\)/gi;

export const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

export interface MigrationText { readonly name: string; readonly sql: string }

/** Migration names (sorted) that define the function at least once. */
export function publishFunctionDefiners(files: readonly MigrationText[]): string[] {
  return [...files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .filter((f) => definer().test(stripSqlComments(f.sql)))
    .map((f) => f.name);
}

/** The LAST definition in one file: from its CREATE to the dollar quote that closes its body. */
export function lastDefinition(sql: string): string {
  const code = stripSqlComments(sql).replace(/\r/g, '');
  let at = -1;
  for (const m of code.matchAll(definer())) at = m.index ?? at;
  if (at < 0) return '';
  const end = code.indexOf('\n$$;', at);
  return end < 0 ? code.slice(at) : code.slice(at, end);
}

export type ChannelListParse =
  | { ok: true; channels: string[] }
  | { ok: false; problems: string[] };

/** Strictly parse the ONE channel list in a function definition. */
export function parseSqlChannelList(definition: string): ChannelListParse {
  const lists = [...definition.matchAll(CHANNEL_LIST)];
  if (lists.length === 0) return { ok: false, problems: ['no channel list in the definition'] };
  if (lists.length > 1) return { ok: false, problems: [`${lists.length} channel lists in one definition`] };
  const problems: string[] = [];
  const channels: string[] = [];
  for (const raw of lists[0][1].split(',')) {
    const item = raw.trim();
    const lit = /^'([^']*)'$/.exec(item);
    if (!lit) { problems.push(`not a string literal: ${JSON.stringify(item)}`); continue; }
    if (!CHANNEL_NAME.test(lit[1])) { problems.push(`invalid channel name: ${JSON.stringify(lit[1])}`); continue; }
    if (channels.includes(lit[1])) { problems.push(`duplicate channel: ${lit[1]}`); continue; }
    channels.push(lit[1]);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, channels };
}

export type VocabularyCheck =
  | { ok: true; latestDefiner: string; channels: string[] }
  | { ok: false; problems: string[] };

/**
 * The applied vocabulary is the one in the LATEST definer. It must equal the
 * TypeScript vocabulary exactly (as a set, both well-formed, no duplicates) and,
 * when given, the ratified list — an independent pin, so a channel added to BOTH
 * sides still fails until the ratified contract changes too.
 */
export function checkPublishChannelVocabulary(
  files: readonly MigrationText[],
  tsChannels: readonly string[],
  ratified?: readonly string[],
): VocabularyCheck {
  const problems: string[] = [];
  const definers = publishFunctionDefiners(files);
  if (definers.length === 0) return { ok: false, problems: ['no migration defines publish_workflow_version'] };
  if (definers[0] !== FIRST_PUBLISH_DEFINER) problems.push(`first definer is ${definers[0]}, expected ${FIRST_PUBLISH_DEFINER}`);

  // Every definer — not only the latest — must carry a well-formed list, so a
  // replacement that drops the vocabulary is caught wherever it sits.
  let latest: string[] = [];
  for (const name of definers) {
    const sql = (files.find((f) => f.name === name) as MigrationText).sql;
    const parsed = parseSqlChannelList(lastDefinition(sql));
    if (parsed.ok === false) { problems.push(...parsed.problems.map((p) => `${name}: ${p}`)); continue; }
    if (name === definers[definers.length - 1]) latest = parsed.channels;
  }

  for (const c of tsChannels) if (!CHANNEL_NAME.test(c)) problems.push(`invalid TypeScript channel name: ${JSON.stringify(c)}`);
  if (new Set(tsChannels).size !== tsChannels.length) problems.push('duplicate TypeScript channel');

  const sqlSet = new Set(latest);
  const tsSet = new Set(tsChannels);
  for (const c of tsSet) if (!sqlSet.has(c)) problems.push(`in TypeScript, not in SQL: ${c}`);
  for (const c of sqlSet) if (!tsSet.has(c)) problems.push(`in SQL, not in TypeScript: ${c}`);
  if (ratified) {
    const r = new Set(ratified);
    for (const c of tsSet) if (!r.has(c)) problems.push(`not ratified: ${c}`);
    for (const c of r) if (!tsSet.has(c)) problems.push(`ratified but absent: ${c}`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, latestDefiner: definers[definers.length - 1], channels: [...latest].sort() };
}
