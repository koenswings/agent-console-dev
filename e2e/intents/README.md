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
Fail loud if neither Path A card nor Path B HTTP is reachable.

## Deferred (not registered — Engine clear miss / skip)

| Key | Reason |
|---|---|
| `enter_infra_fleet_walk`, `infra_*` | Engine-owned |
| `keep_watching`, `next_resource`, `exit_lesson`, `finish_exercise`, `next_video` | Lesson chrome — need Kid App-side testids (preferred list: App `tests/duration-tests/LESSON_CHROME.md`, not in image yet). Stay unregistered. |
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
`done_redistribute`, `stay_on_source_disk`, `open_copied_instance`, `switch_engine`
(loud if no Connect picker), `reboot_engine`. Usage leave: `back_to_console`,
`leave_kolibri`, `leave_nextcloud_as_*`.

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
| `preview_as_learner` | Learn tab | Navigate `/en/learn/` |
| `browse_classes` | Learn home | Scan library/classes without starting a resource |
| `back_to_console` | Console | Close Kolibri tabs; assert `console-overview` / `op-overview` |

Class/lesson Morango ids: `fixtures.ts` → `DURATION_FIXTURES.kolibri.live` (CONTENT.live.json).
Ports: `DURATION_KOLIBRI_PORT` default **18080**; idea03/idea04 Form3→18080, G5A→**18081**.

**Not registered:** lesson-chrome player Intents (`keep_watching`, …) — see LESSON_CHROME.md.

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
