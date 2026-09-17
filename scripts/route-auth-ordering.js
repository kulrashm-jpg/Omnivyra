'use strict';
/**
 * STEP 3AH-118 (WS-F) — route-auth ORDERING analysis for check-route-auth.js.
 *
 * R1–R3 decide whether a route INVOKES an approved primitive. They cannot tell
 * whether the primitive runs BEFORE the route's protected side effects: a write
 * above `getSupabaseUserFromRequest`, or a delete above `enforceCompanyAccess`,
 * passes a presence check. This module interprets the served handler on the
 * TypeScript AST, statement by statement, tracking two facts along every path:
 *
 *   id      the caller has been authenticated (identity-level primitive)
 *   tenant  the caller has been authorized for a tenant (tenant/platform/machine)
 *
 * Control flow is approximated by dominance, never by source position alone:
 * a primitive in one `if` branch, a `case`, a loop body, a `catch`, a callback,
 * or the right side of `&&`/`||`/`??`/`?:` does not cover what follows it.
 * A branch that returns or throws does not weaken the state after it.
 *
 * Same-module helpers and functions in delegation roots (backend/apiHandlers/,
 * pages/api/) are interpreted inline, so auth and side effects inside them land
 * at the call site. Other repo functions (services) are summarised for the side
 * effects they can reach (depth-limited); primitives inside a service never
 * authenticate the route (the R1 delegation rule).
 */
const ts = require('typescript');
const crypto = require('crypto');
const {
  CALLER_PRINCIPAL, isFnLike, unwrap, calleeName, chainOf, sinkOf, operands,
  isMethodExpr, methodTest, underMethods, requestDerived, enclosingFn, optionalBinding, invokesParam,
} = require('./route-auth-ordering-shapes');

// Explicit safe seams: effects a route may perform before authentication. Each is
// provenance-checked (imported from the module that implements it).
const SAFE_SEAMS = [
  // Append-only security audit trail: recording an unauthenticated / denied attempt IS the purpose.
  { name: 'logSecurityEvent', from: /^backend\/security\/audit\/SecurityAuditService$/ },
];
const SUMMARY_DEPTH = 3;
const INLINE_DEPTH = 6;

