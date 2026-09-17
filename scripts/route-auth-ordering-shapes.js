'use strict';
/**
 * STEP 3AH-118 (WS-F) — closure-free SHAPE recognisers for route-auth-ordering.js:
 * side-effect sinks, HTTP-method tests, request-derived values, optional request-id
 * binding, and provable callback invocation. Pure functions over the TypeScript AST.
 */
const ts = require('typescript');

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_METHODS = new Set(['remove', 'upload', 'move', 'copy', 'update', 'createSignedUploadUrl', 'uploadToSignedUrl']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request', 'head']);
const OUTBOUND_NAME = /^(?:sendMail|sendEmail|send[A-Z]\w*(?:Email|Mail|Sms|SMS|WhatsApp\w*|Message|Notification|Invite|Invitation))$/;
const EXTERNAL_IDENT = new Set(['fetch', 'safeFetch', 'safeFetchJson', 'got']);
const QUEUE_IDENT = /^(?:safeEnqueue|enqueueOrThrow|enqueue[A-Z]\w*)$/;

// A principal (who the caller is / what they may do) read from the REQUEST instead of the authenticated identity.
const CALLER_PRINCIPAL = /\b(?:req(?:uest)?\s*\.\s*(?:body|query|headers)|body|query)\s*(?:\?\.|\.)\s*(?:user_?id|userId|role|roles|is_?admin|isAdmin|is_?super_?admin|isSuperAdmin|permissions?|principal|uid|actor_?id|actorId)\b|\breq(?:uest)?\s*\.\s*headers\s*\[\s*['"]x-(?:user-id|role|user-role|admin)['"]\s*\]/i;

const isFnLike = (n) => n && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n));
const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)) || ts.isAwaitExpression(n))) n = n.expression;
  return n;
};

const calleeName = (call) => {
  const c = unwrap(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
};
/** Names along a call/property chain (`supabase.storage.from('b').remove` → storage, from) and its root identifier. */
function chainOf(expr) {
  const names = new Set();
  let root = null;
  let e = unwrap(expr);
  while (e) {
    if (ts.isCallExpression(e)) { const n = calleeName(e); if (n) names.add(n); e = unwrap(e.expression); continue; }
    if (ts.isPropertyAccessExpression(e)) { names.add(e.name.text); e = unwrap(e.expression); continue; }
    if (ts.isElementAccessExpression(e)) { e = unwrap(e.expression); continue; }
    if (ts.isIdentifier(e)) root = e.text;
    break;
  }
  return { names, root };
}

/** Side-effect category of a single call (not following functions), or null. */
function sinkOf(call, m) {
  const c = unwrap(call.expression);
  if (ts.isIdentifier(c)) {
    const imp = m.imports.get(c.text);
    if (EXTERNAL_IDENT.has(c.text) || (imp && /safeFetch|node-fetch|undici/.test(imp.spec))) return { kind: 'external-call', detail: `${c.text}()` };
    if (QUEUE_IDENT.test(c.text)) return { kind: 'queue', detail: `${c.text}()` };
    if (OUTBOUND_NAME.test(c.text)) return { kind: 'outbound', detail: `${c.text}()` };
    if (c.text === 'axios') return { kind: 'external-call', detail: 'axios()' };
    return null;
  }
  if (!ts.isPropertyAccessExpression(c)) return null;
  const name = c.name.text;
  const { names, root } = chainOf(c.expression);
  const tableRoot = names.has('from') || names.has('ownedDbTable') || names.has('dbTable');
  if (names.has('storage') && STORAGE_METHODS.has(name)) return { kind: 'storage', detail: `storage.${name}()` };
  if (WRITE_METHODS.has(name) && tableRoot && !names.has('storage')) return { kind: 'db-write', detail: `.${name}()` };
  if (name === 'rpc' && root) return { kind: 'db-rpc', detail: `.rpc(${call.arguments[0] && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : '…'})` };
  if (name === 'select' && tableRoot && !names.has('storage') && ![...WRITE_METHODS].some((w) => names.has(w))) return { kind: 'db-read', detail: '.select()' };
  if ((name === 'add' || name === 'addBulk') && (/queue/i.test(c.expression.getText()) || [...names].some((n) => /Queue$/.test(n)))) return { kind: 'queue', detail: `${name}()` };
  if (root === 'axios' && HTTP_METHODS.has(name)) return { kind: 'external-call', detail: `axios.${name}()` };
  if (OUTBOUND_NAME.test(name) || (name === 'send' && names.has('emails'))) return { kind: 'outbound', detail: `${name}()` };
  return null;
}

/** Operands of a top-level `op` chain (parentheses unwrapped). */
function operands(n, op) {
  n = unwrap(n);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === op) return [...operands(n.left, op), ...operands(n.right, op)];
  return [n];
}

