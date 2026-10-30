#!/usr/bin/env node
/**
 * Semantic comparison of two catalog fingerprints produced by
 * scripts/release/catalog-fingerprint.sql (e.g. a disposable "expected"
 * database on the left, production on the right).
 *
 *   node scripts/release/semantic-compare-catalog.js <left.tsv> <right.tsv> [--json]
 *        [--owner-map expectedOwner=prodOwner ...]
 *        [--role-map from=to ...] [--role-map-left from=to ...] [--role-map-right from=to ...]
 *        [--accept-eol-only] [--invariants <file> [--invariants-side right|left|both]]
 *   node scripts/release/semantic-compare-catalog.js --invariants <file> <one.tsv> [--json]
 *        (invariants-only mode: no comparison; the invariants are evaluated on <one.tsv>)
 *
 * Every fact is a line "section TAB object TAB property TAB value". Differences
 * are classified as:
 *   semantic — privileges, RLS flags, policies, function bodies/security, view
 *              definitions, OWNERS, constraints, indexes, triggers, default
 *              privileges of postgres/supabase_admin in public or globally,
 *              publication membership of in-scope tables, existence.
 *   noise    — expected environment differences: ACL "is default"
 *              representation, physical column order, server version, an owner
 *              pair declared equivalent with --owner-map, and MAINTAIN on the
 *              owner's own ACL entry when one side is PostgreSQL < 17.
 *   info     — migration-ledger rows, candidate scope, default privileges of
 *              other (platform-managed) roles/schemas, publication flags and
 *              membership of out-of-scope tables (reported, not judged).
 *   eol_only — a function's raw def_md5 differs but def_md5_lf (the definition
 *              with every CRLF pair replaced by LF; a lone CR is kept) is equal
 *              on both sides: the bodies differ ONLY in CRLF-vs-LF line endings
 *              (SQL Editor submissions keep CR bytes in prosrc). BLOCKING by
 *              default, because a CRLF inside a string literal of the body is
 *              part of a runtime value (RAISE text, dynamic SQL, returned text);
 *              --accept-eol-only makes it non-blocking, and it is still listed
 *              and WARNed. Never applied to views or policies: those are
 *              deparsed (CR-free), so any CR they contain sits inside a literal
 *              and is a value difference (semantic).
 *   review   — BLOCKING like semantic, with a named hazard: N3, FIX3 STEP 7's
 *              CREATE-vs-adopt branch for the updated_at executor (one side has
 *              an executor function the other lacks, or the content_block
 *              trigger executes the other executor). A CREATE adds a real
 *              function that PUBLIC (hence anon/authenticated) can EXECUTE by
 *              default; the reason names the EXECUTE holders on that side.
 *
 * Invariants (--invariants <file>) are ABSOLUTE checks on one side (default
 * right = production), evaluated independently of the comparison, so an
 * exposure present on BOTH sides still fails. File lines (TAB-separated,
 * '#' comments): kind section object property value
 *   kind  : absent — FAIL if any fact matches key and value;
 *           expect — FAIL unless at least one fact matches the key AND every
 *           key match has a matching value
 *   section/object/property: exact, '*' is a wildcard
 *   value : '*' any, '~<regex>' JS regex (unanchored), else exact (escapes \n \r \t \\)
 * An absent rule whose key pattern matches no fact at all is WARNed (vacuous).
 * Invariant failures make the exit code 1. Role/ACL assertions on the live
 * catalog belong to grants-acl-check.sql (P10); these invariants read only
 * fingerprint facts (after any role map).
 *
 * Owner changes are SEMANTIC: an owner holds every privilege, bypasses
 * non-forced RLS, and is the run-as identity of SECURITY DEFINER functions and
 * owner-rights views. The only way to accept an owner difference is to declare
 * the pair with --owner-map (reported as noise "declared owner equivalence").
 *
 * Role maps rename a role ONLY in role positions (grantee:<r>, role:<r>,
 * col:<c>:grantee:<r>, and the role of defacl:<r>:<schema>:<type>), never in
 * values, policy/column/schema names. API roles (anon, authenticated,
 * service_role, PUBLIC/public) and <owner> can never be mapped. A map whose
 * target already appears in a role position on the same side is refused, and
 * so are two roles mapped onto the same target on one side (either would merge
 * two distinct roles). Every rewrite is listed in the result (`mapped`) and
 * announced with a WARNING line; a map entry that rewrote nothing is WARNed too.
 *
 * Exit: 0 = no semantic or review difference, no unaccepted eol_only, and every
 *       invariant holds; 1 = otherwise; 2 = bad input.
 * Semantic equality is NOT byte identity of the SQL that was applied.
 *
 * Reads two local files only; never connects to a database.
 */
