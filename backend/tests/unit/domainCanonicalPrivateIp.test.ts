/**
 * PROD-CX-004 §5 — SSRF IP-classification certification for the canonical
 * resolver's isPrivateIp() boundary. Two guarantees, both regression-critical:
 *   1. GENUINE private/internal destinations are blocked — including IPv4
 *      embedded in IPv6 in every notation (mapped + compatible, dotted + hex).
 *   2. GLOBALLY-ROUTABLE addresses are NEVER over-blocked — including global
 *      IPv6 whose low bits merely look like an embedded IPv4 (the case that must
 *      not be misclassified as private).
 */
import { isPrivateIp } from '../../services/domainCanonicalService';

describe('isPrivateIp — blocks genuine private destinations', () => {
  it.each([
    ['10.0.0.1'],
    ['172.16.5.4'],
    ['192.168.29.1'],
    ['127.0.0.1'],
    ['169.254.169.254'], // cloud metadata
    ['0.0.0.0'],
  ])('blocks private/internal IPv4 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['::1'],                       // loopback
    ['fc00::1'],                   // unique local
    ['fd12:3456::1'],              // unique local
    ['fe80::1'],                   // link-local
  ])('blocks private IPv6 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['::ffff:192.168.29.1'],       // IPv4-mapped, dotted
    ['::ffff:c0a8:1d01'],          // IPv4-mapped, hextet (192.168.29.1)
    ['::192.168.29.1'],            // IPv4-compatible, dotted
    ['::c0a8:1d01'],               // IPv4-compatible, hextet (192.168.29.1)
    ['::ffff:169.254.169.254'],    // mapped metadata IP
    ['::ffff:127.0.0.1'],          // mapped loopback
  ])('blocks a PRIVATE IPv4 embedded in IPv6: %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
});

describe('isPrivateIp — never over-blocks globally-routable addresses', () => {
  it.each([
    ['8.8.8.8'],
    ['160.153.0.196'],             // the SNIS-class public host
    ['203.0.113.7'],
    ['1.1.1.1'],
  ])('allows public IPv4 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it.each([
    ['2606:4700:4700::1111'],      // Cloudflare
    ['2405:201:680d:c083::c0a8:1d01'], // global IPv6 whose low bits LOOK like 192.168.29.1
    ['2001:4860:4860::8888'],      // Google
  ])('allows global IPv6 %s (embedded-looking low bits must not misclassify)', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it.each([
    ['::ffff:8.8.8.8'],            // mapped PUBLIC v4 stays allowed
    ['::ffff:0808:0808'],          // mapped PUBLIC v4 in hextet form
  ])('allows a PUBLIC IPv4 embedded in IPv6: %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});
