# Capability Events — Observability Reference

Single source of documentation for the three structured events emitted by the
centralized platform-capability system. The canonical event names + payload
type live in [`lib/shared/social/capabilityEvents.ts`](../lib/shared/social/capabilityEvents.ts);
this document covers semantics, payload examples, and integration expectations.

## Event Taxonomy

| Event constant | String value | Meaning | Emitter side |
|---|---|---|---|
| `CAPABILITY_LOG_EVENTS.FILTERED` | `"platform.capability.filtered"` | A UI surface assembled a capability-filtered platform list for render. | **FE** (browser) |
| `CAPABILITY_LOG_EVENTS.REJECTED` | `"platform.capability.rejected"` | A publish attempt was rejected because the platform doesn't support the requested capability, or required media is missing. | **BE** (server) |
| `CAPABILITY_LOG_EVENTS.UNRESOLVED` | `"platform.capability.unresolved"` | A publish attempt was rejected because the content's capability could not be determined from signals. | **BE** (server) |

All three share the `CapabilityLogPayload` shape (see
`lib/shared/social/capabilityEvents.ts`). Optional fields are populated by
the surface that emits the event.

## Canonical Payload Fields

```ts
interface CapabilityLogPayload {
  surface: string;                          // emitter identity, e.g. 'bolt:bolt-text', 'publishNow'
  publishSource?: string;                   // 'queue' | 'api' | 'multi-platform-scheduler' | 'bolt:<mode>' | ...
  resolvedCapability: ContentCapability | null;
  connectedPlatforms?: string[];            // UI events only
  supportedPlatforms?: string[];            // UI events only
  hiddenPlatforms?: string[];               // UI events only
  unregisteredPlatforms?: string[];         // UI events only
  hiddenReasons?: Record<string, string>;   // platform → registry-provided reason
  unregisteredReasons?: Record<string, string>;
  platform?: string;                        // publish-validation events
  contentType?: string;                     // publish-validation events
  code?: string;                            // 'CAPABILITY_NOT_SUPPORTED' | 'MEDIA_REQUIRED' | 'PLATFORM_NOT_REGISTERED' | 'CAPABILITY_UNRESOLVED'
  scheduledPostId?: string;                 // publish-validation events
}
```

Token / OAuth / post-body content **MUST NOT** appear in these payloads. The
centralization test (`platformCapability.centralization.test.ts → no payload/
token leakage`) statically enforces this for the BE call sites.

## FILTERED — Frontend Usage

**When:** A UI surface (ShortformResultPage, multi-platform-scheduler,
BOLT mode picker via `useBoltPlatformPicker`) finishes resolving which
connected platforms can publish the current content.

**Emitter:** Browser `console.info(JSON.stringify(...))`. The shape is ready
for a future telemetry transport — replace the `console.info` call with
`window.telemetry.track(...)` to plug in.

**Example payload:**

```json
{
  "event": "platform.capability.filtered",
  "surface": "bolt:bolt-text",
  "publishSource": "bolt:bolt-text",
  "resolvedCapability": "text",
  "supportedPlatforms": ["linkedin", "x", "facebook"],
  "hiddenPlatforms": ["instagram", "tiktok", "youtube", "pinterest"],
  "unregisteredPlatforms": ["mystery-net"],
  "hiddenReasons": {
    "instagram": "Instagram requires media (image or video) for publishing.",
    "tiktok": "TikTok only supports video content.",
    "youtube": "YouTube only supports video content.",
    "pinterest": "Pinterest requires an image or video pin."
  },
  "unregisteredReasons": {
    "mystery-net": "mystery-net is not registered for content publishing."
  }
}
```

**Failure semantics:** `resolvedCapability: null` in a **single-capability**
mode (text / creator) indicates the mode-resolution failure that triggers
the picker's blocking state. In **union** modes (`intelligent-mix`,
`strategy-mix`), `resolvedCapability: null` is the LEGITIMATE union contract
and must NOT be treated as a failure.

## REJECTED — Backend Usage

**When:** A publish attempt reaches a validation chokepoint (publish API,
`publishNowService`, `publishToPlatform` adapter dispatch) and is rejected
because the platform's capability registry entry doesn't support the
content's resolved capability, OR a media-required platform was handed a
text-only payload.

**Emitter:** `backend/services/logger.ts → logger.warn(...)`. Carries the
project's request / correlation ID via `getRequestContext()`.

**Example payload:**

```json
{
  "level": "warn",
  "ts": "2026-05-12T16:42:11.301Z",
  "request_id": "0e8a…",
  "correlation_id": "0e8a…",
  "user_id": "...",
  "event": "platform.capability.rejected",
  "surface": "publishNow",
  "publishSource": "queue",
  "platform": "instagram",
  "resolvedCapability": "text",
  "contentType": "post",
  "code": "CAPABILITY_NOT_SUPPORTED",
  "scheduledPostId": "sp-1"
}
```

**Failure-code dictionary:**

| `code` | Meaning |
|---|---|
| `CAPABILITY_NOT_SUPPORTED` | The platform's `supportedContent` set does not include the resolved capability. |
| `MEDIA_REQUIRED` | The platform's `requiresMediaForPublish` is true and the payload had no media. |
| `PLATFORM_NOT_REGISTERED` | The post's platform is not present in `PLATFORM_CAPABILITY_REGISTRY` (fail-closed). |

## UNRESOLVED — Backend Usage

**When:** The publish-time validator couldn't normalize the post's signals
(`contentType` / `formatFamily` / `workflowType` / `outputMode` /
`campaignType`) into a known `ContentCapability`.

**Emitter:** Same as REJECTED (`logger.warn(...)`).

**Example payload:**

```json
{
  "level": "warn",
  "event": "platform.capability.unresolved",
  "surface": "publishNow",
  "publishSource": "queue",
  "platform": "linkedin",
  "resolvedCapability": null,
  "contentType": "mystery-format",
  "code": "CAPABILITY_UNRESOLVED",
  "scheduledPostId": "sp-1"
}
```

**Failure semantics:** UNRESOLVED is always a hard reject — the system fails
closed rather than guessing. If you see this event repeatedly in production,
the fix is to either (a) extend the normalization maps in
`lib/shared/social/contentCapability.ts` to recognize the new signal, or
(b) audit the upstream source emitting the unrecognized signal.

## Telemetry Integration Expectations

The events are intentionally **transport-agnostic** today:
- FE emits via `console.info(JSON.stringify({ event, ...payload }))`.
- BE emits via `logger.warn(event, payload)` — already correlation-ID aware.

To wire a real telemetry sink later:
1. Replace `console.info(JSON.stringify(...))` in the FE call sites with a
   shared client logger that implements `CapabilityLogger` from
   `lib/shared/social/capabilityEvents.ts`.
2. Backend already routes through `backend/services/logger.ts`; redirecting
   its sink (stdout → OTel exporter, etc.) automatically picks up these
   events.
3. New events must be added to `CAPABILITY_LOG_EVENTS` — the centralization
   test forbids string-literal event names at call sites.

## Cross-Reference

| Concern | Module |
|---|---|
| Event names + payload type | `lib/shared/social/capabilityEvents.ts` |
| FE filter helper | `lib/shared/social/platformContentFilter.ts` |
| BE validator | `backend/services/platformContentValidator.ts` |
| BE publish chokepoint | `backend/adapters/platformAdapter.ts` |
| Capability registry | `lib/shared/social/platformCapabilities.ts` |
| Shared BOLT picker hook | `hooks/useBoltPlatformPicker.ts` |
| Manual smoke-test checklist | `docs/bolt-platform-picker-smoke-test.md` |