'use strict';

const fs = require('fs');

const FORMAT = 'catalog-fingerprint/3';
const NOISE_PROPERTIES = new Set(['acl_is_default', 'column_order']);
const INFO_SECTIONS = new Set(['ledger', 'scope']);
const ACL_SECTIONS = new Set(['acl', 'fnacl', 'defacl', 'colacl']);
const UNMAPPABLE_ROLES = new Set(['anon', 'authenticated', 'service_role', 'PUBLIC', 'public', '<owner>']);
const MANAGED_DEFACL_ROLES = new Set(['postgres', 'supabase_admin']);
const MANAGED_DEFACL_SCHEMAS = new Set(['public', '*']);
// raw-hash property -> CRLF-normalized companion (functions only; see eol_only)
const EOL_COMPANIONS = new Map([['def_md5', 'def_md5_lf']]);
const N3_SCOPE = 'fix3:updated_at_executor';
const N3_TRIGGER = { section: 'trg', object: 'rel:public.content_block', property: 'trg:content_block_set_updated_at' };
const CLASSES = ['semantic', 'review', 'eol_only', 'noise', 'info'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeValue(v) {
  return v.replace(/\\(\\|n|r|t)/g, (_, c) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' }[c]));
}

/**
 * Role positions of a fact: returns { object, property } with every role
 * token passed through fn(role, where). Only these positions carry role names.
 */
function mapRolePositions(section, object, property, fn) {
  let obj = object;
  let prop = property;
  let m = /^(defacl:)([^:]+)(:.*)$/.exec(obj);
  if (section === 'defacl' && m && m[2] !== 'all') obj = m[1] + fn(m[2], 'object') + m[3];
  m = /^(grantee:|role:)(.+)$/.exec(prop);
  if (m) prop = m[1] + fn(m[2], 'property');
  else {
    m = /^(col:.+:grantee:)([^:]+)$/.exec(prop);
    if (m) prop = m[1] + fn(m[2], 'property');
  }
  return { object: obj, property: prop };
}

function rolesInPositions(rows) {
  const roles = new Set();
  for (const r of rows) {
    mapRolePositions(r.section, r.object, r.property, (role) => { roles.add(role); return role; });
  }
  return roles;
}

/** Parse fingerprint text into a Map key -> {section, object, property, value}. */
function parseFingerprint(text, { roleMap, label = 'input', side, mapped } = {}) {
  const rows = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (line === '') return;
    const parts = line.split('\t');
    if (parts.length !== 4) {
      throw new Error(`${label}:${i + 1}: expected 4 TAB-separated fields, got ${parts.length}`);
    }
    const [section, object, property, value0] = parts;
    rows.push({ section, object, property, value: unescapeValue(value0), line: i + 1 });
  });

  if (roleMap && roleMap.size > 0) {
    const present = rolesInPositions(rows);
    for (const [from, to] of roleMap) {
      if (present.has(to)) {
        throw new Error(`${label}: role map ${from}=${to} refused: ${to} already appears as a role on this side `
          + '(the map could merge two distinct roles; use --role-map-left / --role-map-right to map one side only)');
      }
    }
  }

  const facts = new Map();
  for (const r of rows) {
    let { object, property } = r;
    if (roleMap && roleMap.size > 0) {
      ({ object, property } = mapRolePositions(r.section, r.object, r.property, (role) => {
        if (!roleMap.has(role)) return role;
        const to = roleMap.get(role);
        if (mapped) {
          mapped.push({ side, section: r.section, object: r.object, property: r.property, from: role, to });
        }
        return to;
      }));
    }
    const key = `${r.section}\t${object}\t${property}`;
    if (facts.has(key)) throw new Error(`${label}:${r.line}: duplicate fact ${key.replace(/\t/g, ' | ')}`);
    facts.set(key, { section: r.section, object, property, value: r.value });
  }
  const fmt = facts.get('meta\tsession\tfingerprint_format');
  if (!fmt) throw new Error(`${label}: missing meta fingerprint_format (not a catalog fingerprint?)`);
  if (fmt.value !== FORMAT) {
    throw new Error(`${label}: unsupported fingerprint format ${fmt.value} (expected ${FORMAT}; regenerate both sides with the current catalog-fingerprint.sql)`);
  }
  return facts;
}

