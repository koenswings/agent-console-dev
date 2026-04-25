# IDEA Console — UI Design Document

**Version:** 0.2.1  
**Date:** 2026-04-25  
**Author:** Pixel (Console UI Developer)

---

## Overview

IDEA Console is a web app (also packaged as a Chrome extension) for managing offline educational apps on IDEA Engines in schools. Operators (administrators) manage instances, disks, and users. Non-authenticated visitors can browse and launch apps.

The UI is a single-page app built with SolidJS. All screens render inside one `<div class="app">` — a persistent **status bar** at the top, and one **content area** below it that switches between screens using a `<Switch>/<Match>` block.

---

## Persistent Chrome: Status Bar

Present on **every screen**, always at the top.

```
┌─────────────────────────────────────────────────────────────────────┐
│ IDEA Console v0.2.1    ● 100.115.60.6      [DEMO]  admin  👥  Log out  ⚙ │
└─────────────────────────────────────────────────────────────────────┘
```

| Element | Description | Visibility |
|---|---|---|
| Title + version | "IDEA Console v0.2.1" | Always |
| Status dot + label | Green dot + hostname when connected; orange "Scanning…"; red "No engine found" | Always |
| DEMO badge | Orange badge | Demo mode only |
| Username | Logged-in operator's name | Authenticated only |
| 👥 button | Toggles Operator Management screen | Authenticated only |
| Log out | Logs out current operator | Authenticated only |
| ⚙ button | Toggles Settings panel (✕ to close) | Always |

---

## Screen Inventory

The app has **8 distinct screens** (content area states):

| # | Screen | Trigger condition |
|---|---|---|
| 1 | Onboarding | Not configured and not in demo mode |
| 2 | Settings Panel | ⚙ button pressed |
| 3 | First-Time Setup | Engine connected, no users exist yet |
| 4 | App Browser (unauthenticated) | Connected, not logged in |
| 5 | Main Layout (authenticated) | Logged in as operator |
| 6 | Operator Management | 👥 button pressed while logged in |
| 7 | Empty Disk Panel | Operator selects an empty disk in tree |
| 8 | Restore Panel | Operator selects a backup disk in tree |

Additionally, one **modal overlay** can appear on top of any screen:

| # | Modal | Trigger |
|---|---|---|
| M1 | Login Form | "Log in" button in App Browser |

---

## Screenshots

All screenshots captured with Playwright headless Chromium against the live dev server (demo mode).
Script: `scripts/screenshot-screens.ts`

| Screen | File |
|---|---|
| S1 Onboarding | `screenshots/S1-onboarding.png` |
| S4 App Browser (logged out) | `screenshots/S4-app-browser-logged-out.png` |
| M1 Login Modal | `screenshots/M1-login-modal.png` |
| S5 Main Layout | `screenshots/S5-main-layout.png` |
| S5b Engine selected | `screenshots/S5b-engine-selected.png` |
| S5c Disk selected | `screenshots/S5c-disk-selected.png` |
| S6 Operator Management | `screenshots/S6-operator-management.png` |
| S7 Empty Disk Panel | `screenshots/S7-empty-disk-panel.png` |
| S8 Restore Panel | `screenshots/S8-restore-panel.png` |
| S2 Settings — Engine | `screenshots/S2-settings-engine.png` |
| S2b Settings — Account | `screenshots/S2b-settings-account.png` |
| S2c Settings — About | `screenshots/S2c-settings-about.png` |

---

## Screen 1: Onboarding

**File:** `src/components/Onboarding.tsx`  
**When shown:** App has no configured hostname and is not in demo mode. Also shown embedded within the Settings panel's "Change engine" flow.

```
┌───────────────────────────────────────────┐
│           IDEA Console                    │
│  Configure the Engine connection…         │
│                                           │
│  ● Scanning for engine on the network…   │  ← only while discovering
│                                           │
│  [Demo mode toggle]  ☑ Demo mode          │
│   Show mock data — explore without Engine │
│                                           │
│  (when not demo mode):                    │
│  [Scan for engine]                        │
│  Engine hostname: [________________]      │
│                                           │
│       [Save & Connect]                    │
└───────────────────────────────────────────┘
```

