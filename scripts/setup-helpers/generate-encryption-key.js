#!/usr/bin/env node
/**
 * Encryption Key Generator
 * Generates a secure 32-byte (256-bit) encryption key for AES-256-GCM
 * 
 * Usage: node scripts/setup-helpers/generate-encryption-key.js
 */

const crypto = require('crypto');

function generateEncryptionKey() {
  // Generate 32 random bytes (256 bits) for AES-256
  const key = crypto.randomBytes(32);
  
  // Convert to hex string (64 characters)
  const hexKey = key.toString('hex');
  
  // Also provide base64 version (44 characters, but more portable)
  const base64Key = key.toString('base64');
  
  console.log('\n🔐 ENCRYPTION KEY GENERATED\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('HEX FORMAT (64 chars - recommended for ENCRYPTION_KEY):');
  console.log(hexKey);
  console.log('\nBASE64 FORMAT (44 chars - alternative):');
  console.log(base64Key);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n⚠️  IMPORTANT:');
  console.log('1. Copy the HEX key above');
  console.log('2. Add to .env.local: ENCRYPTION_KEY=<hex_key>');
  console.log('3. Never commit this key to version control!');
  console.log('4. Store securely for production (use secrets manager)\n');
  
  return { hex: hexKey, base64: base64Key };
}

// Run if executed directly
if (require.main === module) {
  generateEncryptionKey();
}

module.exports = { generateEncryptionKey };