function withoutMaintain(aclValue) {
  return aclValue.split(',').filter((p) => p !== 'MAINTAIN' && p !== 'MAINTAIN*').join(',');
}

function effWithoutFalseMaintain(effValue) {
  return effValue.split(',').filter((p) => p !== 'MAINTAIN=f').join(',');
}

function isOwnerGrantee(property) {
  return /(^|:)grantee:<owner>$/.test(property);
}

/**
 * Classify one difference. left/right are fact values or undefined.
 * ctx: { ownerMap: Map, versionsStraddle17: boolean }
 */
function classify(section, object, property, left, right, ctx = {}) {
  if (section === 'meta') return { cls: 'noise', reason: 'session/environment' };
  if (INFO_SECTIONS.has(section)) return { cls: 'info', reason: `${section} is reported, not judged` };
  if (NOISE_PROPERTIES.has(property)) return { cls: 'noise', reason: `${property} is environment-specific` };

  const n3 = n3Review(section, object, property, left, right, ctx);
  if (n3) return n3;

  if (section === 'fn' && EOL_COMPANIONS.has(property) && left !== undefined && right !== undefined
      && ctx.leftFacts && ctx.rightFacts) {
    const companion = EOL_COMPANIONS.get(property);
    const k = `${section}\t${object}\t${companion}`;
    const l = ctx.leftFacts.get(k);
    const r = ctx.rightFacts.get(k);
    if (l && r && l.value === r.value) {
      return {
        cls: 'eol_only',
        reason: `${property} differs only in CRLF-vs-LF line endings (${companion} equal); a CRLF inside a string literal of the body is a runtime value — review before accepting`,
      };
    }
  }

  if (property === 'owner') {
    if (left !== undefined && right !== undefined && ctx.ownerMap && ctx.ownerMap.get(left) === right) {
      return { cls: 'noise', reason: `declared owner equivalence (--owner-map ${left}=${right})` };
    }
    return {
      cls: 'semantic',
      reason: 'owner changed (owner holds all privileges, bypasses non-forced RLS, is the run-as identity of SECURITY DEFINER functions and owner-rights views)',
    };
  }

  if (section === 'defacl') {
    if (object === 'defacl:all') return { cls: 'info', reason: 'total default-ACL row count includes platform-managed rows' };
    const m = /^defacl:([^:]+):([^:]+):/.exec(object);
    if (!m || !MANAGED_DEFACL_ROLES.has(m[1]) || !MANAGED_DEFACL_SCHEMAS.has(m[2])) {
      return { cls: 'info', reason: 'default privileges of a platform-managed role/schema (not postgres/supabase_admin in public or global)' };
    }
  }

  if (section === 'pub') {
    if (property === 'flags') return { cls: 'info', reason: 'publication flags are reported; membership of in-scope tables is judged' };
    const inScope = [left, right].some((v) => v !== undefined && !/\|scope=out_of_scope$/.test(v));
    if (!inScope) return { cls: 'info', reason: 'publication membership of an out-of-scope table' };
    return { cls: 'semantic', reason: 'publication membership of an in-scope table (Realtime can deliver its rows)' };
  }

  // MAINTAIN exists only on PostgreSQL 17+. It is noise ONLY when the two sides
  // straddle version 17 AND it concerns the owner's own entry (or an eff row
  // where the only difference is an absent-vs-false MAINTAIN).
  if (ctx.versionsStraddle17) {
    if (ACL_SECTIONS.has(section) && isOwnerGrantee(property) && left !== undefined && right !== undefined
        && withoutMaintain(left) === withoutMaintain(right)) {
      return { cls: 'noise', reason: 'owner MAINTAIN: one side is PostgreSQL < 17' };
    }
    if (section === 'eff' && left !== undefined && right !== undefined
        && effWithoutFalseMaintain(left) === effWithoutFalseMaintain(right)) {
      return { cls: 'noise', reason: 'MAINTAIN=f on the PostgreSQL 17 side only' };
    }
  }
  return { cls: 'semantic', reason: '' };
}

