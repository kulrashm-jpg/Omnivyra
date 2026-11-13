# Vendored Chrome extension v1.4.0 EXCERPTS (test fixture only)

PL-18 (2026-11-13): the Chrome extension source is not in this repository. Two backend suites assert properties of
the extension's code (`extensionDispatchLeaseRenewal`, `extensionProductionTargeting`) and used to read it from an
absolute path on one person's machine, so they failed to load everywhere else - including CI.

OWNER RULING (2026-11-13): this repo is public, so only the MINIMUM product code is vendored. These files are NOT
copies of the extension - they are VERBATIM LINE EXCERPTS of the recovered v1.4.0 source, exactly the lines the two
suites assert on, each preceded by its source line range and the md5 of those lines (LF):

| fixture | source lines |
|---|---|
| `background/serviceWorker.js` | 31, 128, 141-180, 357, 1047 |
| `core/commandProcessor.js` | 270-304 |
| `core/apiClient.js` | 225, 451-480, 493 |
| `manifest.json` | the `version` field only (`1.4.0`) |

Not runnable, not shipped, not the source of truth. No secrets (scanned before vendoring).

`fixture-tool.js` rebuilds and verifies them from the real source:

    node backend/tests/fixtures/chrome-extension-v1.4.0/fixture-tool.js <extensionSrcDir>          # verify
    node backend/tests/fixtures/chrome-extension-v1.4.0/fixture-tool.js <extensionSrcDir> --write  # rebuild

It also checks the WHOLE-FILE properties an excerpt cannot prove, against the full source: both
`resolveDevLocalhostBase()` call sites are guarded by `isDevelopmentBuild() ? ... : null`, there is no other awaited
call, and no bare `const devBase = await resolveDevLocalhostBase();`. Verified 2026-11-13: "FIXTURE MATCHES SOURCE",
whole-file `{"guardedCallSites":2,"awaitedCallSites":2,"bareDevBase":false}`.

When the extension changes (e.g. 1.5.0): update the line ranges in `fixture-tool.js`, run it with `--write`, then
without, rename the folder and `EXT_FIXTURE` in both suites, and re-run them through `scripts/run-tests-strict.sh`.
