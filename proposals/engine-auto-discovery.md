# Console UI — Engine Auto-Discovery

**Status:** Proposed  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-04-07 (revised 2026-04-07)  
**Depends on:** `design/002-console-build-deployment-testing.md`

---

## Problem

When a new operator opens the Console for the first time, they see an onboarding form
asking for an Engine hostname and Store URL. On a school LAN with no internet and no IT
support, most operators don't know what to type there.

The Engine hostname follows predictable patterns: `appdocker01`, `idea01`, `engine01`,
plus `.local` variants for mDNS. We should try those automatically before asking.

---

## Proposed Solution: Auto-Discovery with Engine Picker

When the Console starts with no hostname configured (first-run, cleared, or after a
failed connection), it runs a background discovery scan — probing all candidate
hostnames in parallel. Results drive the UI:

| Results found | Action |
|---|---|
| 0 | Show onboarding form for manual entry |
| 1 | Auto-connect silently — no user action needed |
| 2+ | Show engine picker — operator selects which engine to connect to |

Silently picking one engine when multiple are active would be wrong: the operator
must choose deliberately. The picker replaces the onboarding form content so it
appears in the natural "configure connection" space and works well on mobile.

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
  └─ Hostname in storage?
       ├─ YES → connect directly
       │          └─ Connection fails? → re-scan (same flow as below)
       └─ NO  → show onboarding + scan in background
                  ├─ 0 results → onboarding form (manual entry)
                  ├─ 1 result  → auto-connect silently
                  └─ 2+ results → show engine picker in onboarding panel
```

During the scan, the status bar shows "Discovering engine…" instead of "Connecting…".

### Reconnect after failure

If the stored hostname stops responding (engine replaced, hostname changed), the
Console detects the failed connection and automatically re-runs discovery. Results
are handled identically to first-load: auto-connect on 1 result, picker on 2+,
manual form on 0. The stored hostname is cleared before re-scanning.

---

## UX Details

- **Single result: silent.** Operator sees the connected UI directly — no form, no
  confirmation.
- **Multiple results: picker.** Replaces onboarding form content. Each engine shown
  as a card with hostname and a "Connect" button. One tap selects and connects.
- **Zero results: form.** Onboarding form appears as today. Nothing breaks.
- **Scan button.** The onboarding form has a "Scan for engine" button for manual
  retry. Also shows picker or auto-connects if results are found.
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

### 2. `src/components/EnginePickerPanel.tsx` — new component

Shown inside the onboarding card when 2+ engines are found. Lists each result
as a row with hostname and "Connect" button. Calls `onSelect(result)` on click.

### 3. `src/components/Onboarding.tsx`

- Receives `discoveryResults` prop from App.tsx
- If results.length >= 2: renders EnginePickerPanel instead of the form
- "Scan for engine" button → calls `discoverAllEngines()`, updates results
- Show scan status inline

### 4. `src/App.tsx`

- On mount, if no hostname: show onboarding + run `discoverAllEngines()` in background
- Pass results to Onboarding via signal
- If 1 result: auto-connect, hide onboarding
- If 2+ results: show picker in onboarding panel
- On connection failure: clear hostname, re-run discovery

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

## Decisions

1. Discovery runs non-blocking — onboarding form shows immediately.
2. Multiple results → picker replaces onboarding form content (not a modal,
   not a dropdown — the center panel is the right place).
3. Candidate list is not configurable for now.
4. Re-scan on connection failure — same logic as first load.

---

## Risks

- `.local` mDNS resolution can be slow on some Android browsers (3–5s). The 2s
  timeout may cause misses on first attempt but the retry button covers that.
- If two engines are online simultaneously (e.g. during upgrade), discovery picks
  the lowest-index candidate. This is correct — the operator can override manually.
