#!/usr/bin/env node
/**
 * Generate a new IndexNow key locally (32 lowercase hex characters from crypto.randomBytes; the protocol
 * allows 8-128 of a-z, A-Z, 0-9, "-"). Prints the key once to stdout and stores nothing.
 *
 *   node scripts/generate-indexnow-key.js
 *
 * Put the value in the deployment environment as INDEXNOW_API_KEY (Vercel production). Do not commit it.
 * Never reuse a sample key from documentation. The key becomes public by
 * design once /<key>.txt is served, but it is still kept out of the repository so it can be rotated
 * without a code change.
 */
const { randomBytes } = require('crypto');
process.stdout.write(`${randomBytes(16).toString('hex')}\n`);
