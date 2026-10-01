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

`copy_app` / `move_app` = Copy/Move modal completion only (loud throw if modal not open).

Part B operator leftovers: `files_role_added`, `backup_configured_restored`,
`done_redistribute`, `stay_on_source_disk`, `open_copied_instance`, `switch_engine`
(loud if no Connect picker), `reboot_engine`. Usage leave: `back_to_console`,
`leave_kolibri`, `leave_nextcloud_as_*`.