function inScope(ctx, object, cand) {
  const v = ctx.scope && ctx.scope.get(object);
  return Boolean(v) && v.split(',').includes(cand);
}

function executeHolders(facts, object) {
  if (!facts) return [];
  return ['anon', 'authenticated', 'public'].filter((r) => {
    const f = facts.get(`eff\t${object}\trole:${r}`);
    return f && f.value === 'EXECUTE=t';
  });
}

/**
 * N3 (FIX3 STEP 7 CREATE-vs-adopt). Returns a review classification or null.
 * Only the existence branch is review; a body/ACL/owner difference of an
 * executor that exists on BOTH sides stays semantic.
 */
function n3Review(section, object, property, left, right, ctx) {
  if (['fn', 'fnacl', 'eff'].includes(section) && object.startsWith('fn:') && inScope(ctx, object, N3_SCOPE)) {
    const ex = (facts) => {
      const f = facts && facts.get(`fn\t${object}\texists`);
      return f ? f.value : undefined;
    };
    const el = ex(ctx.leftFacts);
    const er = ex(ctx.rightFacts);
    if (el === er) return null;
    const side = el === 'true' ? 'left' : er === 'true' ? 'right' : null;
    const holders = side ? executeHolders(side === 'left' ? ctx.leftFacts : ctx.rightFacts, object) : [];
    return {
      cls: 'review',
      reason: `N3 FIX3 STEP 7 CREATE-vs-adopt: ${object.slice(3)} exists only on the ${side || 'unknown'} side; a CREATE adds a real function`
        + (holders.length
          ? ` — EXECUTABLE by ${holders.join(', ')} on the ${side} side`
          : ' — no anon/authenticated/public EXECUTE recorded on that side'),
    };
  }
  if (section === N3_TRIGGER.section && object === N3_TRIGGER.object && property === N3_TRIGGER.property
      && left !== undefined && right !== undefined && ctx.scope) {
    const names = [...ctx.scope]
      .filter(([o, v]) => o.startsWith('fn:') && v.split(',').includes(N3_SCOPE))
      .map(([o]) => o.slice(3).replace(/^public\./, '').replace(/\(\)$/, ''));
    if (names.length) {
      const re = new RegExp(`\\b(?:public\\.)?(?:${names.map(escapeRegExp).join('|')})\\(\\)`, 'g');
      if (left.replace(re, '<executor>()') === right.replace(re, '<executor>()')) {
        return { cls: 'review', reason: 'N3 FIX3 STEP 7 CREATE-vs-adopt: content_block_set_updated_at executes a different updated_at executor' };
      }
    }
  }
  return null;
}

function serverMajor(facts) {
  const v = facts.get('meta\tsession\tserver_version_num');
  return v ? Math.floor(Number(v.value) / 10000) : null;
}

