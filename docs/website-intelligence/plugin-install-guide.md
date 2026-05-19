# WordPress Plugin Install Guide

Package source: `wordpress-plugin/omnivera-website-intelligence`.

## Manual Install

1. Zip the `omnivera-website-intelligence` folder.
2. Upload it in WordPress Admin > Plugins > Add New > Upload Plugin.
3. Activate it.
4. Open Settings > Omnivera.
5. Enter the setup token from Omnivera.

## Plugin Controls

- Connection Status: confirms token and registration state.
- Website Status: shows site URL and Omnivera website ID.
- Tracking Status: controls injection, consent mode, admin exclusion, manual override, and excluded paths.
- Publishing Status: explains post/taxonomy/media sync state.
- Diagnostics: reports REST, tracking, sync, PHP, WordPress, and plugin compatibility.
- Debug Logs: local plugin logs, capped to 100 entries.

## Security

Admin actions require `manage_options` and WordPress nonce validation. The server stores only a hash of the plugin token.
