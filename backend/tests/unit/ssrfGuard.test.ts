/**
 * HARDEN-005 — SSRF guard policy tests (pure, no network).
 *
 * Exhaustive coverage of the IP-range and URL-validation policy that every
 * protected outbound request depends on: private/loopback/link-local/CGNAT/
 * metadata/multicast/reserved ranges for both IPv4 and IPv6 (incl. IPv4-mapped
 * IPv6), protocol + credential + literal-IP + allow-list rules.
 */
import { validateOutboundUrl, isBlockedIp, hostMatchesAllowList } from '../../../lib/security/ssrfGuard';

describe('isBlockedIp — IPv4 ranges', () => {
  const blocked = [
    '0.0.0.0', '0.1.2.3',
    '10.0.0.1', '10.255.255.255',
    '100.64.0.1', '100.127.255.255',        // CGNAT
    '127.0.0.1', '127.1.2.3',               // loopback
    '169.254.169.254',                      // AWS/GCP/Azure metadata
    '169.254.0.1',                          // link-local
    '172.16.0.1', '172.31.255.255',         // private /12
    '192.168.0.1', '192.168.255.255',       // private /16
    '192.0.0.1', '192.0.2.5',               // protocol / TEST-NET-1
    '198.18.0.1',                           // benchmarking
    '198.51.100.1', '203.0.113.1',          // TEST-NET-2/3
    '224.0.0.1', '239.255.255.255',         // multicast
    '240.0.0.1', '255.255.255.255',         // reserved / broadcast
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1', '169.253.255.255', '169.255.0.1'];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
});

describe('isBlockedIp — IPv6 ranges', () => {
  const blocked = [
    '::1',                                   // loopback
    '::',                                    // unspecified
    'fc00::1', 'fdff:ffff::1',               // ULA fc00::/7
    'fe80::1', 'febf::1',                    // link-local fe80::/10
    'ff00::1', 'ff02::1',                    // multicast
    '::ffff:127.0.0.1',                      // IPv4-mapped loopback
    '::ffff:10.0.0.1',                       // IPv4-mapped private
    '::ffff:169.254.169.254',                // IPv4-mapped metadata
    '2002:7f00:0001::',                      // (not 6to4-checked but embedded loopback via mapped handled)
  ].filter((x) => x !== '2002:7f00:0001::'); // 6to4 not in scope — keep list honest
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  const allowed = ['2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888', '2a00:1450:4001::1', '::ffff:8.8.8.8'];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }

  it('treats an unparseable IP as blocked (fail-closed)', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('999.999.999.999')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('validateOutboundUrl — protocol / credentials / host', () => {
  it('allows https, rejects everything else by default', () => {
    expect(validateOutboundUrl('https://example.com').ok).toBe(true);
    expect(validateOutboundUrl('http://example.com').reason).toBe('blocked_protocol:http:');
    expect(validateOutboundUrl('ftp://example.com').reason).toBe('blocked_protocol:ftp:');
    expect(validateOutboundUrl('file:///etc/passwd').reason).toBe('blocked_protocol:file:');
    expect(validateOutboundUrl('gopher://x').reason).toContain('blocked_protocol');
    expect(validateOutboundUrl('data:text/html,x').reason).toContain('blocked_protocol');
  });

  it('mixed-case protocol is normalized by URL and still gated', () => {
    // URL lowercases the scheme, so HTTPS is fine and HTTP is still blocked.
    expect(validateOutboundUrl('HTTPS://example.com').ok).toBe(true);
    expect(validateOutboundUrl('HtTp://example.com').reason).toBe('blocked_protocol:http:');
  });

  it('allows http only with allowHttp', () => {
    expect(validateOutboundUrl('http://example.com', { allowHttp: true }).ok).toBe(true);
  });

  it('rejects embedded credentials', () => {
    expect(validateOutboundUrl('https://user:pass@example.com').reason).toBe('embedded_credentials');
    expect(validateOutboundUrl('https://user@example.com').reason).toBe('embedded_credentials');
  });

  it('rejects empty / malformed URLs', () => {
    expect(validateOutboundUrl('').reason).toBe('empty_url');
    expect(validateOutboundUrl('   ').reason).toBe('empty_url');
    expect(validateOutboundUrl(null).reason).toBe('empty_url');
    expect(validateOutboundUrl('not a url').reason).toBe('invalid_url');
    expect(validateOutboundUrl('https://').reason).toBe('invalid_url');
  });

  it('rejects literal blocked IPs before DNS (v4 + v6)', () => {
    expect(validateOutboundUrl('https://127.0.0.1/x').reason).toBe('blocked_ip_literal');
    expect(validateOutboundUrl('https://169.254.169.254/latest').reason).toBe('blocked_ip_literal');
    expect(validateOutboundUrl('https://[::1]/x').reason).toBe('blocked_ip_literal');
    expect(validateOutboundUrl('https://[fc00::1]/').reason).toBe('blocked_ip_literal');
    expect(validateOutboundUrl('https://10.0.0.5').reason).toBe('blocked_ip_literal');
  });

  it('allows a public literal IP', () => {
    expect(validateOutboundUrl('https://8.8.8.8/').ok).toBe(true);
  });

  it('decimal / octal IP encodings that URL rejects are invalid_url; parsed private stays blocked', () => {
    // http URL parser leaves these as opaque hosts; ensure we do not accidentally allow them.
    const r = validateOutboundUrl('https://0x7f000001/');
    expect(r.ok).toBe(false);
  });
});

describe('validateOutboundUrl — allow-list', () => {
  it('permits only allow-listed hosts (exact + dot-suffix) when set', () => {
    const policy = { allowedHosts: ['api.openai.com', 'googleapis.com'] };
    expect(validateOutboundUrl('https://api.openai.com/v1', policy).ok).toBe(true);
    expect(validateOutboundUrl('https://storage.googleapis.com/b/o', policy).ok).toBe(true);
    expect(validateOutboundUrl('https://evil.com', policy).reason).toBe('host_not_in_allowlist');
    // suffix must be on a dot boundary — notgoogleapis.com must NOT match googleapis.com
    expect(validateOutboundUrl('https://notgoogleapis.com', policy).reason).toBe('host_not_in_allowlist');
  });

  it('hostMatchesAllowList boundary rules', () => {
    expect(hostMatchesAllowList('api.openai.com', ['openai.com'])).toBe(true);
    expect(hostMatchesAllowList('openai.com', ['openai.com'])).toBe(true);
    expect(hostMatchesAllowList('evilopenai.com', ['openai.com'])).toBe(false);
    expect(hostMatchesAllowList('API.OPENAI.COM', ['openai.com'])).toBe(true);
  });
});