**Sub-state: Engine Picker** — if 2+ engines are found on the network, a list of discovered engines appears instead of the manual form. The user picks one or chooses "Enter manually".

**Flows from here:**
- Save & Connect → **Screen 3** (First-Time Setup) or **Screen 4** (App Browser)
- Demo mode on → **Screen 4** (App Browser, demo data)

---

## Screen 2: Settings Panel

**File:** `src/components/SettingsPanel.tsx`  
**When shown:** ⚙ button in status bar. Overlays the entire content area.

```
┌──────────────────────────────────────────────────────┐
│  [Engine Connection] [Account] [About]    [✕ Close]  │
│                                                      │
│  Engine Connection tab:                              │
│  ● Connected to 100.115.60.6                         │
│  [Change engine]  (operator only)                    │
│                                                      │
│  Account tab (operator only):                        │
│  Change Password form                                │
│                                                      │
│  About tab:                                          │
│  IDEA Console · v0.1.0                               │
│  Display mode picker (extension only)                │
└──────────────────────────────────────────────────────┘
```

**Tabs:**
- **Engine Connection** — shows current connection status; "Change engine" opens `ChangeEngineDialog` sub-panel inline (hostname input + demo toggle + scan)
- **Account** — change password form (current / new / confirm); only shown when logged in
- **About** — app name, version, display mode selector (extension only)

**Flows from here:**
- ✕ Close → returns to previous screen
- Change engine → triggers reconnect, stays in Settings
- Switch to demo mode → reconnects in demo

---

## Screen 3: First-Time Setup

**File:** `src/components/FirstTimeSetup.tsx`  
**When shown:** Engine is connected but `userDB` is empty (no operators exist yet). Auto-provision of `admin/admin911!` also runs in the background when this condition is met.

```
┌───────────────────────────────────────────┐
│       Welcome to IDEA Console             │
│  Create the first operator account        │
│                                           │
│  Username: [admin____________]            │
│  Password: [________________]             │
│  Confirm:  [________________]             │
│                                           │
│       [Create account]                    │
└───────────────────────────────────────────┘
```

**Flows from here:**
- Create account → **Screen 5** (Main Layout, automatically logged in)

---

## Screen 4: App Browser (Unauthenticated)

**File:** `src/components/AppBrowser.tsx`  
**When shown:** Default fallback — shown when connected (real or demo) but no operator is logged in.

```
┌─────────────────────────────────────────────────────┐
│  Apps                                    [Log in]   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Kolibri  │  │Nextcloud │  │  App 3   │          │
│  │ Running  │  │ Undocked │  │ Stopped  │          │
│  │ [Open ↗] │  │(greyed)  │  │(greyed)  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                     │
│  (or: "No apps available on this network yet.")     │
└─────────────────────────────────────────────────────┘
```

- App cards show all instances (Running and non-Running)
- Running apps show an "Open ↗" link to the app's URL on the engine
- Non-running apps are greyed out / unavailable
- "Log in" button → **Modal M1** (Login Form)

**Flows from here:**
- Log in → **Modal M1** → on success → **Screen 5** (Main Layout)

---

## Modal M1: Login Form

**File:** `src/components/LoginForm.tsx`  
**When shown:** Floats above App Browser (or any screen) when "Log in" is clicked. Rendered outside the Switch so it survives screen transitions.

```
┌─────────────────────────────────┐
│  Operator Login              [✕]│
│                                 │
│  Username: [____________]       │
│  Password: [____________] [👁]  │
│                                 │
│  [error message if any]         │
│  Waiting for engine to sync…    │  ← only if store not ready
│                                 │
│       [Log in] / [Verifying…]   │
└─────────────────────────────────┘
```

**Flows from here:**
- ✕ / Cancel → modal closes, returns to App Browser
- Successful login → modal closes → **Screen 5** (Main Layout)

---

## Screen 5: Main Layout (Authenticated)

**File:** `src/App.tsx` + `NetworkTree.tsx` + `InstanceList.tsx`  
**When shown:** Operator is logged in and Operator Management is not open.

