# Onboarding Redesign — Unified Discovery Panel

## Current state (problems)

Two separate panels exist side-by-side:

1. **Form panel** — Demo toggle + Scan button + hostname input field + "Save & Connect"
2. **Engine picker panel** — list of found engines (only shown when 2+ results)

Problems:
- Two panels feel disconnected; the user must mentally map between them
- When exactly 1 engine is found, the picker is skipped entirely — auto-connects, no demo option visible
- The Scan button is buried inside the form, not the primary action
- "Multiple engines found" copy implies the list is only relevant at 2+
- The form's "Save & Connect" submit flow is a different interaction mode from the picker's "Connect" buttons
- Manual hostname entry is a full form field always visible alongside the scan UI

---

## Proposed design — single unified panel

One card, one interaction model. Discovery is always running in the background; the panel shows its state.

### States

#### A. Scanning (initial, no results yet)
```
┌─────────────────────────────────┐
│  IDEA Console                   │
│                                 │
│  ⟳ Scanning for engines…       │
│                                 │
│  Enter hostname manually ›      │
│  ──────────────────────────     │
│  [ ] Demo mode                  │
└─────────────────────────────────┘
```

#### B. Results found (1 or more)
```
┌─────────────────────────────────┐
│  IDEA Console                   │
│                                 │
│  Engines found:                 │
│  ┌────────────────────────────┐ │
│  │ idea01          [Connect]  │ │
│  │ idea02          [Connect]  │ │
│  │ idea03          [Connect]  │ │
│  └────────────────────────────┘ │
│  ⟳ Still scanning…             │  ← if background refresh is running
│                                 │
│  Enter hostname manually ›      │
│  ──────────────────────────     │
│  [ ] Demo mode                  │
└─────────────────────────────────┘
```

#### C. Scan complete, no results
```
┌─────────────────────────────────┐
│  IDEA Console                   │
│                                 │
│  No engines found on network.   │
│  [Scan again]                   │
│                                 │
│  Enter hostname manually ›      │
│  ──────────────────────────     │
│  [ ] Demo mode                  │
└─────────────────────────────────┘
```

#### D. Manual hostname entry (expanded)
```
┌─────────────────────────────────┐
│  IDEA Console                   │
│                                 │
│  ← Back to results              │  ← if results exist; else just back arrow
│                                 │
│  Hostname: [appdocker01      ]  │
│            [Connect]            │
│                                 │
│  [ ] Demo mode                  │
└─────────────────────────────────┘
```

---

## Behaviour spec

### Discovery flow

1. On mount, immediately start scanning (`discoverAllEngines()`).
2. Show "Scanning…" spinner until first results or scan completes.
3. Results are shown as they're merged in from the background refresh (every 10s).
4. **Always show all results, including when there's only 1** — the user can choose to use Demo mode instead.
5. Auto-connect is removed — the user always explicitly clicks Connect.

### Manual hostname entry

- Triggered by "Enter hostname manually ›" link — expands inline (no separate panel/form).
- User types a hostname, clicks Connect.
- **Base-name scan logic:**
  1. Strip a trailing sequence number from the entered hostname.
     - `idea01` → prefix `idea`, suffix `.local` if present
     - `idea01.local` → prefix `idea`, suffix `.local`
     - `100.115.60.6` → no prefix (IP address, skip scan)
     - `appdocker` → no number to strip, treat as literal hostname
  2. If a prefix is extracted, run `buildCandidates([prefix])` and probe those.
  3. If new engines are found → update the results list, close the manual input, let the user pick.
  4. If no new engines found → directly connect to the hostname the user typed (single known host).
- The "Connect" button shows a spinner while probing.

### Demo mode toggle

- Always visible at the bottom of the card, regardless of scan state.
- Toggling it does NOT navigate anywhere — it's a preference that lives alongside the engine list.
- When demo mode is enabled, the engine list and scan UI are hidden (demo needs no engine).

### "Still scanning" indicator

- While a background refresh is in progress, show a subtle "⟳ Still scanning…" line below the results list.
- Disappears when the refresh cycle completes.

---

## Component architecture

### Changes to `discovery.ts`
- Add `extractHostnameBase(input: string): { prefix: string; hasSuffix: boolean } | null`
  - Returns prefix + whether `.local` was present; null for IP addresses or no-number inputs
- Add `discoverEnginesByPrefix(prefix: string, hasSuffix: boolean): Promise<DiscoveryResult[]>`
  - Calls `buildCandidates([prefix])` and probes them

### New component: `OnboardingCard`
Replaces both `Onboarding` and `EnginePickerPanel`. Single component, internal state machine:

```
state:
  scanState: 'scanning' | 'done' | 'refreshing'
  results: DiscoveryResult[]
  showManual: boolean
  manualInput: string
  manualConnecting: boolean
  demoMode: boolean
```

Props (same as current `Onboarding`):
- `onSelect(result)` — called when user clicks Connect on a result row
- `onDemoToggle(val)` — called when demo mode is toggled
- `discovering` + `discoveryResults` from App.tsx (or self-managed, see below)

### App.tsx changes
- Remove the auto-connect-on-single-result logic from `runDiscovery` — the component always shows results
- The background refresh effect stays (it feeds `discoveryResults` signal)
- `OnboardingCard` replaces `<Onboarding>` everywhere

---

## Files to change

| File | Change |
|---|---|
| `src/components/Onboarding.tsx` | Replace with unified `OnboardingCard` |
| `src/components/EnginePickerPanel.tsx` | Delete (absorbed into OnboardingCard) |
| `src/store/discovery.ts` | Add `extractHostnameBase` + `discoverEnginesByPrefix` |
| `src/App.tsx` | Remove auto-connect-on-single-result; update component reference |
| `src/styles/main.css` | Update/add onboarding card styles |

---

## Out of scope

- Settings panel (⚙) reuses the same OnboardingCard — no change to that flow
- Store URL manual entry field — remove it (was only needed before `/api/store-url` existed)
