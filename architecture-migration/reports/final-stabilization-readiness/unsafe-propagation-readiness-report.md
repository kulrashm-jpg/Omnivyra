# Unsafe Propagation Readiness Report

Unsafe propagation: SAFE for hard-enforced critical gate
Unsafe propagation hard enforcement: PASSING
Critical unsafe propagation findings: 0
Trust boundaries: intact for hard-enforced semantic gate
Repository outputs: no critical hard-gate regression detected
Queue/scheduler boundaries: no critical hard-gate regression detected

Remaining unsafe debt classification:
- critical: 0 hard-enforcement findings
- high: 475 semantic high findings reported by enforcement; current high category is runtime-mutation-outside-repository, not transitive unsafe propagation
- nonblocking raw pattern debt: 6241 raw critical leak-pattern findings in ownership audit

Raw critical leak pattern classes:
- unsafe-any-propagation: 6039
- unsafe-unknown-mutation: 199
- unsafe-json-parse: 3

Determination for remaining high findings:
- propagation-safe: yes for hard-enforced critical propagation gate
- runtime-safe: partial; high runtime mutation findings remain
- mutation-safe: partial; high mutation surfaces remain
- authority-safe: yes; canonical authority audit passed with zero findings
