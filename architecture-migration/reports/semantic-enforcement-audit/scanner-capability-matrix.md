# Scanner Capability Matrix

| Scanner | Syntax | AST | Type-aware | Call-graph | Runtime-flow | Repository-boundary | Alias/re-export tracing | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| stabilization-audit frontend/backend imports | yes | no | no | no | no | no | no | regex/string only |
| stabilization-audit variant contamination | yes | no | no | no | no | no | no | regex/scoped only |
| stabilization-audit direct DB writes | yes | no | no | no | no | path-only exclusions | no | raw pattern scan |
| stabilization-audit duplicate owners | yes | no | no | no | no | no | no | symbol mention scan |
| stabilization-audit cycles | yes | partial import parse | no | import graph only | no | no | partial path resolve | import graph only |
| ownership-risk direct DB writes | yes | yes | no | no | no | path-class only | no | AST pattern, bypassable |
| ownership-risk duplicate execution | yes | yes | no | no | no | no | no | function-symbol heuristic |
| ownership-risk dependency cycles | yes | yes | import-declaration typeOnly only | import graph | no | no | partial barrel classification | partial |
| ownership-risk boundary leaks | yes | no | no | no | no | no | no | regex/context only |
| ownership-risk oversized modules | yes | no | no | no | no | concern regex only | no | heuristic |
| enforce-incremental-boundaries | depends on generated reports | no | no | no | no | no | no | baseline comparator |

Current enforcement system is bypassable.

Primary reason: no scanner resolves a typed call graph from entrypoint to canonical owner, repository mutation authority, queue processor, and runtime side effect.
