# Duration-test Intent adapters (idea#166 / #168)

Playwright adapters keyed by Axle [ACTIONS.md](https://github.com/koenswings/agent-engine-dev/blob/feat/duration-tests-phase1-2/test/duration/ACTIONS.md) / proposal snake_case (`/tmp/duration-tests.md` UI Interactions).

## Engine wiring (Axle Phase 3)

Console exports a callable bridge for the duration runner:

```ts
import {
  runDurationIntent,
  hasDurationIntent,
  CONSOLE_INTENT_NAMES,
  intentRegistry,
} from 'idea-console/duration-intents';
// Sibling-clone fallback:
// from '../../agent-console-dev/e2e/intents'

const result = await runDurationIntent({
  action: ctx.action,       // YAML `action:` key
  page,                     // Playwright Page on Console URL
  diskId: ctx.fixtureDisk,
  instanceId: ctx.fixtureInstance,
});
if (!result.ok) { /* fail step / log result.message */ }
```

Replace Engine `uiStub` when `stubUi: false` by calling `runDurationIntent`.
Package export: `idea-console/duration-intents` → `e2e/intents/index.ts`.


## --record-walk screenshots (Axle soft-detect)

Locked Pixel exports for Engine `PlaywrightUiDriver`:

```ts
import { runDurationIntent, captureAfterIntent } from 'idea-console/duration-intents';

// Prefer: pass screenshotPath so Pixel settles once and writes the PNG
await runDurationIntent({ action, page, screenshotPath: '/tmp/walk/step-0001-open_app.png' });

// Or call directly (same settle + viewport capture)
await captureAfterIntent(page, { path, intent: action, settleMs: 300 });
```

| Detail | Contract |
|---|---|
| Settle | `domcontentloaded` → best-effort `networkidle` → `settleMs` (default **300**) |
| Screenshot | `fullPage: **false**` (viewport; stitch-friendly). Engine fallback may use `fullPage: true`. |
| Soft-detect order | (1) `runDurationIntent` + `screenshotPath` writes PNG → (2) `captureAfterIntent` → (3) Engine `page.screenshot({ fullPage: true })` |
| No double settle | When Pixel writes the file, Engine `captureFrame` returns on `existsSync` — no second wait. |

## App-open Path A vs Path B (Kid App#10 @9ba7876)

**Gap:** sidecar HTTP can be Running while Console overview cards still lack
clickable `open-instance-<id>` (Path A needs Axle `startInstances` — not wired).

| Path | When | How |
|---|---|---|
| **A** | Console shows Running card with Open | Click `open-instance-<id>` |
| **B** | Open missing / not Running | `page.goto` sidecar URL (same hostname as Console, swap port) |

Bring sidecars up:

```bash
cd /home/pi/idea/agents/agent-app-dev
bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar
# idea03 Kolibri only:
#   bash …/post-dock-restore-running.sh --mode sidecar --apps kolibri --kolibri-port 18081
```

| App | diskId | instanceId | Default port |
|---|---|---|---|
| Kolibri | `duration-kolibri-grade5a-001` | `kolibri-grade5a-001` | **18080** (idea01); idea03 → **18081** |
| Nextcloud | `duration-nextcloud-grade5a-001` | `nextcloud-grade5a-001` | **18280** (both hosts) |

**Env knobs** (full URL wins over port):

- `DURATION_KOLIBRI_URL` / `DURATION_NEXTCLOUD_URL`
- `DURATION_KOLIBRI_PORT` (default `18080`) / `DURATION_NEXTCLOUD_PORT` (default `18280`)

Helpers: `resolveSidecarUrl` / `openAppInstance` in `sidecarUrls.ts` + `openApp.ts`.
`open_video` / `open_exercise` use the same Path A→B open before content pins.

**Prefer A content gate (`open_video` / `open_exercise` / `keep_watching`):** success only when the
Kolibri Learn URL is `#/topics/c/<pinned ContentNode id>` (Kolibri `TOPICS_CONTENT`, optional device
segment and query allowed). Kolibri never puts `content_id` in the URL, so the node id is the proof
(video `4a1a1b923f6d59eba94c3f91f0011dd5`, exercise `94a47ec7f30d5cd193f8ad08c42b6c2a`). Topic folders
(`/topics/t/…`), home, lesson-only URLs and the other pin fail. Navigation: card on the current page →
parent topic `/topics/t/63427029c7eb5e86b62a731d9564aa50` and click the card (node href or title) →
Kolibri deep link `/topics/c/<node>`. Each try gets 15s to reach the route, then a loud-fail listing what was tried.
Fail loud if neither Path A card nor Path B HTTP is reachable.

## Deferred (not registered — Engine clear miss / skip)

| Key | Reason |
|---|---|
| `enter_infra_fleet_walk`, `infra_*` | Engine-owned |
| `next_resource`, `exit_lesson`, `finish_exercise`, `next_video` | Lesson chrome — need Kid App-side testids (preferred list: App `tests/duration-tests/LESSON_CHROME.md`, not in image yet). Stay unregistered. `keep_watching` is registered (stay on `/topics/c/<video node id>`; no chrome testids). |
| `open_wikipedia_as_teacher`, `open_wikipedia_as_learner` | Kiwix deferred (Kid) |

## Kid pins

See `fixtures.ts` — content IDs + `live` facility/class/lesson (mutable on re-provision).

## Operator deep

Registered (fail loud when gated / UI missing):
`install_app`, `start_after_install`, `stay_on_disk`, `make_backup_disk`,
`restore_from_backup`, `open_app`, `backup_instance`, `back_to_disk`,
`back_to_overview`, `log_out`, `notice_usb_dock`, `retry_login_first_time_setup`,
`change_password`, `add_operator`, `remove_operator`, `copy_app`, `move_app`.

`copy_app` / `move_app` = **real** HTML5 drag instance→target disk + Copy/Move modal (loud-fail if <2 docked disks / no copyable instance). See § Multi-disk copy_app preload.

Part B operator leftovers: `files_role_added`, `backup_configured_restored`,
`done_redistribute`, `stay_on_source_disk`, `open_copied_instance`, `switch_engine`,
`reboot_engine`. Usage leave: `back_to_console`, `leave_kolibri`, `leave_nextcloud_as_*`.

### Settings / Connect / USB / reboot / leave (Prefer A)

| Intent | Contract |
|---|---|
| `open_settings` | Panel + Engine tab + `settings-engine-status` (connected/demo). Account: `settings-change-password-*`. |
| `close_settings` | Panel must **hide** after settings-btn (loud if still open). |
| `switch_engine` | Prefer A r44: open ConnectionManagement; if status-bar hostname **already matches** `DURATION_SWITCH_ENGINE_HOST` → **PASS** (already connected; "No engine found" is N/A — do **not** manual-Connect retry). Connect/retry only when status hostname ≠ HOST. Scan `DURATION_SWITCH_ENGINE_SCAN_MS`; connect `DURATION_SWITCH_ENGINE_CONNECT_MS`. |
| `notice_usb_dock` | NetworkTree visible **and** ≥1 `disk-*` within 20s. No soft 500ms dwell. |
| `reboot_engine` | Prefer A r48: hostname row match (r47) plus page.once(dialog, accept) BEFORE click. Native confirm() blocks click — do not Promise.all dialog with click. Loud if no dialog. |
| `open_copied_instance` | `DURATION_COPY_INSTANCE_ID` or ctx.instanceId required — **no** silent Grade5A remap. ALL APPS → instance controls. |
| `confirm_eject` / `cancel_eject` | Dialog must hide after OK/Cancel (no soft `.catch`). |
| `leave_*` / `back_to_console` | Close app tabs + overlays; assert `console-overview` / `op-overview`. Dismisses ConnectionManagement via `connection-mgmt-btn` if open. |

### Dwell / return / inventory / files role (Prefer A)

| Intent | Contract |
|---|---|
| `stay_on_teacher_overview` / `stay_on_learner_overview` / `open_console_as_teacher`/`_learner` | Prefer A r40: wait leave **Connecting…** + ≥1 `instance-*` (`DURATION_OVERVIEW_CATALOG_MS`, default **60s**; cold sync ~15s). Loud-fail with status + card count + elapsed. |
| `stay_on_overview` | Prefer A r40: leave Connecting… + ≥1 `disk-*` (`DURATION_OVERVIEW_CATALOG_MS`). |
| `return_to_start` | Dismiss erase/eject/settings/account/Connect; assert overview/tree. Loud if dialog stuck. |
| `open_disk_inventory` | Resolve visible `disk-*` (`DURATION_DISK_ID`); DiskView / EmptyDiskPanel must open. |
| `open_instance_controls` | Resolve visible instance (`DURATION_INSTANCE_ID`); start/stop/open controls. |
| `open_console_as_teacher` / `_learner` | Overview + `account-btn` required (no soft-catch). |
| `close_account` | `op-entry` must **hide** after toggle. |
| `cancel_erase` | `erase-dialog` must hide after Cancel. |
| `stop_instance` | Prefer A r38: status-driven Stopping→Stopped; wait while Stopping/in-progress; **re-click** Stop every `DURATION_STOP_RETRY_MS` (15s) if still Running/Open (SSH flap). Default settle **180s** (`DURATION_STOP_SETTLE_MS`); +60s grace while Stopping UI. Loud-fail includes last status/open/stopTitle/elapsed/stopClicks. |
| `add_files_role` | Requires visible `add-files` on DiskView; settle to files section/badge. Env `DURATION_FILES_DISK_ID`. |
| `make_files_disk` | After submit, wait Files role / DiskView settle (still needs Engine empty dock). |
| `stay_on_disk` / `stay_on_source_disk` | Resolve disk on tree; DiskView / EmptyDiskPanel visible. |

**Still deferred / blocked (not this tip):** lesson chrome (`next_resource`, `exit_lesson`, `finish_exercise`, `next_video`) Kid testids; `open_wikipedia_as_*` Kiwix; empty-disk Prefer A (`install_app` / `make_files_disk` / erase empty) until Engine redocks empty-002.

## Kolibri coaching (kolibri_manage)

After `open_kolibri_as_teacher` (Path A/B + two-step Kolibri login). Real Facility/Coach/Learn
hash navigation — **fail loud** if UI missing (never silent ok).

| Key | Where | Behavior |
|---|---|---|
| `create_class` | `/en/facility/#/classes` | Create-or-assert **Grade 5A** (NEW CLASS if absent) |
| `enroll_learners` | `/en/facility/#/classes/{classId}` | Open ENROLL LEARNERS or assert learner01 listed |
| `build_lesson` | Coach Plan → Lessons | Open **Grade 5A Duration Lesson** (or NEW LESSON+Cancel) |
| `create_quiz` | Coach Plan → Quizzes | Open NEW QUIZ wizard; Cancel when possible (no quiz preload) |
| `read_reports` | Coach Reports → Lessons | Open lesson report; assert learner/progress table |

Coach list settle (Prefer A): `build_lesson` / `create_quiz` / `read_reports` poll up to `DURATION_COACH_SETTLE_MS` (default 30s) for their control (lesson row / NEW LESSON, NEW QUIZ, lesson row) instead of one count after 800ms. A Kolibri sign-in bounce gets one fixture-teacher login and re-open. `build_lesson` then retries via real clicks (class list → Grade 5A → Plan → Lessons). Lesson detail must reach `/plan/lessons/<id>`. Loud-fail includes state, URL and a body snippet.
| `preview_as_learner` | Learn tab | Navigate `/en/learn/` |
| `browse_classes` | Learn home | Scan library/classes without starting a resource |
| `back_to_console` | Console | Close Kolibri tabs; assert `console-overview` / `op-overview` |

Class/lesson Morango ids: `fixtures.ts` → `DURATION_FIXTURES.kolibri.live` (CONTENT.live.json).
Ports: `DURATION_KOLIBRI_PORT` default **18080**; idea03/idea04 Form3→18080, G5A→**18081**.

**Not registered:** lesson-chrome player Intents (`next_resource`, `exit_lesson`, `finish_exercise`, `next_video`) — see LESSON_CHROME.md. `keep_watching` stays on `/topics/c/<video node id>`.

## Live duration — no bootDemo (`--live --ui`)

Duration walks against Kid fixture disks (`disk-duration-kolibri-grade5a-001`, …)
must use the **Engine-hosted Console** (production web), never bootDemo mock disks
(`DISK001` / `kolibri-disk`).

| Requirement | Detail |
|---|---|
| URL | Engine host **`:8080`** (e.g. `http://idea01:8080/`) — not Vite/dev, not extension popup |
| Demo | `isProductionWebMode()` forces demo **off** and clears localStorage `demoMode` even if stale `'true'` |
| URL knobs | `?demo=0` / `?demo=false` clear demo (dev/extension). `?demo=1` **ignored** on production web |
| Intents | Do **not** remap to demo disk IDs — fail loud if fixture disks missing |

Playwright (before `page.goto` Console):

```ts
await page.addInitScript(() => {
  localStorage.setItem('demoMode', 'false');
  localStorage.removeItem('demoMode'); // or set false — initConnection also clears in prod web
});
await page.goto('http://idea01:8080/');
// Assert no DEMO badge in status bar
```

Ops verify: status bar must **not** show `DEMO`; NetworkTree disks are Kid fixtures, not DISK001.

## Multi-disk `copy_app` / `move_app` preload (Axle / Engine)

Hardpass needs **real** NetworkTree drag (not demo DISK001). Prefer A:

| Requirement | Detail |
|---|---|
| Console | Engine `:8080`, `demoMode=false` (production web clears stale demo) |
| Disks | **Both** `duration-kolibri-grade5a-001` **and** `duration-nextcloud-grade5a-001` docked & visible in NetworkTree |
| Source instance | Card `instance-kolibri-grade5a-001` (default) with `data-copyable="true"` (storedOn set after Path A restore) |
| Target | Other duration disk row accepts drop |
| Defaults | Source=kolibri disk+instance → target=nextcloud disk. Flip when `diskId` is nextcloud. |
| Env overrides | `DURATION_COPY_SOURCE_DISK`, `DURATION_COPY_TARGET_DISK`, `DURATION_COPY_INSTANCE_ID` |

Sequence: select source disk → drag `instance-*` onto target `disk-*` → modal `copy-move-modal` → **Copy** / **Move**.

Loud-fail messages name the missing preload — never silent ok / demo remap.

After copy, walker may use `stay_on_source_disk` / `done_redistribute` / `open_copied_instance`.

## eject_disk after redistribute (Axle hardpass)

After `copy_app` → `done_redistribute` the UI is on **ALL APPS** (`network-all-apps`).
Eject still lives on NetworkTree disk rows (`eject-<diskId>`).

| Detail | Contract |
|---|---|
| Confirm | **Always** opens `eject-confirm` (including pure Apps duration disks) |
| Intent | Ensures overview/tree, waits for eject enabled (copy lock cleared), clicks eject, waits confirm |
| Default disk | Prefer `DURATION_EJECT_DISK_ID` / ctx; if missing on tree (post-erase), pick surviving ejectable disk (nextcloud / backup / empty remnant) — **never** soft-assume erased kolibri |
| Next step | Walker `confirm_eject` clicks `eject-confirm-ok` |

Loud-fail if disk/button/modal missing — no demo remap.

## change_password / remove_operator (Prefer A account walk)

After `add_operator` the UI is on **Operator Management** (not Account main).

| Intent | Contract |
|---|---|
| `change_password` | Form must have `data-testid="change-password-form"` on **both** AccountScreen and OperatorManagement. Idempotent fill with `admin911!` / `DURATION_OPERATOR_PASSWORD`. |
| `add_operator` | Wait for `add-operator-success` **and** `operator-row-*` with that username + enabled Remove — toast alone ≠ hardpass. |
| `remove_operator` | Click enabled `remove-operator-*` (not self); wait until detached. Loud-fail if only admin / Remove disabled. Stale create toast is not success. |

Env: `DURATION_ADD_OPERATOR_USERNAME`, `DURATION_REMOVE_OPERATOR_USERNAME`, `DURATION_OPERATOR_PASSWORD`.

## sign-in Connecting… after dock/undock (Prefer A)

`[data-testid=sign-in]` stays **disabled** with label **Connecting…** while `store` is null
(Engine WS / Automerge not synced yet).

| Intent | Behavior |
|---|---|
| `open_console_as_operator` | Live `:8080` skips bootDemo reload; waits until Log in enabled / already logged in / first-time setup |
| `sign_in` / `retry_login_first_time_setup` | Shared `waitForSignInReady` (default **60s**, `DURATION_SIGNIN_READY_MS`); loud-fail with status-bar + sign-in text + demoMode/hostname |

Axle: after `infra_dock_fixture`, prefer a short settle before `open_console_as_operator`, or rely on the 60s wait. Do **not** soft-pass while Connecting….

## EmptyDiskPanel preload (`install_app` / `make_files_disk` / `make_backup_disk`)

Path A Prefer A docks **app** disks (`duration-kolibri-grade5a-001`, …). Those show
DiskView — **not** EmptyDiskPanel. Steve: **no soft-skip**, **no remap onto Grade5A**.

| Requirement | Detail |
|---|---|
| Fixture | Dock an **empty** disk (`diskTypes: ['empty']`, no instances) |
| Suggested id | **`duration-empty-001`** until Kid publishes a pin |
| Env | `DURATION_EMPTY_DISK_ID` overrides |
| Intents | Select empty via NetworkTree (`data-role="empty"` or preferred id) → EmptyDiskPanel → action |
| Loud-fail | If no empty disk docked — Engine must add/dock empty fixture; Axle may interim-skip these steps |

Registered-intents walk (not “hardpass”): Axle interim-skip until empty docks is OK.

## RestorePanel preload (`restore_from_backup`)

After `make_backup_disk`, Prefer A walk may leave focus elsewhere. `restore_from_backup`
must **select the Backup Disk** so `[data-testid="restore-panel"]` is active.
Steve: **no soft-skip**, **no remap onto Grade5A App Disks** as the backup source.

| Requirement | Detail |
|---|---|
| Fixture | Disk with `diskTypes` including `backup` (often former empty after `make_backup_disk`) |
| Suggested id | **`duration-empty-001`** — Kid has no separate `duration-backup-*` pin; same pack as empty |
| Env | `DURATION_BACKUP_DISK_ID` overrides |
| Intents | `ensureBackupDiskPanel`: prefer env/ctx/fixture → NetworkTree `data-role="backup"` → loud-fail |
| Sibling | `backup_configured_restored` also tries ensure-backup when restore-panel not yet visible |
| Loud-fail | Preload text if no Backup Disk — Engine must dock/select backup; Axle may interim-skip |

Registered-intents walk: run `make_backup_disk` on empty, then `open_disk_inventory` on that disk (or rely on Intent ensure) before `restore_from_backup`.

## make_backup_disk complete configure (r15 soft-pass fix)

r15 FAIL@66: Intent clicked Configure with **zero** instances checked → red
"Select at least one app to back up." → disk stayed `empty`. Soft-pass in ~2.5s.

| Step | Detail |
|---|---|
| 1 | `ensureEmptyDiskPanel` |
| 2 | Open Backup card (`make-backup-disk`) |
| 3 | Select **On demand** (`backup-mode-on-demand`) |
| 4 | Check ≥1 `backup-link-instance-*` (prefer `DURATION_BACKUP_SOURCE_INSTANCE` / ctx / `kolibri-grade5a-001`, else Running, else first) |
| 5 | Click `configure-backup-disk` |
| 6 | Wait for `backup-configured-success` **or** NetworkTree `data-role="backup"` **or** `restore-panel` |
| Fail | Loud if `backup-form-error` / still empty role — **no soft-pass** |

`backup_configured_restored` must **not** match EmptyDiskPanel leftovers
("Make this a Backup Disk" / Configure form). Only success / backup badge / RestorePanel.

## erase_disk / confirm_erase (Prefer A empty only)

r16 FAIL@72: `erase_disk` erased **Kolibri Grade5A** (current selection); `confirm_erase`
soft-ok while **"checking…"**; kolibri gone → `eject_disk` default failed.

| Intent | Contract |
|---|---|
| `erase_disk` | `ensureEmptyDiskPanel` first — **never** Grade5A. Loud-fail if no empty (`DURATION_EMPTY_DISK_ID` / `duration-empty-001`). Then `erase-this-disk`. |
| `confirm_erase` | Wait for confirm field → type label → OK → wait for `erase-complete` / Done (≤180s). **No soft-pass** on checking… |
| `eject_disk` | If preferred disk missing (erased), discover surviving ejectable row; loud-fail with visible disk ids. |

## start_instance already Running (r17 FAIL@77)

Path A `kolibri-grade5a-001` may already be **Running** (green + Open ↗) so Start is
correctly disabled. Intent must **no-op PASS**, not hard-click Start.

| Detail | Contract |
|---|---|
| Default id | `kolibri-grade5a-001` — override `DURATION_START_INSTANCE_ID` |
| Already Running | Detect Open ↗ / StatusDot Running / Start disabled+Stop enabled → **PASS no-op** |
| Force restart | `DURATION_START_FORCE_RESTART=1` → Stop then Start |
| Loud-fail | Not running **and** Start disabled (locked) |
| Discovery | Prefer Path A `*grade5a*` testids — not zombie `kolibri-1.0-duration*` rows |
| `stop_instance` | No-op when already Stopped; r38 status-driven settle + Stop retry (see Prefer A dwell table) |
| `start_after_install` | **Not** grade5a — discover non-grade5a `start-*` after install (empty-002 uuid). Override `DURATION_START_AFTER_INSTALL_ID`. Leaves Install picker / ALL APPS first. |

## start_after_install post-install instance (r27 FAIL@86)

Late `install_app` on empty-002 creates a **new uuid** instance (Engine `installApp` /
`processInstance`). Walker edge `op_install → start_after_install → op_instance` must
start **that** instance — not Path A `kolibri-grade5a-001` (Stopped on nextcloud after
move/backup). r27: Intent reused `start_instance` → looked for grade5a while UI still on
Empty Disk 002 Install picker → `visible start-instance ids=[]`.

| Detail | Contract |
|---|---|
| Target | Newly installed non-grade5a id (discover `start-/stop-/open-instance-*`) |
| Override | `DURATION_START_AFTER_INSTALL_ID` (not `DURATION_START_INSTANCE_ID`) |
| Leave picker | Wait install settle; Back on success; open ALL APPS |
| `install_app` | Soft kickoff only (early walk needs empty-001 for make_files); **full settle in `start_after_install`** |
| Scoped | `start_instance` / `open_instance_controls` keep Path A grade5a defaults |
| Loud-fail | No non-grade5a controls after budget — no soft-pass |

## open_app ensure Running + sidecar HTTP (r18/r19)

r18: `start→stop→open` → Stopped → Open gone → Path B refused.
r19: Automerge **Running ≠ sidecar up** (ghost Running after move_app docker-missing);
`start_instance` no-op ~3.7s; Path B `:18080` ERR_CONNECTION_REFUSED.

| Detail | Contract |
|---|---|
| Console Start/Stop | `ensureInstanceRunningForOpen` → start (no-op if Running) |
| Ghost Running | Open missing while UI Running → **force-restart** (stop→start) |
| Sidecar poll | Before Path B: HTTP 2xx/3xx (`DURATION_SIDECAR_READY_MS` default **90s**) |
| Path A | Only when Open ↗ visible |
| Loud-fail | Sidecar timeout / cannot Open — **no** soft-pass connection refused |
| Id | `DURATION_START_INSTANCE_ID` / `kolibri-grade5a-001` |
| Classroom | No Start control → Path B still waits sidecar ready |
| Engine | failAfter=1 on docker-missing welcome belt (no Console change) |
| Siblings | `open_kolibri_as_*` / `open_nextcloud_as_*` share `openAppInstance` |

## restore_from_backup settle (r21/r22)

After Confirm, restore may **SIGTERM** kolibri (exit 143) while Automerge stays Running
→ Engine docker-missing before `move_app`. r22: unlock ~3.4s raced delayed SIGTERM.

| Step | Contract |
|---|---|
| Confirm | Wait `restore-confirm-*` hidden |
| Unlock | Wait Restore leave "Operation in progress" (`DURATION_RESTORE_SETTLE_MS` ≥120s) |
| Min dwell | `DURATION_RESTORE_MIN_DWELL_MS` default **10s** after Confirm (not unlock-alone) |
| Overview | ALL APPS / opOverview |
| Running | `ensureInstanceRunningForOpen` + `waitForSidecarStable` (3 consecutive polls) |
| Loud-fail | Settle/sidecar timeout — **no** soft-pass / no demo remap |

## copy_app / move_app settle (r22 FAIL@71)

r34: after `move_app`, read instance `data-source-disk-id` (storedOn) and pick a **different** docked target (`pickTargetDiskId`) — same-disk drop never opens modal (`isDragTarget`). Loud-fail if only same-disk remains.

r33: synthetic `page.evaluate` drag must **not** use nested named helpers — esbuild `keepNames` injects `__name(...)` (undefined in page → ReferenceError). Inline `dispatchEvent` only.


Move Confirm → kolibri Exited 143 / docker-missing while store Running.

| Step | Contract |
|---|---|
| Confirm | Modal hidden |
| Quiet + min dwell | ≥8s after Confirm; `DURATION_COPY_MOVE_SETTLE_MS` ≥120s budget |
| Overview | ALL APPS |
| Running | `ensureInstanceRunningForOpen` + `waitForSidecarStable` for `pair.instanceId` |
| Loud-fail | idea#168 citing r22 docker-missing — **no** soft-pass / no demo remap |

## backup_instance ensure Running (r23 FAIL@83)

Product: `isBackupDisabled` → Backup **only** when status === `Running` (Stopped disables).
Do **not** change product. r23: `stop` then `backup` left Backup disabled.

| Step | Contract |
|---|---|
| Id | `resolveStartInstanceId` / `DURATION_START_INSTANCE_ID` |
| Missing btn | Loud-fail — need linked Backup Disk (`hasBackupDisks`) |
| Not Running / disabled | `runStartInstance` then wait Backup enabled (`DURATION_BACKUP_SETTLE_MS` ≥90s) |
| Still disabled | Loud-fail distinguishing Stopped vs locked vs missing Backup Disk |
| Prefer A | backup-before-stop in walk; Intent also starts if Stopped — **no** soft-pass |

## runStartInstance wait while Starting (r32 FAIL@86)

Late `installApp` may auto-start the new instance (Starting / Operation in progress).
`start_after_install` must **not** fail ~468ms on disabled Start.

| Detail | Contract |
|---|---|
| Truly Running | Open ↗ / Running status → no-op PASS |
| Starting / in-progress | Poll until Running or Start enables (`DURATION_START_SETTLE_MS` default **120s**) |
| Then | Click Start if still needed |
| Loud-fail | Timeout still disabled / never Running — **no** soft-pass |
| Callers | `start_instance`, `start_after_install`, `backup_instance`, open settle |