function compareFingerprints(leftText, rightText, opts = {}) {
  const mapped = [];
  const both = opts.roleMap || new Map();
  const leftMap = new Map([...both, ...(opts.roleMapLeft || new Map())]);
  const rightMap = new Map([...both, ...(opts.roleMapRight || new Map())]);
  for (const [from, to] of [...leftMap, ...rightMap]) {
    if (UNMAPPABLE_ROLES.has(from) || UNMAPPABLE_ROLES.has(to)) {
      throw new Error(`role map ${from}=${to} refused: API roles, PUBLIC and <owner> can never be mapped`);
    }
    if (from === to) throw new Error(`role map ${from}=${to} is a no-op`);
  }
  // Two roles mapped onto the same target would merge them into one.
  for (const [side, m] of [['left', leftMap], ['right', rightMap]]) {
    const seen = new Map();
    for (const [from, to] of m) {
      if (seen.has(to)) {
        throw new Error(`role map refused (${side}): ${seen.get(to)} and ${from} both map to ${to} (would merge two distinct roles)`);
      }
      seen.set(to, from);
    }
  }
  for (const [from, to] of opts.ownerMap || new Map()) {
    if (UNMAPPABLE_ROLES.has(from) || UNMAPPABLE_ROLES.has(to)) {
      throw new Error(`owner map ${from}=${to} refused: API roles and PUBLIC cannot be declared owner-equivalent`);
    }
  }

  const left = parseFingerprint(leftText, { roleMap: leftMap, label: opts.leftLabel || 'left', side: 'left', mapped });
  const right = parseFingerprint(rightText, { roleMap: rightMap, label: opts.rightLabel || 'right', side: 'right', mapped });

  const lMajor = serverMajor(left);
  const rMajor = serverMajor(right);
  const scope = new Map();
  for (const facts of [left, right]) {
    for (const f of facts.values()) {
      if (f.section === 'scope' && f.property === 'candidates') scope.set(f.object, f.value);
    }
  }
  const ctx = {
    ownerMap: opts.ownerMap || new Map(),
    versionsStraddle17: lMajor !== null && rMajor !== null && (lMajor >= 17) !== (rMajor >= 17),
    leftFacts: left,
    rightFacts: right,
    scope,
  };

  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const out = { semantic: [], review: [], eol_only: [], noise: [], info: [], warnings: [], mapped, invariants: [] };
  for (const key of keys) {
    const l = left.get(key);
    const r = right.get(key);
    if (l && r && l.value === r.value) continue;
    const f = l || r;
    const { cls, reason } = classify(f.section, f.object, f.property, l && l.value, r && r.value, ctx);
    out[cls].push({
      section: f.section,
      object: f.object,
      property: f.property,
      kind: !l ? 'only_right' : !r ? 'only_left' : 'changed',
      left: l ? l.value : null,
      right: r ? r.value : null,
      candidates: scope.get(f.object) || (f.section === 'global' || f.section === 'defacl' ? 'close_anon' : ''),
      reason,
    });
  }

  for (const [name, facts] of [['left', left], ['right', right]]) {
    const ro = facts.get('meta\tsession\ttransaction_read_only');
    if (!ro || ro.value !== 'on') out.warnings.push(`${name}: fingerprint was not taken in a read-only transaction`);
  }
  const scopeDiff = out.info.filter((d) => d.section === 'scope');
  if (scopeDiff.length) out.warnings.push(`candidate scope differs (${scopeDiff.length}); fingerprints were made from different SQL versions`);
  if (mapped.length) {
    const groups = new Map();
    for (const x of mapped) {
      const k = `${x.side}: ${x.from} -> ${x.to}`;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    for (const [k, n] of groups) {
      out.warnings.push(`role map applied (${k}) to ${n} fact(s); the result treats these as the same role — justify every mapping`);
    }
  }
  // A map entry that rewrote nothing is almost always a typo; never let it pass silently.
  for (const [side, m] of [['left', leftMap], ['right', rightMap]]) {
    for (const [from, to] of m) {
      if (!mapped.some((x) => x.side === side && x.from === from)) {
        out.warnings.push(`role map ${from}=${to} (${side}) rewrote nothing; check the role name`);
      }
    }
  }
  for (const [from, to] of ctx.ownerMap) {
    out.warnings.push(`owner equivalence declared: ${from} (left) = ${to} (right); owner differences for this pair are classed as noise`);
  }
  if (ctx.versionsStraddle17) out.warnings.push(`server major versions differ across 17 (left ${lMajor}, right ${rMajor}); owner-only MAINTAIN differences are noise`);

  if (out.eol_only.length) {
    out.warnings.push(opts.acceptEolOnly
      ? `eol_only differences (${out.eol_only.length}) ACCEPTED by --accept-eol-only; each body must still be reviewed for CRLF inside string literals`
      : `eol_only differences (${out.eol_only.length}) are blocking; review each body, then re-run with --accept-eol-only to accept them explicitly`);
  }
  if (out.review.length) out.warnings.push(`review items (${out.review.length}) are blocking until the owner accepts each in writing`);

  if (opts.invariants && opts.invariants.length) {
    const sides = opts.invariantsSide === 'both' ? ['left', 'right'] : [opts.invariantsSide || 'right'];
    for (const side of sides) {
      const r = evaluateInvariants(side === 'left' ? left : right, opts.invariants, side);
      out.invariants.push(...r.results);
      out.warnings.push(...r.warnings);
    }
  }

  out.equal = out.semantic.length === 0 && out.review.length === 0
    && (out.eol_only.length === 0 || Boolean(opts.acceptEolOnly));
  out.invariants_ok = out.invariants.every((x) => x.status === 'pass');
  out.pass = out.equal && out.invariants_ok;
  out.counts = {
    left_facts: left.size,
    right_facts: right.size,
    semantic: out.semantic.length,
    review: out.review.length,
    eol_only: out.eol_only.length,
    noise: out.noise.length,
    info: out.info.length,
    mapped: mapped.length,
    invariant_failures: out.invariants.filter((x) => x.status === 'fail').length,
  };
  return out;
}

function globToRegExp(p) {
  return new RegExp(`^${p.split('*').map(escapeRegExp).join('.*')}$`);
}

/** Parse an invariants file (TAB-separated: kind section object property value). */
function parseInvariants(text, label = 'invariants') {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const parts = line.split('\t');
    if (parts.length !== 5) {
      throw new Error(`${label}:${i + 1}: expected 5 TAB-separated fields (kind section object property value), got ${parts.length}`);
    }
    const [kind, section, object, property, value] = parts;
    if (kind !== 'absent' && kind !== 'expect') throw new Error(`${label}:${i + 1}: kind must be absent or expect, got ${kind}`);
    let valueTest;
    if (value === '*') valueTest = () => true;
    else if (value.startsWith('~')) {
      let re;
      try {
        re = new RegExp(value.slice(1));
      } catch (e) {
        throw new Error(`${label}:${i + 1}: bad regex: ${e.message}`);
      }
      valueTest = (v) => re.test(v);
    } else {
      const exact = unescapeValue(value);
      valueTest = (v) => v === exact;
    }
    out.push({
      kind,
      text: line.replace(/\t/g, ' '),
      section: globToRegExp(section),
      object: globToRegExp(object),
      property: globToRegExp(property),
      valueTest,
    });
  });
  if (out.length === 0) throw new Error(`${label}: no invariants (an empty file proves nothing)`);
  return out;
}

