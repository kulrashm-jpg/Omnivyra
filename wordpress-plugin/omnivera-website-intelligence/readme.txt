=== Omnivera Website Intelligence ===
Contributors: omnivera
Tags: analytics, attribution, tracking, publishing, cms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 8.1
Stable tag: 0.4.0
License: GPLv2 or later

Connect WordPress to Omnivera for website intelligence, tracking injection, publishing sync, diagnostics, and attribution readiness.

== Installation ==

1. Upload the omnivera-website-intelligence folder to wp-content/plugins.
2. Activate the plugin.
3. Open Settings > Omnivera.
4. Paste the setup token generated in Omnivera.
5. Review diagnostics and run the first sync.

== Security ==

The plugin stores only the Omnivera-issued plugin token in WordPress options. Omnivera stores a hash of the token. Admin operations use WordPress nonces and require manage_options.