/** `req.method` / a `method` binding. */
const isMethodExpr = (e) => {
  e = unwrap(e);
  if (ts.isIdentifier(e)) return e.text === 'method';
  return ts.isPropertyAccessExpression(e) && e.name.text === 'method' && ts.isIdentifier(unwrap(e.expression)) && /^req(?:uest)?$/.test(unwrap(e.expression).text);
};
/** Methods named by `M === 'GET' || M === 'POST'` (the whole condition), else null. */
function methodTest(cond) {
  const out = new Set();
  for (const o of operands(cond, ts.SyntaxKind.BarBarToken)) {
    if (!ts.isBinaryExpression(o) || (o.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && o.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)) return null;
    const l = unwrap(o.left);
    const r = unwrap(o.right);
    const lit = ts.isStringLiteral(r) && isMethodExpr(l) ? r : ts.isStringLiteral(l) && isMethodExpr(r) ? l : null;
    if (!lit) return null;
    out.add(lit.text.toUpperCase());
  }
  return out;
}
/** State inside a branch that only runs for `methods`, given a method-conditional fact `mc`. */
const underMethods = (st, methods) => (st.mc && methods && methods.size && [...methods].every((x) => st.mc.methods.has(x))
  ? { ...st, id: st.id || st.mc.id, tenant: st.tenant || st.mc.tenant } : { ...st });

const REQUEST_INPUT = /\breq(?:uest)?\s*(?:\?\.|\.)\s*(?:body|query)\b/;
const boundNames = (name, out = []) => {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (name && name.elements) for (const el of name.elements) if (el.name) boundNames(el.name, out);
  return out;
};
/** Is `x` (identifier / property chain) a value the caller supplied in req.body / req.query? */
function requestDerived(x, fnNode, depth = 0) {
  let root = unwrap(x);
  while (root && ts.isPropertyAccessExpression(root)) root = unwrap(root.expression);
  if (!root || !ts.isIdentifier(root) || depth > 3) return false;
  if (/^req(?:uest)?$/.test(root.text)) return REQUEST_INPUT.test(x.getText());
  if (!fnNode || !fnNode.body) return false;
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && n.initializer && boundNames(n.name).includes(root.text)) {
      // A value loaded from the database (awaited / query-built) is server state, not request
      // input — even when the lookup is keyed by a request id.
      if (hasLookup(n.initializer)) return;
      if (REQUEST_INPUT.test(n.initializer.getText())) { found = true; return; }
      const ids = [];
      const collect = (k) => { if (ts.isIdentifier(k) && k.text !== root.text) ids.push(k); ts.forEachChild(k, collect); };
      collect(n.initializer);
      if (ids.some((id) => requestDerived(id, fnNode, depth + 1))) { found = true; return; }
    }
    if (!isFnLike(n)) ts.forEachChild(n, visit);
  };
  ts.forEachChild(fnNode.body, visit);
  return found;
}
const hasLookup = (init) => {
  let hit = false;
  const v = (k) => { if (hit) return; if (ts.isAwaitExpression(k) || (ts.isCallExpression(k) && ['from', 'select', 'rpc', 'maybeSingle', 'single'].includes(calleeName(k)))) { hit = true; return; } ts.forEachChild(k, v); };
  v(init);
  return hit;
};
const enclosingFn = (n) => { let p = n.parent; while (p && !isFnLike(p)) p = p.parent; return p || null; };
/**
 * Optional request-id binding: `if (X) { <tenant authz on X> }` where X is a
 * request-supplied id. On the path where X is absent the request names no
 * tenant, so tenant ordering (R6) is satisfied there. X must be tested by
 * truthiness and passed (not as an object key) to the authorization call.
 */
function optionalBinding(cond, authEvents, sNode) {
  if (!authEvents.length) return false;
  const tests = operands(cond, ts.SyntaxKind.AmpersandAmpersandToken).filter((o) => ts.isIdentifier(o) || ts.isPropertyAccessExpression(o));
  return tests.some((x) => {
    const text = x.getText().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^\\w$.])${text}(?![\\w$]|\\s*:)`);
    return authEvents.some((a) => (a.level === 'tenant' || a.level === 'platform') && re.test(a.args)) && requestDerived(x, enclosingFn(sNode));
  });
}

/** Does `fn` call its parameter #i unconditionally before returning (e.g. timeStage(res, name, fn))? */
function invokesParam(fn, i) {
  const p = fn.parameters && fn.parameters[i];
  if (!p || !ts.isIdentifier(p.name) || !fn.body) return false;
  const name = p.name.text;
  const isCall = (e) => { const u = unwrap(e); return Boolean(u && ts.isCallExpression(u) && ts.isIdentifier(unwrap(u.expression)) && unwrap(u.expression).text === name); };
  if (!ts.isBlock(fn.body)) return isCall(fn.body);
  const direct = (stmts) => stmts.some((st) => (ts.isExpressionStatement(st) && isCall(st.expression))
    || (ts.isReturnStatement(st) && st.expression && isCall(st.expression))
    || (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => d.initializer && isCall(d.initializer)))
    || (ts.isTryStatement(st) && direct(st.tryBlock.statements)));
  return direct(fn.body.statements);
}

module.exports = {
  CALLER_PRINCIPAL, isFnLike, unwrap, calleeName, chainOf, sinkOf, operands,
  isMethodExpr, methodTest, underMethods, requestDerived, enclosingFn, optionalBinding, invokesParam,
};
