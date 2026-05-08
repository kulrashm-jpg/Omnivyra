# Hidden Bypass Surface Report

Hidden bypass surface count: 32

- H1: symbol-renamed orchestrators not in executionDomains.symbols
- H2: alias exports such as runtime implementation exported as canonical symbol
- H3: re-export chains not traversed into final implementation ownership
- H4: dynamic import execution roots in API handlers
- H5: queue.add dispatch roots not resolved to worker processors
- H6: direct inline fallback execution after enqueue failure
- H7: nested helper coordinators inside oversized services
- H8: orchestration factories/create functions not modeled
- H9: runtime composition through callbacks and injected handlers not traced
- H10: repository facade/wrapper calls masking mutations
- H11: ownedDbTable/supabase wrapper calls outside scanner mutation pattern
- H12: API routes classified medium even when business logic is embedded
- H13: queue processors classified entrypoints even when mutating and orchestrating
- H14: normal imports containing type-only specifiers counted as runtime cycles
- H15: barrel exports separated but not fully authority-resolved
- H16: unsafe any scanner treats local and boundary flows without transitive tracing
- H17: DTO erosion through Record<string, unknown> not traced across modules
- H18: repository output mutation not detected
- H19: shared mutable payload mutation not detected unless syntax appears nearby
- H20: auth Bearer/cookie/session fallback surfaces not modeled as single authority
- H21: company authority active_company_id/user_company_roles/profile paths not graph-verified
- H22: role/capability compatibility bridges not semantically checked
- H23: frontend backend import scanner is import-line only and misses runtime fetch coupling
- H24: variant contamination scanner is regex scoped and misses computed keys
- H25: oversized scanner detects concern words not ownership graph
- H26: dependency scanner lacks runtime reachability pruning
- H27: test/dead path classification is path-only
- H28: package enforcement baseline is stale and can block/improperly allow regressions
- H29: raw and true-risk reports overwrite same forensic-rebaseline directory, obscuring historical comparisons
- H30: scheduler/cron dispatch authority not modeled as queue authority
- H31: platform adapter inheritance/composition not traced
- H32: local private functions can own execution without export detection

## Exact Trust Failures
- No semantic call graph.
- No export graph traversal.
- No alias tracing.
- No queue dispatch-to-processor tracing.
- No repository facade modeling.
- No authority graph for auth/session/company/role.
- No transitive DTO contamination analysis.
- No runtime reachability proof for dead/legacy classification.