/** Evaluate absolute invariants on ONE side's facts (a Map from parseFingerprint). */
function evaluateInvariants(facts, invariants, side) {
  const results = [];
  const warnings = [];
  for (const inv of invariants) {
    const keyMatches = [...facts.values()].filter((f) => inv.section.test(f.section)
      && inv.object.test(f.object) && inv.property.test(f.property));
    let offending;
    let status;
    if (inv.kind === 'absent') {
      offending = keyMatches.filter((f) => inv.valueTest(f.value));
      status = offending.length === 0 ? 'pass' : 'fail';
      if (keyMatches.length === 0) warnings.push(`invariant (${side}) "${inv.text}" matched no fact at all (vacuous pass; check the pattern)`);
    } else {
      offending = keyMatches.filter((f) => !inv.valueTest(f.value));
      status = keyMatches.length > 0 && offending.length === 0 ? 'pass' : 'fail';
    }
    results.push({
      side,
      kind: inv.kind,
      rule: inv.text,
      status,
      key_matches: keyMatches.length,
      offending: offending.map((f) => ({ section: f.section, object: f.object, property: f.property, value: f.value })),
    });
  }
  return { results, warnings };
}

/** Invariants-only mode: evaluate on one fingerprint, no comparison. */
function checkInvariants(text, invariants, { label = 'input' } = {}) {
  const facts = parseFingerprint(text, { label });
  const { results, warnings } = evaluateInvariants(facts, invariants, label);
  const invariantsOk = results.every((x) => x.status === 'pass');
  return {
    invariants: results,
    warnings,
    invariants_ok: invariantsOk,
    pass: invariantsOk,
    counts: { facts: facts.size, invariant_failures: results.filter((x) => x.status === 'fail').length },
  };
}

