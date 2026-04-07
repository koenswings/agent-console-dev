# Console UI — Engine Auto-Discovery

**Status:** Proposed  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-04-07  
**Depends on:** `design/002-console-build-deployment-testing.md`

---

## Problem

When a new operator opens the Console for the first time, they see an onboarding form
asking for an Engine hostname and Store URL. On a school LAN with no internet and no IT
support, most operators don't know what to type there.

The Engine hostname follows predictable patterns: `appdocker01`, `idea01`, `engine01`,
plus `.local` variants for mDNS. We should try those automatically before asking.

---

## Proposed Solution: Auto-Discovery on First Load

When the Console starts with no hostname configured (first-run or cleared), it runs a
background discovery scan — probing a list of candidate hostnames in parallel. The first
one that responds to `GET /api/store-url` wins. The result is saved and the Console
connects automatically, with no form required.

If discovery fails, the onboarding form is shown as a fallback (current behaviour).

---

## Candidate Hostname List

Tried in parallel, with a short per-request timeout (2s):

```
appdocker01   appdocker01.local
appdocker02   appdocker02.local
appdocker03   appdocker03.local
idea01        idea01.local
idea02        idea02.local
idea03        idea03.local
engine01      engine01.local
engine02      engine02.local
engine03      engine03.local
```

All probed simultaneously. First to return `{ url: "automerge:..." }` wins.
If multiple respond (unlikely but possible), lowest index wins.

We use `GET /api/store-url` as the probe — it returns the store URL in one shot,
so a successful probe gives us both the hostname AND the store URL.

---

## Flow

```
App starts
  └─ No hostname in storage?
       ├─ YES → run discovery scan (parallel fetch, 2s timeout each)
       │          ├─ Hit found → save hostname + store URL → connect → show UI
       │          └─ No hit → show onboarding form (current behaviour)
       └─ NO  → use stored hostname (current behaviour)
```

During the scan, the status bar shows "Discovering engine…" instead of "Connecting…".

---

## UX Details

- **Discovery is silent and fast.** If it succeeds, the operator sees the connected
  UI directly — no form, no confirmation needed.
- **Discovery failure is graceful.** Onboarding form appears as today. Nothing breaks.
- **Retry button.** The onboarding form gets a "Scan for engine" button that re-runs
  discovery on demand. Useful if the Engine was off when the Console first opened.
- **Status feedback.** During scan: "Discovering engine…" in the status bar.
  On failure: "Engine not found — enter hostname manually."
- **Production web mode is unaffected.** Auto-discovery only runs when no hostname
  is configured. In production web mode, the hostname comes from the URL and discovery
  is skipped entirely.

---

## Implementation Plan

### 1. `src/store/discovery.ts` — new file

```ts
export interface DiscoveryResult {
  hostname: string;
  storeUrl: string;
}

export async function discoverEngine(): Promise<DiscoveryResult | null>
```

- Builds candidate list (bare + `.local` for each prefix/number combo)
- Races all `fetch` calls with `AbortSignal.timeout(2000)`
- Returns first successful `{ hostname, storeUrl }` or null

### 2. `src/components/Onboarding.tsx`

- Add "Scan for engine" button → calls `discoverEngine()`, fills fields on hit
- Show scan status inline ("Scanning…" / "Found: appdocker01" / "Not found")

### 3. `src/App.tsx`

- On mount, if no hostname and not demo mode: call `discoverEngine()` before
  deciding whether to show onboarding
- If found: save to storage, call `initConnection()`, skip onboarding

### 4. Status bar

- New status text: "Discovering engine…" during scan
- Falls through to current "Not configured" if scan fails

---

## What's Not in Scope

- **MDNS/mDNS browsing via browser APIs** — not available in browsers without
  native extensions. We rely on the OS resolving `.local` names normally.
- **Network subnet scanning** — probing arbitrary IPs is slow and unreliable.
  Named hostnames are the right approach for this use case.
- **Operator auth auto-login** — this is Engine discovery only, not user
  authentication. Operator login remains explicit.

---

## Open Questions

1. Should discovery run in the background while showing the onboarding form,
   or block the form until it completes? → Recommend: run in background, fill the
   form if found (non-blocking).
2. Should the candidate list be configurable? → No, for now. Keep it simple.
   Can be extended later.

---

## Risks

- `.local` mDNS resolution can be slow on some Android browsers (3–5s). The 2s
  timeout may cause misses on first attempt but the retry button covers that.
- If two engines are online simultaneously (e.g. during upgrade), discovery picks
  the lowest-index candidate. This is correct — the operator can override manually.
