# Semantic Enforcement Capability Diff

## Upgraded
- import graph: from regex/import-line scanning to AST import graph with alias metadata.
- export graph: new AST declaration/re-export graph.
- execution graph: new AST caller/callee graph with dynamic import and queue dispatch records.
- ownership graph: from symbol mention checks to execution-root/domain dominance model.
- authority graph: new auth/session/company/role/orchestration/repository/queue surface model.
- mutation governance: from .from regex windows to AST mutation records plus ownedDbTable facade extraction and payload assignment detection.
- unsafe propagation: from local regex/context to unsafe source plus transitive call-edge propagation.
- enforcement trust: new unresolved-region failure model.
- severity tiers: CRITICAL/HIGH/MODERATE/LOW findings.

## Still Heuristic
- canonical owner mapping is configured by module/domain.
- queue target inference maps queue names to known domains.
- authority-domain detection uses semantic surfaces and identifiers, not full runtime policy execution.
- TypeScript type checker symbol resolution is not yet used.
- dominance is graph-structural, not full control-flow dominance.

## Still Bypassable
- runtime reflection and computed dynamic imports.
- DI containers without explicit call edges.
- callbacks passed through external libraries.
- queue names computed dynamically.
- mutations hidden behind arbitrary wrappers not modeled as repository facades.