function fmtValue(v) {
  if (v === null) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

function renderText(res, leftName, rightName) {
  const lines = [];
  lines.push(`left : ${leftName} (${res.counts.left_facts} facts)`);
  lines.push(`right: ${rightName} (${res.counts.right_facts} facts)`);
  lines.push(`semantic=${res.counts.semantic} review=${res.counts.review} eol_only=${res.counts.eol_only} `
    + `noise=${res.counts.noise} info=${res.counts.info} mapped=${res.counts.mapped} invariant_failures=${res.counts.invariant_failures}`);
  for (const w of res.warnings) lines.push(`WARNING: ${w}`);
  for (const cls of CLASSES) {
    if (!res[cls].length) continue;
    lines.push('', `== ${cls.toUpperCase()} ==`);
    for (const d of res[cls]) {
      lines.push(`[${d.candidates || '-'}] ${d.section} ${d.object} ${d.property} (${d.kind})${d.reason ? ` — ${d.reason}` : ''}`);
      lines.push(`    left : ${fmtValue(d.left)}`);
      lines.push(`    right: ${fmtValue(d.right)}`);
    }
  }
  if (res.mapped.length) {
    lines.push('', '== ROLE-MAP REWRITES ==');
    for (const x of res.mapped) lines.push(`${x.side}: ${x.section} ${x.object} ${x.property}: ${x.from} -> ${x.to}`);
  }
  renderInvariants(res, lines);
  lines.push('', res.equal ? 'RESULT: SEMANTICALLY EQUAL (not a proof of byte-identical applied SQL)' : 'RESULT: SEMANTIC DIFFERENCES FOUND');
  if (res.invariants.length) lines.push(res.invariants_ok ? 'INVARIANTS: ALL HOLD' : 'INVARIANTS: VIOLATED');
  return lines.join('\n') + '\n';
}

function renderInvariants(res, lines) {
  if (!res.invariants.length) return;
  lines.push('', '== INVARIANTS ==');
  for (const x of res.invariants) {
    lines.push(`${x.status.toUpperCase()} [${x.side}] ${x.rule} (key matches: ${x.key_matches})`);
    for (const o of x.offending) lines.push(`    ${o.section} ${o.object} ${o.property} = ${fmtValue(o.value)}`);
  }
}

function renderInvariantsOnly(res, name) {
  const lines = [`input: ${name} (${res.counts.facts} facts)`, `invariant_failures=${res.counts.invariant_failures}`];
  for (const w of res.warnings) lines.push(`WARNING: ${w}`);
  renderInvariants(res, lines);
  lines.push('', res.invariants_ok ? 'INVARIANTS: ALL HOLD' : 'INVARIANTS: VIOLATED');
  return lines.join('\n') + '\n';
}

function parsePair(opt, v) {
  const m = /^([^=:\s]+)=([^=:\s]+)$/.exec(v || '');
  if (!m) throw new Error(`${opt} expects from=to`);
  return [m[1], m[2]];
}

function parseArgs(argv) {
  const files = [];
  const maps = { '--role-map': new Map(), '--role-map-left': new Map(), '--role-map-right': new Map(), '--owner-map': new Map() };
  let json = false;
  let acceptEolOnly = false;
  let invariantsFile = null;
  let invariantsSide = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--accept-eol-only') acceptEolOnly = true;
    else if (a === '--invariants') {
      if (!argv[i + 1] || invariantsFile) throw new Error('--invariants expects exactly one file');
      invariantsFile = argv[i + 1];
      i += 1;
    } else if (a === '--invariants-side') {
      if (!['left', 'right', 'both'].includes(argv[i + 1])) throw new Error('--invariants-side expects left, right or both');
      invariantsSide = argv[i + 1];
      i += 1;
    }
    else if (Object.prototype.hasOwnProperty.call(maps, a)) {
      const [from, to] = parsePair(a, argv[i + 1]);
      if (maps[a].has(from)) throw new Error(`${a} ${from} given twice`);
      maps[a].set(from, to);
      i += 1;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else files.push(a);
  }
  if (invariantsSide && !invariantsFile) throw new Error('--invariants-side requires --invariants');
  const oneFileOk = files.length === 1 && invariantsFile && !acceptEolOnly && !invariantsSide
    && Object.values(maps).every((m) => m.size === 0);
  if (files.length !== 2 && !oneFileOk) {
    throw new Error('usage: semantic-compare-catalog.js <left.tsv> <right.tsv> [--json] [--owner-map a=b] '
      + '[--role-map a=b] [--role-map-left a=b] [--role-map-right a=b] [--accept-eol-only] '
      + '[--invariants <file> [--invariants-side right|left|both]]\n'
      + '   or: semantic-compare-catalog.js --invariants <file> <one.tsv> [--json]');
  }
  return {
    files,
    json,
    acceptEolOnly,
    invariantsFile,
    invariantsSide,
    roleMap: maps['--role-map'],
    roleMapLeft: maps['--role-map-left'],
    roleMapRight: maps['--role-map-right'],
    ownerMap: maps['--owner-map'],
  };
}

function main(argv) {
  let args;
  let res;
  try {
    args = parseArgs(argv);
    const invariants = args.invariantsFile
      ? parseInvariants(fs.readFileSync(args.invariantsFile, 'utf8'), args.invariantsFile) : null;
    if (args.files.length === 1) {
      const one = args.files[0];
      res = checkInvariants(fs.readFileSync(one, 'utf8'), invariants, { label: one });
      process.stdout.write(args.json ? `${JSON.stringify(res, null, 2)}\n` : renderInvariantsOnly(res, one));
      return res.pass ? 0 : 1;
    }
    const [lf, rf] = args.files;
    res = compareFingerprints(fs.readFileSync(lf, 'utf8'), fs.readFileSync(rf, 'utf8'), {
      acceptEolOnly: args.acceptEolOnly,
      invariants,
      invariantsSide: args.invariantsSide,
      roleMap: args.roleMap,
      roleMapLeft: args.roleMapLeft,
      roleMapRight: args.roleMapRight,
      ownerMap: args.ownerMap,
      leftLabel: lf,
      rightLabel: rf,
    });
  } catch (e) {
    process.stderr.write(`semantic-compare-catalog: ${e.message}\n`);
    return 2;
  }
  process.stdout.write(args.json ? `${JSON.stringify(res, null, 2)}\n` : renderText(res, args.files[0], args.files[1]));
  return res.pass ? 0 : 1;
}

module.exports = {
  parseFingerprint, compareFingerprints, classify, renderText, mapRolePositions, FORMAT,
  parseInvariants, evaluateInvariants, checkInvariants,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
