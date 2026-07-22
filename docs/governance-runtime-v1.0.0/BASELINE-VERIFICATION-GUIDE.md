# Baseline Verification Guide (Release R3A)

The baseline verification engine (`scripts/governance-baseline/verify-baseline.mjs`) confirms the frozen Governance Runtime v1.0.0 is unchanged. It is verification-only — no correction, no remediation.

## Verification workflow

1. **Lock (one-time):** `npm run governance:verify-baseline -- --generate-lock` records the immutable baseline (`scripts/governance-baseline/baseline.lock.json`): content hashes of every runtime module + shared library + integration template + release artifact + a constitution content digest, plus the inventory counts, dependency-graph digest, manifest digest, recomputed release digest, and behavioral digests.
2. **Verify (routine / CI):** `npm run governance:verify-baseline` re-snapshots the tree and diffs it against the lock → `VERIFIED` (exit 0) or `DRIFT-DETECTED` (exit 1).
3. **Reports:** `npm run governance:verify-baseline:reports` additionally writes five deterministic JSON reports.

## Digest verification

The engine checks all of: **release digest** (recomputed from `MANIFEST.json` and matched to `VERSION.json` `4903e8fb`), **manifest digest**, **dependency-graph digest**, **runtime digest** (rolled-up hash of all runtime files), **constitution digest**, and each **per-file content hash**. Any mismatch is drift.

## Replay verification

The engine runs the fast runtimes (WP-02 `validate-docs`, WP-03 `census`) and asserts their canonical behavioral digests (`005975e3`, `9f16e998`) are re-emitted — proving deterministic replay is preserved, not merely that files are unchanged. (Deep-chain runtime digests are recorded in the manifest and verified at release time via their canonical demos.)

## Failure handling

- **`DRIFT-DETECTED`** — the Drift Detection Report lists each drift by category (`runtime-drift`, `documentation-drift`, `manifest-drift`, `dependency-drift`, `release-drift`, `digest-drift`, `file-modified/added/removed`, `inventory-drift`). The engine **does not** fix drift; a human owner determines whether it is an authorized MAJOR release (re-lock) or an accidental modification (revert via the maintainer).
- **`baseline.lock.json missing`** — run `--generate-lock` once against a known-good frozen tree.
- **Behavioral mismatch with unchanged files** — indicates a Node/runtime-environment change; investigate the environment, not the code.