```
┌──────────────────────────────────────────────────────────────────────┐
│ STATUS BAR                                                           │
├───────────────────┬──────────────────────────────────────────────────┤
│ NETWORK TREE      │  RIGHT PANEL (one of: Instance List /            │
│                   │              Empty Disk / Restore Panel)         │
│ 🌐 All instances  │                                                  │
│                   │  All instances                        3          │
│ 🖥 appdocker01    │  ┌─────────────────────────────────────────────┐ │
│   online          │  │ kolibri-main   Running  ● [Stop] [Backup]   │ │
│   💾 main-disk    │  │ CPU 12% · RAM 345MB · Disk 2.1GB            │ │
│     📦 kolibri    │  │ Last backup: Apr 10, 14:32                  │ │
│     📦 nextcloud  │  ├─────────────────────────────────────────────┤ │
│   💾 backup-disk  │  │ nextcloud-main  Undocked  ● [Start]         │ │
│     backup        │  │ (no metrics)                                │ │
│   💾 empty-disk   │  └─────────────────────────────────────────────┘ │
│     empty         │                                                  │
└───────────────────┴──────────────────────────────────────────────────┘
```

### Left Panel: Network Tree

Hierarchical tree:
1. **🌐 All instances** — top-level row, selects all
2. **🖥 Engine rows** — hostname + online/offline badge
3. **💾 Disk rows** (under each engine) — disk name + type badge (app / backup / empty / files / upgrade) + ⏏ eject button (not on backup disks)
4. **📦 Instance rows** (under each disk) — draggable; drag to another disk triggers Copy/Move modal

**Copy/Move modal** — appears inline in NetworkTree when an instance is dropped on a different disk:
```
┌─────────────────────────────────┐
│  Copy or Move?                  │
│  kolibri from main → backup-2   │
│  [Cancel]  [Move]  [Copy]       │
└─────────────────────────────────┘
```

### Right Panel

Switches based on what's selected in the tree:

**a) Instance List** — default, shown for network / engine / app disk selections

Each `InstanceRow` shows:
- App name + status dot (Running / Stopped / Starting / Docked / Undocked)
- Start / Stop / Backup buttons (context-sensitive disabled states)
- Docker metrics if running: CPU %, RAM used, Disk used
- Last backup timestamp + backup disk chips
- Operation progress bar (inline, when an op is running)

**b) Empty Disk Panel** — shown when an empty disk is selected → **Screen 7**

**c) Restore Panel** — shown when a backup disk is selected → **Screen 8**

**Operation Progress bar** — thin bar above the right panel, shows active engine operations (install, backup, restore, etc.) with a progress percentage and label.

---

## Screen 6: Operator Management

**File:** `src/components/OperatorManagement.tsx`  
**When shown:** 👥 button in status bar (replaces main layout content area entirely).

```
┌─────────────────────────────────────────────────────┐
│  Operators                                          │
│  ● admin (you)                          [Remove]   │
│  ● teacher1                             [Remove]   │
│                                                     │
│  Add Operator                                       │
│  Username: [__________]                             │
│  Password: [__________]                             │
│  [Add operator]                                     │
│                                                     │
│  Change My Password                                 │
│  Current: [__________]                              │
│  New:      [__________]                             │
│  Confirm:  [__________]                             │
│  [Change password]                                  │
└─────────────────────────────────────────────────────┘
```

**Flows from here:**
- 👥 button again (✕) → returns to **Screen 5** (Main Layout)

---

## Screen 7: Empty Disk Panel

**File:** `src/components/EmptyDiskPanel.tsx`  
**When shown:** Operator selects an empty-type disk in the Network Tree (right panel of Main Layout).

Has 4 sub-states:

### 7a. Menu
```
┌──────────────────────────────────────────┐
│ 💾 usb-drive-01  Empty disk              │
│  What would you like to do?              │
│                                          │
│  [🗄 Configure as Backup Disk]           │
│     Link instances + backup schedule     │
│                                          │
│  [📁 Configure as Files Disk]            │
│     Shared network filesystem            │
│                                          │
│  [📦 Create new App Instance]            │
│     Install from network or catalog disk │
└──────────────────────────────────────────┘
```

### 7b. Configure as Backup Disk
- Backup mode selector: On demand / Immediate / Scheduled (radio)
- Instance checklist (all instances on the network)
- [Cancel] [Configure Backup Disk]
- On submit: shows success state with [Back]

