require('dotenv').config({ path: '.env.test' });

// jsdom does not define TextEncoder/TextDecoder, but Node does. Suites that opt
// into `@jest-environment jsdom` and transitively import lib/security/safeFetch
// pull in undici, which constructs a TextEncoder at module load (data-url.js)
// and a TextDecoder in fetch/util.js — so the suite failed to load with
// "ReferenceError: TextEncoder is not defined" before reaching a single test.
//
// Sourced from node:util, i.e. the same implementation the default `node`
// environment already exposes; no new dependency. Guarded so the node
// environment, which already has both, is left untouched.
const { TextEncoder, TextDecoder } = require('util');
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;

// Same cluster, next global: undici's fetch installs a webidl converter for
// ReadableStream at module load (lib/web/fetch/response.js:533), so the suite
// still failed to load once TextEncoder was satisfied. jsdom 20.0.3 does not
// expose it; node:stream/web does.
//
// ReadableStream ONLY, on evidence: within undici/lib/web/fetch, WritableStream,
// CompressionStream and DecompressionStream have zero references, and the two
// TransformStream references are a comment and a call inside Request's body
// (request.js:569) — neither runs at module load. A test that genuinely needs
// TransformStream will say so plainly rather than being pre-empted here.
const { ReadableStream } = require('stream/web');
if (typeof globalThis.ReadableStream === 'undefined') globalThis.ReadableStream = ReadableStream;
