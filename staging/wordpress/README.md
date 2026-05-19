# Omnivera WordPress Staging

Reusable isolated WordPress environment for Website Intelligence validation.

## Start

```bash
cd staging/wordpress
docker compose up -d
```

WordPress listens on `http://localhost:8088` by default and mounts the local plugin source into `wp-content/plugins/omnivera-website-intelligence`.

## Reset

```bash
cd staging/wordpress
docker compose down -v
docker compose up -d
```

## Validation Flow

1. Create a staging tenant/company in Omnivera.
2. Run `npm run wi:deploy:ready`.
3. Generate a setup token from `/website-intelligence`.
4. Activate the plugin in WordPress.
5. Paste the setup token in Settings > Omnivera.
6. Run sync controls.
7. Execute `tsx scripts/validate-website-intelligence-e2e.ts --company-id=<id> --site-url=http://localhost:8088`.

## Seed Targets

Seed these manually or by WP-CLI in CI:
- Categories: `News`, `Guides`, `Product`
- Tags: `attribution`, `wordpress`, `conversion`
- Posts: one published, one draft, one scheduled
- Media: one image attachment
- Forms: one native/contact form with `data-omnivera-form-id`