### 7c. Configure as Files Disk
- Confirmation text
- [Cancel] [Configure Files Disk]

### 7d. Install App
- Search/filter input
- App list (radio selection): name, version, source
- [Cancel] [Install]

---

## Screen 8: Restore Panel

**File:** `src/components/RestorePanel.tsx`  
**When shown:** Operator selects a backup-type disk in the Network Tree.

```
┌──────────────────────────────────────────┐
│ 💾 backup-disk  Backup disk              │
│  Mode: On demand · Linked: 2 instances   │
│                                          │
│  kolibri-main                            │
│    Backed up: Apr 10, 14:32              │
│    Restore to:  [main-disk ▾]            │
│    [Restore]                             │
│                                          │
│  nextcloud-main                          │
│    Backed up: Apr 9, 09:11               │
│    Restore to:  [main-disk ▾]            │
│    [Restore]                             │
└──────────────────────────────────────────┘
```

- Lists all instances linked to this backup disk
- Per-instance: last backup time, target disk selector, Restore button
- On submit: success state with [Back]

---

## Screen Flow Diagram

```
                         ┌──────────────┐
                    ┌───▶│  Onboarding  │────────────────────┐
                    │    │  (Screen 1)  │                     │
                    │    └──────────────┘                     │
                    │           │ Save & Connect              │
   App starts       │           ▼                             │
   no config ───────┘    ┌─────────────────┐                 │
                         │ First-Time Setup │                 │
                         │   (Screen 3)    │                 │
                         └────────┬────────┘                 │
                                  │ Create account           │
                 ┌────────────────▼──────────────────────┐   │
  ⚙ (any screen)│        STATUS BAR (persistent)        │   │
  ──────────────▶│  ⚙ Settings · 👥 Ops Mgmt · Log out  │◀──┘
                 └──────┬──────────────┬─────────────────┘
                        │              │
              Not logged in         Logged in
                        │              │
                        ▼              ▼
              ┌─────────────┐   ┌──────────────────────────┐
              │ App Browser │   │     Main Layout           │
              │ (Screen 4)  │   │     (Screen 5)            │
              └──────┬──────┘   │                          │
                     │ Log in   │  NetworkTree + right pane │
                     ▼          │  ┌──────┬────────┬──────┐ │
              ┌─────────────┐   │  │Inst. │ Empty  │Backup│ │
              │ Login Modal │   │  │ List │  Disk  │Disk  │ │
              │   (M1)      │   │  │(5a)  │ (S7)   │ (S8) │ │
              └──────┬──────┘   │  └──────┴────────┴──────┘ │
                     │ success  └──────────────┬─────────────┘
                     └──────────────────────────┘
                                               │ 👥
                                               ▼
                                    ┌─────────────────────┐
                                    │ Operator Management  │
                                    │    (Screen 6)        │
                                    └─────────────────────┘
```

---

## Screenshots Needed

The browser isn't reachable from this agent, so I need you to take these screenshots of `http://100.115.60.6:5173`:

| # | What to capture | How to reach it |
|---|---|---|
| S1 | Onboarding screen | Open in incognito / clear localStorage |
| S2 | Settings panel | Click ⚙ |
| S3 | First-time setup | Fresh engine with empty userDB (or hard to reproduce) |
| S4 | App Browser (logged out) | Normal load, not logged in |
| M1 | Login modal | Click "Log in" in App Browser |
| S5 | Main Layout | Log in, click "All instances" |
| S5b | Main Layout — engine selected | Click engine row in tree |
| S5c | Main Layout — disk selected | Click a disk row |
| S6 | Operator Management | Click 👥 button |
| S7 | Empty Disk Panel | Click an empty disk in tree |
| S8 | Restore Panel | Click a backup disk in tree |

Once you send them, I'll embed them in this doc.

---

## Known Issues

- **Login modal does not dismiss after successful login** — the persistent bug. `showLogin` signal is set to `false` inside `batch()` together with `setAuthenticatedUser`, but the `<Show when={showLogin()}>` does not respond. Root cause is unclear — either Solid reactive disposal order or a stale closure issue.
