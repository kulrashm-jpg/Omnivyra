# Repository Inventory Guide (Release R3A)

The protected v1.0.0 inventory and how it is catalogued. The verification engine regenerates this inventory on every run; the immutable counts are recorded in `baseline.lock.json`.

## Inventory structure

| Category | Location | Count (v1.0.0) |
|---|---|---|
| Runtime modules | `docs/company-intelligence/governance-automation/runtime/*.mjs` | 25 |
| Shared libraries | `docs/company-intelligence/governance-automation/runtime/lib/*.mjs` | 2 |
| Integration templates (inert) | `docs/company-intelligence/governance-automation/runtime/integrations/*` | 5 |
| Release artifacts | `docs/governance-runtime-v1.0.0/*` | manifests + docs |
| Constitution documents | `docs/company-intelligence/**/*.md` (excl. runtime) | 91 |
| Protection tooling | `scripts/governance-baseline/*` | engine + lock |

## Artifact classification

- **Frozen (immutable):** runtime modules, shared libraries, constitution documents. Byte-for-byte protected; MAJOR + re-audit to change.
- **Release-controlled:** the v1.0.0 manifests (`MANIFEST.json`, `DEPENDENCY-GRAPH.json`, `VERSION.json`, `_digests.json`) and release documentation.
- **Additive tooling:** the baseline verification engine and lock (R3A) and the CODEOWNERS protection.

## Runtime catalog

Authoritative in `MANIFEST.json` — 25 runtimes WP-02→WP-26, each with id, responsibility, predecessor, successor, entrypoint, outputs, registries, ledgers, and deterministic digest. Two shared libraries (`repository-model`, `runtime-invoke`).

## Manifest catalog

| Manifest | Contents |
|---|---|
| `MANIFEST.json` | per-runtime metadata + digests |
| `DEPENDENCY-GRAPH.json` | 25 nodes / 15 edges / 0 cycles; runtime order; execution chain |
| `VERSION.json` | version baseline + release/baseline IDs + release digest |
| `_digests.json` | canonical per-runtime digests + release digest |
| `baseline.lock.json` (tooling) | immutable content-hash + inventory + digest lock for verification |

Machine-readable inventory is emitted by `npm run governance:verify-baseline -- --json` and the `runtime-inventory-report`.