function createOrderingAnalyzer({ PRIMITIVES, AUTHZ_HELPERS, DELEGATION_ROOTS, resolveSpec, loadModule, parseImports }) {
  const sfCache = new Map();
  const summaryCache = new Map();
  // Verifier names that authenticate for the route being analysed (machine-token / webhook-signature entries).
  let extraAuth = new Set();

  function parsed(mod) {
    // Content-addressed: two sources at the same path (fixtures, mutants) never share a parse.
    const key = `${mod.rel}|${crypto.createHash('sha1').update(mod.raw).digest('hex')}`;
    if (!sfCache.has(key)) {
      const kind = /\.tsx$/.test(mod.rel) ? ts.ScriptKind.TSX : /\.js$/.test(mod.rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const sf = ts.createSourceFile(mod.rel, mod.raw, ts.ScriptTarget.Latest, true, kind);
      const top = new Map();
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name) top.set(st.name.text, st);
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) top.set(d.name.text, d.initializer);
      }
      sfCache.set(key, { sf, top, imports: mod.imports || parseImports(mod.raw) });
      if (sfCache.size > 4000) sfCache.clear();
    }
    return sfCache.get(key);
  }

  const line = (m, node) => m.sf.getLineAndCharacterOfPosition(node.getStart(m.sf)).line + 1;
  /** An imported approved primitive / authz helper invoked by this call (provenance-checked). */
  function authOf(call, m) {
    const c = unwrap(call.expression);
    const nm = calleeName(call);
    if (nm && extraAuth.has(nm)) return { level: 'machine', name: nm, helper: false };
    if (!ts.isIdentifier(c)) return null;
    const imp = m.imports.get(c.text);
    if (!imp) return null;
    const target = resolveSpec(m.rel, imp.spec);
    const prim = PRIMITIVES[imp.imported];
    if (prim && target && prim.from.test(target)) return { level: prim.level, name: imp.imported, helper: false };
    const h = AUTHZ_HELPERS[imp.imported];
    if (h && target && h.from.test(target)) return { level: h.level, name: imp.imported, helper: true };
    return null;
  }

  function applyAuth(st, a) {
    if (a.helper) { if (st.id && (a.level === 'tenant' || a.level === 'platform')) st.tenant = true; return; }
    st.id = true;
    if (a.level !== 'identity') st.tenant = true;
  }

  const isSafeSeam = (call, m) => {
    const c = unwrap(call.expression);
    if (!ts.isIdentifier(c)) return false;
    const imp = m.imports.get(c.text);
    const target = imp && resolveSpec(m.rel, imp.spec);
    return Boolean(target && SAFE_SEAMS.some((x) => x.name === imp.imported && x.from.test(target)));
  };

  /** A constant-time secret comparison: crypto.timingSafeEqual, backend/security/constantTime*, or a function built on one. */
  const comparatorMemo = new Map();
  function isComparatorCall(call, m, depth) {
    const c = unwrap(call.expression);
    const nm = calleeName(call);
    if (nm === 'timingSafeEqual') {
      const root = ts.isPropertyAccessExpression(c) ? unwrap(c.expression) : c;
      const imp = ts.isIdentifier(root) ? m.imports.get(root.text) : null;
      return Boolean(imp && /^(?:node:)?crypto$/.test(imp.spec));
    }
    if (ts.isIdentifier(c)) {
      const imp = m.imports.get(c.text);
      const target = imp && resolveSpec(m.rel, imp.spec);
      if (target && /^backend\/security\/constantTime\w*$/.test(target)) return true;
    }
    if (depth >= 2) return false;
    const r = resolveCallee(call, m, null);
    if (!r) return false;
    const key = `${r.m.rel}#${r.fn.pos}`;
    if (!comparatorMemo.has(key)) {
      comparatorMemo.set(key, false);
      let found = false;
      const visit = (n) => { if (found) return; if (ts.isCallExpression(n) && isComparatorCall(n, r.m, depth + 1)) { found = true; return; } ts.forEachChild(n, visit); };
      if (r.fn.body) visit(r.fn.body);
      comparatorMemo.set(key, found);
    }
    return comparatorMemo.get(key);
  }

  /** A comparator call, or a `const` in scope bound to one (`const ok = cmp(...); if (!ok) return`). */
  const isComparison = (o, m, scope) => {
    o = unwrap(o);
    if (ts.isCallExpression(o)) return isComparatorCall(o, m, 0);
    if (!ts.isIdentifier(o)) return false;
    for (let s = scope; s; s = s.parent) if (s.cmp && s.cmp.has(o.text)) return true;
    return false;
  };
  /** `if (cmp(...) && …)` — the then-branch runs only after a successful secret comparison. */
  const positiveSecretGuard = (cond, m, scope) => operands(cond, ts.SyntaxKind.AmpersandAmpersandToken).some((o) => isComparison(o, m, scope));
  /** `if (!cmp(...) || …) <exit>` — code after the if runs only after a successful secret comparison. */
  const negativeSecretGuard = (cond, m, scope) => operands(cond, ts.SyntaxKind.BarBarToken).some((o) => ts.isPrefixUnaryExpression(o) && o.operator === ts.SyntaxKind.ExclamationToken && isComparison(o.operand, m, scope));
  const machine = (st) => ({ ...st, id: true, tenant: true });

  /** Resolve an identifier call to a function node + its module: local scope, module top level, or an import. */
  function resolveCallee(call, m, scope) {
    const c = unwrap(call.expression);
    if (!ts.isIdentifier(c)) return null;
    for (let s = scope; s; s = s.parent) if (s.fns.has(c.text)) return { fn: s.fns.get(c.text), m, name: c.text, local: true };
    const topFn = m.top.get(c.text);
    if (topFn && isFnLike(unwrap(topFn))) return { fn: unwrap(topFn), m, name: c.text, local: true };
    const imp = m.imports.get(c.text);
    const target = imp && resolveSpec(m.rel, imp.spec);
    if (!target || imp.imported === 'default') return null;
    const mod = loadModule(target);
    if (!mod) return null;
    const mm = parsed(mod);
    const fn = mm.top.get(imp.imported);
    if (!fn || !isFnLike(unwrap(fn))) return null;
    return { fn: unwrap(fn), m: { ...mm, rel: mod.rel }, name: imp.imported, delegated: DELEGATION_ROOTS.some((r) => r.test(target)) };
  }

  /** Unordered side effects a (non-delegation) function can reach. */
  function summarize(fn, m, depth, seen) {
    const key = `${m.rel}#${fn.pos}`;
    if (summaryCache.has(key)) return summaryCache.get(key);
    if (depth > SUMMARY_DEPTH || seen.has(key)) return [];
    seen.add(key);
    const out = [];
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const s = sinkOf(n, m);
        if (s) out.push({ ...s, at: `${m.rel}:${line(m, n)}` });
        else if (!authOf(n, m)) {
          const r = resolveCallee(n, m, null);
          if (r) for (const e of summarize(r.fn, r.m, depth + 1, seen)) out.push({ ...e, via: [r.name, ...(e.via || [])] });
        }
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
    const uniq = [];
    const k = new Set();
    for (const e of out) { const id = `${e.kind}|${e.at}`; if (!k.has(id)) { k.add(id); uniq.push(e); } }
    summaryCache.set(key, uniq);
    return uniq;
  }

  // ─────────────────────────────────────────────── flow interpretation ──
  function interpretFunction(fn, m, st, cx, parentScope) {
    const scope = { fns: new Map(), parent: parentScope };
    const body = fn.body;
    if (!body) return { st, exits: false };
    if (!ts.isBlock(body)) { const s2 = expr(body, m, { ...st }, cx, scope); return { st: s2, exits: true }; }
    return block(body.statements, m, { ...st }, cx, scope);
  }

  function block(stmts, m, st, cx, scope) {
    for (const s of stmts) {
      if (ts.isFunctionDeclaration(s) && s.name) scope.fns.set(s.name.text, s);
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && isFnLike(unwrap(d.initializer))) scope.fns.set(d.name.text, unwrap(d.initializer));
    }
    for (const s of stmts) {
      const r = stmt(s, m, st, cx, scope);
      st = r.st;
      if (r.exits) return { st, exits: true };
    }
    return { st, exits: false };
  }

  const both = (states) => states.reduce((a, b) => ({ id: a.id && b.id, tenant: a.tenant && b.tenant, mc: a.mc === b.mc ? a.mc : null }));

  function stmt(s, m, st, cx, scope) {
    if (ts.isBlock(s)) return block(s.statements, m, st, cx, { fns: new Map(), parent: scope });
    if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isImportDeclaration(s)) return { st, exits: false };
    if (ts.isVariableStatement(s)) {
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) {
        if (!d.initializer || isFnLike(unwrap(d.initializer))) continue;
        st = expr(d.initializer, m, st, cx, scope);
        if (isConst && ts.isIdentifier(d.name) && ts.isCallExpression(unwrap(d.initializer)) && isComparatorCall(unwrap(d.initializer), m, 0)) (scope.cmp || (scope.cmp = new Set())).add(d.name.text);
      }
      return { st, exits: false };
    }
    if (ts.isExpressionStatement(s)) return { st: expr(s.expression, m, st, cx, scope), exits: false };
    if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return { st: s.expression ? expr(s.expression, m, st, cx, scope) : st, exits: true };
    if (ts.isIfStatement(s)) {
      const c = expr(s.expression, m, st, cx, scope);
      const mt = methodTest(s.expression);
      const authMark = cx.auth.length;
      const t = stmt(s.thenStatement, m, positiveSecretGuard(s.expression, m, scope) ? machine(c) : underMethods(c, mt), cx, scope);
      let cont = t.exits && negativeSecretGuard(s.expression, m, scope) ? machine(c) : c;
      if (optionalBinding(s.expression, cx.auth.slice(authMark), s)) cont = { ...cont, tenant: true };
      const e = s.elseStatement ? stmt(s.elseStatement, m, { ...cont }, cx, scope) : { st: cont, exits: false };
      const live = [t, e].filter((r) => !r.exits).map((r) => r.st);
      if (!live.length) return { st: cont, exits: true };
      const joined = both(live);
      // `if (method === 'GET' || …) { auth }` without else: remember what holds for those methods only.
      if (mt && !s.elseStatement && !t.exits && ((t.st.id && !c.id) || (t.st.tenant && !c.tenant))) joined.mc = { methods: mt, id: t.st.id, tenant: t.st.tenant };
      return { st: joined, exits: false };
    }
    if (ts.isSwitchStatement(s)) {
      const c = expr(s.expression, m, st, cx, scope);
      const live = [];
      let hasDefault = false;
      const onMethod = isMethodExpr(s.expression);
      for (const clause of s.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) hasDefault = true;
        else expr(clause.expression, m, { ...c }, cx, scope);
        const lit = !ts.isDefaultClause(clause) && ts.isStringLiteral(unwrap(clause.expression)) ? unwrap(clause.expression).text.toUpperCase() : null;
        const start = onMethod && lit ? underMethods(c, new Set([lit])) : { ...c };
        const r = block(clause.statements, m, start, cx, { fns: new Map(), parent: scope });
        if (!r.exits) live.push(r.st);
      }
      if (!hasDefault) live.push(c);
      return live.length ? { st: both(live), exits: false } : { st: c, exits: true };
    }
    if (ts.isTryStatement(s)) {
      const t = block(s.tryBlock.statements, m, { ...st }, cx, { fns: new Map(), parent: scope });
      const k = s.catchClause ? block(s.catchClause.block.statements, m, { ...st }, cx, { fns: new Map(), parent: scope }) : { st, exits: true };
      const live = [t, k].filter((r) => !r.exits).map((r) => r.st);
      let out = live.length ? { st: both(live), exits: false } : { st: t.st, exits: true };
      if (s.finallyBlock) { const f = block(s.finallyBlock.statements, m, { ...out.st }, cx, { fns: new Map(), parent: scope }); out = { st: f.st, exits: out.exits || f.exits }; }
      return out;
    }
    if (ts.isForStatement(s) || ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s)) {
      let c = st;
      if (ts.isForStatement(s)) { if (s.initializer) c = ts.isVariableDeclarationList(s.initializer) ? s.initializer.declarations.reduce((a, d) => (d.initializer ? expr(d.initializer, m, a, cx, scope) : a), c) : expr(s.initializer, m, c, cx, scope); if (s.condition) c = expr(s.condition, m, c, cx, scope); }
      else if (ts.isForOfStatement(s) || ts.isForInStatement(s) || ts.isWhileStatement(s)) c = expr(s.expression, m, c, cx, scope);
      const r = stmt(s.statement, m, { ...c }, cx, scope);
      return { st: ts.isDoStatement(s) && !r.exits ? r.st : c, exits: false };
    }
    if (ts.isLabeledStatement(s)) return stmt(s.statement, m, st, cx, scope);
    return { st, exits: false };
  }

  function record(cx, m, node, sink, st, via) {
    cx.events.push({ kind: sink.kind, detail: sink.detail, at: sink.at || `${m.rel}:${line(m, node)}`, id: st.id, tenant: st.tenant, via: via || [] });
  }

  function expr(n, m, st, cx, scope) {
    n = n && unwrap(n) === n ? n : n;
    if (!n) return st;
    if (isFnLike(n) || ts.isClassExpression(n)) return st; // deferred: runs where it is called
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        const l = expr(n.left, m, st, cx, scope);
        expr(n.right, m, { ...l }, cx, scope);
        return l;
      }
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return expr(n.left, m, expr(n.right, m, st, cx, scope), cx, scope);
      return expr(n.right, m, expr(n.left, m, st, cx, scope), cx, scope);
    }
    if (ts.isConditionalExpression(n)) {
      const c = expr(n.condition, m, st, cx, scope);
      return both([expr(n.whenTrue, m, { ...c }, cx, scope), expr(n.whenFalse, m, { ...c }, cx, scope)]);
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee)) st = expr(callee.expression, m, st, cx, scope);
      if (isSafeSeam(n, m)) { for (const a of n.arguments) if (!isFnLike(unwrap(a))) st = expr(a, m, st, cx, scope); return st; }
      const target = n.arguments.some((a) => isFnLike(unwrap(a))) ? resolveCallee(n, m, scope) : null;
      n.arguments.forEach((a, i) => {
        const ua = unwrap(a);
        if (!isFnLike(ua)) { st = expr(a, m, st, cx, scope); return; }
        // The callback runs here. Its auth dominates what follows only when the
        // callee provably invokes it before returning (timeStage(res, 'auth', () => auth(req))).
        const out = interpretFunction(ua, m, { ...st }, cx, scope);
        if (target && invokesParam(target.fn, i)) st = { ...st, id: st.id || out.st.id, tenant: st.tenant || out.st.tenant };
      });
      const a = authOf(n, m);
      if (a) { st = { ...st }; applyAuth(st, a); cx.auth.push({ name: a.name, level: a.level, at: `${m.rel}:${line(m, n)}`, args: n.arguments.map((x) => x.getText()).join(', '), callerPrincipal: n.arguments.some((x) => CALLER_PRINCIPAL.test(x.getText())) }); return st; }
      const sink = sinkOf(n, m);
      if (sink) { record(cx, m, n, sink, st); return st; }
      const r = cx.depth < INLINE_DEPTH ? resolveCallee(n, m, scope) : null;
      if (r && (r.local || r.delegated)) {
        const key = `${r.m.rel}#${r.fn.pos}`;
        if (cx.stack.includes(key)) return st;
        cx.stack.push(key); cx.depth += 1;
        const out = interpretFunction(r.fn, r.m, { ...st }, cx, r.local ? scope : null);
        cx.stack.pop(); cx.depth -= 1;
        return { ...st, id: st.id || out.st.id, tenant: st.tenant || out.st.tenant };
      }
      if (r) for (const e of summarize(r.fn, r.m, 1, new Set())) record(cx, m, n, e, st, [r.name, ...(e.via || [])]);
      return st;
    }
    let out = st;
    ts.forEachChild(n, (child) => { out = expr(child, m, out, cx, scope); });
    return out;
  }

  // ─────────────────────────────────────────────────── handler resolution ──
  /** Resolve the served handler to { fn, m, pre } (pre = auth established by a primitive wrapper). */
  function resolveHandler(node, m, pre, depth) {
    node = unwrap(node);
    if (!node || depth > 6) return null;
    if (isFnLike(node)) return { fn: node, m, pre };
    if (ts.isIdentifier(node)) {
      const t = m.top.get(node.text);
      if (t) return resolveHandler(t, m, pre, depth + 1);
      const imp = m.imports.get(node.text);
      const target = imp && resolveSpec(m.rel, imp.spec);
      if (!target || imp.imported === 'default' || !DELEGATION_ROOTS.some((r) => r.test(target))) return null;
      const mod = loadModule(target);
      if (!mod) return null;
      const mm = { ...parsed(mod), rel: mod.rel };
      const d = mm.top.get(imp.imported);
      return d ? resolveHandler(d, mm, pre, depth + 1) : null;
    }
    if (ts.isCallExpression(node)) {
      const a = authOf(node, m);
      let p = pre;
      if (a && !a.helper) { p = { ...pre }; applyAuth(p, a); }
      for (const arg of node.arguments) {
        const r = resolveHandler(arg, m, p, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  /**
   * Analyze the handler served by `mod` ({ rel, raw, imports }). `handlerName`
   * selects a named default. `authEvents` names extra verifier calls that count
   * as authentication (machine-token / webhook-signature allowlist verifiers).
   */
  function analyze(mod, handlerName, authEvents = []) {
    const m = { ...parsed(mod), rel: mod.rel };
    let target = null;
    if (handlerName) target = m.top.get(handlerName) || null;
    else {
      for (const s of m.sf.statements) {
        if (ts.isExportAssignment(s) && !s.isExportEquals) target = s.expression;
        if (ts.isFunctionDeclaration(s) && s.modifiers && s.modifiers.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword)) target = s;
      }
    }
    const h = target ? resolveHandler(target, m, { id: false, tenant: false }, 0) : null;
    if (!h) return { shape: 'unresolved', events: [], auth: [] };
    const cx = { events: [], auth: [], depth: 0, stack: [] };
    extraAuth = new Set(authEvents);
    try {
      interpretFunction(h.fn, h.m, { ...h.pre }, cx, null);
    } finally {
      extraAuth = new Set();
    }
    return { shape: 'resolved', events: cx.events, auth: cx.auth, pre: h.pre };
  }

  return { analyze, sinkOf, chainOf };
}

module.exports = { createOrderingAnalyzer };
