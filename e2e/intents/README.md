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
Put thin wrappers under Engine `test/duration/ui/` if preferred — they should
delegate here rather than re-implement selectors.

Package export: `idea-console/duration-intents` → `e2e/intents/index.ts`
(requires path / workspace link to this repo; package is `private`).

## App-open Running path (Kid)

After dock, Engine strips `instances/`. Console **Open** needs **sidecar Running**:

```bash
cd /home/pi/idea/agents/agent-app-dev
bash tests/duration-tests/scripts/post-dock-restore-running.sh
# default --mode sidecar → /home/pi/idea166-kolibri-live :18080
```

Pins: `diskId=duration-kolibri-grade5a-001`, `instanceId=kolibri-grade5a-001`.
Nextcloud sidecar landing on App#10 soon. See `fixtures.ts`.

## Deferred (not registered — Engine clear miss / skip)

| Key | Reason |
|---|---|
| `enter_infra_fleet_walk`, `infra_*` | Engine-owned |
| `keep_watching`, `next_resource`, `exit_lesson`, `finish_exercise`, `next_video` | Lesson chrome — **not hardpassable** vs stock Kolibri player + CONTENT pins alone; need Kid App-side testids. Canonical Axle YAML keeps them; Console leaves unregistered (no silent stubs). |
| `open_wikipedia_as_teacher`, `open_wikipedia_as_learner` | Kiwix deferred (Kid) |

## Kid pins

See `fixtures.ts` — content IDs + `live` facility/class/lesson (mutable on re-provision).

## Operator deep (this batch)

Registered real adapters (fail loud when gated / UI missing):
`install_app`, `start_after_install`, `stay_on_disk`, `make_backup_disk`,
`restore_from_backup`, `open_app`, `backup_instance`, `back_to_disk`,
`back_to_overview`, `log_out`, `notice_usb_dock`, `retry_login_first_time_setup`,
`change_password`, `add_operator`, `remove_operator`, `copy_app`, `move_app`.

`copy_app` / `move_app` complete the Copy/Move modal only — drag-drop init still
needs multi-disk preload (loud throw if modal not open).
